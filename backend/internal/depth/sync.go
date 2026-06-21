package depth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/procluster/procluster/internal/aggregation"
)

type DepthEvent struct {
	Event     string      `json:"e"`
	EventTime int64       `json:"E"`
	Symbol    string      `json:"s"`
	FirstU    int64       `json:"U"`
	LastU     int64       `json:"u"`
	PrevU     int64       `json:"pu"`
	Bids      [][2]string `json:"b"`
	Asks      [][2]string `json:"a"`
}

type WSMessage struct {
	Stream string     `json:"stream"`
	Data   DepthEvent `json:"data"`
}

type DepthSync struct {
	symbol    string
	market    string
	orderBook *OrderBook
	cfg       aggregation.CompressionConfig
}

func NewDepthSync(symbol, market string, ob *OrderBook, cfg aggregation.CompressionConfig) *DepthSync {
	return &DepthSync{
		symbol:    symbol,
		market:    market,
		orderBook: ob,
		cfg:       cfg,
	}
}

func (ds *DepthSync) Run(ctx context.Context) {
	backoff := time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		log.Printf("[depth-sync] connecting %s:%s", ds.symbol, ds.market)
		err := ds.connectAndSync(ctx)
		if err != nil {
			log.Printf("[depth-sync] session ended %s:%s: %v", ds.symbol, ds.market, err)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

type snapResult struct {
	snap *snapshotResponse
	err  error
}

type wsMsg struct {
	raw []byte
	err error
}

// connectAndSync follows the Binance protocol order:
// 1. dial WS first; 2. start buffering events; 3. fetch REST snapshot;
// 4. apply snapshot; 5. drain pending — drop stale, apply first event unchecked,
// then validate the rest with the normal pu/U+1 rules.
func (ds *DepthSync) connectAndSync(ctx context.Context) error {
	wsURL := ds.wsURL()
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("ws dial: %w", err)
	}
	defer conn.Close()
	conn.SetReadLimit(2 * 1024 * 1024)

	readCtx, cancelRead := context.WithCancel(ctx)
	defer cancelRead()

	msgCh := make(chan wsMsg, 256)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(msgCh)
		for {
			if readCtx.Err() != nil {
				return
			}
			conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			_, raw, err := conn.ReadMessage()
			select {
			case <-readCtx.Done():
				return
			case msgCh <- wsMsg{raw: raw, err: err}:
			}
			if err != nil {
				return
			}
		}
	}()
	defer wg.Wait()

	snapCh := make(chan snapResult, 1)
	go func() {
		s, e := ds.fetchSnapshot(ctx)
		snapCh <- snapResult{snap: s, err: e}
	}()

	var pending []DepthEvent
	const pendingCap = 8192
	const pendingTrim = 4096

	snapshotApplied := false

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case sr := <-snapCh:
			if sr.err != nil {
				return fmt.Errorf("fetch snapshot: %w", sr.err)
			}
			ds.applySnapshot(sr.snap)
			lastUpd := sr.snap.LastUpdateID
			log.Printf("[depth-sync] snapshot loaded %s:%s lastUpdateId=%d bids=%d asks=%d",
				ds.symbol, ds.market, lastUpd, len(sr.snap.Bids), len(sr.snap.Asks))

			if err := ds.drainPending(pending, lastUpd); err != nil {
				return err
			}
			pending = nil
			snapshotApplied = true

		case m, ok := <-msgCh:
			if !ok {
				return fmt.Errorf("ws closed before snapshot/streaming")
			}
			if m.err != nil {
				return fmt.Errorf("ws read: %w", m.err)
			}

			var wm WSMessage
			if err := json.Unmarshal(m.raw, &wm); err != nil {
				continue
			}
			evt := wm.Data
			if evt.Symbol != ds.symbol {
				continue
			}

			if !snapshotApplied {
				pending = append(pending, evt)
				if len(pending) > pendingCap {
					pending = pending[len(pending)-pendingTrim:]
				}
				continue
			}

			// Streaming phase: stale-drop + sequence validation.
			if ds.isStale(evt, ds.orderBook.GetLastUpdateID()) {
				continue
			}
			if !ds.processEvent(evt) {
				return fmt.Errorf("sequence mismatch: firstU=%d lastU=%d prevU=%d lastUpd=%d",
					evt.FirstU, evt.LastU, evt.PrevU, ds.orderBook.GetLastUpdateID())
			}
		}
	}
}

func (ds *DepthSync) applySnapshot(snap *snapshotResponse) {
	bids := make([]PriceLevel, 0, len(snap.Bids))
	for _, pair := range snap.Bids {
		if len(pair) < 2 {
			continue
		}
		p, e1 := strconv.ParseFloat(pair[0], 64)
		q, e2 := strconv.ParseFloat(pair[1], 64)
		if e1 != nil || e2 != nil || p <= 0 {
			continue
		}
		bids = append(bids, PriceLevel{Price: p, Qty: q})
	}
	asks := make([]PriceLevel, 0, len(snap.Asks))
	for _, pair := range snap.Asks {
		if len(pair) < 2 {
			continue
		}
		p, e1 := strconv.ParseFloat(pair[0], 64)
		q, e2 := strconv.ParseFloat(pair[1], 64)
		if e1 != nil || e2 != nil || p <= 0 {
			continue
		}
		asks = append(asks, PriceLevel{Price: p, Qty: q})
	}
	ds.orderBook.SnapshotFromREST(snap.LastUpdateID, bids, asks)
}

// drainPending: drop stale, find first event, apply it unchecked, then validate rest.
func (ds *DepthSync) drainPending(pending []DepthEvent, lastUpd int64) error {
	if len(pending) == 0 {
		return nil
	}

	firstIdx := -1
	for i, evt := range pending {
		if ds.isStale(evt, lastUpd) {
			continue
		}
		if ds.isFirstEvent(evt, lastUpd) {
			firstIdx = i
			break
		}
		// Non-stale but not first-event-eligible — keep scanning (rare, but conservative).
	}

	if firstIdx == -1 {
		// No first event in buffer yet; streaming will catch it. Drop everything stale.
		// (Whatever survives stale-drop but is not first-event-eligible would fail validation
		// anyway, so dropping is safe.)
		return nil
	}

	first := pending[firstIdx]
	ds.orderBook.ApplyFirstEvent(first.LastU, first.Bids, first.Asks)

	// Apply the rest with normal validation.
	for _, evt := range pending[firstIdx+1:] {
		if ds.isStale(evt, ds.orderBook.GetLastUpdateID()) {
			continue
		}
		if !ds.processEvent(evt) {
			return fmt.Errorf("drain sequence mismatch: firstU=%d lastU=%d prevU=%d lastUpd=%d",
				evt.FirstU, evt.LastU, evt.PrevU, ds.orderBook.GetLastUpdateID())
		}
	}
	return nil
}

// isStale per Binance protocol:
//   futures: drop events where u < lastUpdateId
//   spot:    drop events where u < lastUpdateId+1   (i.e. u <= lastUpdateId)
func (ds *DepthSync) isStale(evt DepthEvent, lastUpdateId int64) bool {
	if ds.market == "futures" {
		return evt.LastU < lastUpdateId
	}
	return evt.LastU < lastUpdateId+1
}

func (ds *DepthSync) isFirstEvent(evt DepthEvent, lastUpdateId int64) bool {
	if ds.market == "futures" {
		return evt.FirstU <= lastUpdateId && evt.LastU >= lastUpdateId
	}
	return evt.FirstU <= lastUpdateId+1 && evt.LastU >= lastUpdateId+1
}

func (ds *DepthSync) processEvent(evt DepthEvent) bool {
	if ds.market == "futures" {
		return ds.orderBook.ApplyFuturesUpdate(evt.FirstU, evt.LastU, evt.PrevU, evt.Bids, evt.Asks)
	}
	return ds.orderBook.ApplySpotUpdate(evt.FirstU, evt.LastU, evt.Bids, evt.Asks)
}

type snapshotResponse struct {
	LastUpdateID int64       `json:"lastUpdateId"`
	Bids         [][2]string `json:"bids"`
	Asks         [][2]string `json:"asks"`
}

func (ds *DepthSync) fetchSnapshot(ctx context.Context) (*snapshotResponse, error) {
	var url string
	if ds.market == "futures" {
		// Binance USD-M futures: limit max = 1000.
		url = fmt.Sprintf("https://fapi.binance.com/fapi/v1/depth?symbol=%s&limit=1000", ds.symbol)
	} else {
		// Binance spot: limit max = 5000.
		url = fmt.Sprintf("https://api.binance.com/api/v3/depth?symbol=%s&limit=5000", ds.symbol)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var snap snapshotResponse
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		return nil, err
	}
	return &snap, nil
}

// wsRateSuffix maps DEPTH_WS_RATE_MS env to a valid stream suffix per market.
// Returns ("" for default cadence) or ("@<rate>ms" for non-default).
// Per Binance docs:
//   futures supports 100ms, 250ms (default), 500ms
//   spot supports    100ms, 1000ms (default)
func (ds *DepthSync) wsRateSuffix() string {
	raw := os.Getenv("DEPTH_WS_RATE_MS")
	if raw == "" {
		raw = "100" // default — fastest, supported by both markets
	}
	rate, err := strconv.Atoi(raw)
	if err != nil || rate <= 0 {
		log.Printf("[depth-sync] invalid DEPTH_WS_RATE_MS=%q, falling back to 100", raw)
		rate = 100
	}

	if ds.market == "futures" {
		switch rate {
		case 100:
			return "@100ms"
		case 250:
			return "" // default for futures
		case 500:
			return "@500ms"
		default:
			log.Printf("[depth-sync] DEPTH_WS_RATE_MS=%d not supported by futures (allowed 100/250/500), clamping to 500", rate)
			return "@500ms"
		}
	}

	// spot
	switch rate {
	case 100:
		return "@100ms"
	case 1000:
		return "" // default for spot
	default:
		log.Printf("[depth-sync] DEPTH_WS_RATE_MS=%d not supported by spot (allowed 100/1000), clamping to 100", rate)
		return "@100ms"
	}
}

func (ds *DepthSync) wsURL() string {
	symbol := toLower(ds.symbol)
	suffix := ds.wsRateSuffix()
	if ds.market == "futures" {
		return fmt.Sprintf("wss://fstream.binance.com/stream?streams=%s@depth%s", symbol, suffix)
	}
	return fmt.Sprintf("wss://stream.binance.com:9443/ws/%s@depth%s", symbol, suffix)
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}
