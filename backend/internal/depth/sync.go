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

// parseDepthMessage handles BOTH Binance WS formats:
//   - Combined-stream (/stream?streams=...) wraps payload as {"stream":...,"data":{...}}
//   - Single-stream (/ws/...) sends the depthUpdate object flat
// Tries combined first; if Data.Symbol is empty (flat payload — wrapper parses but
// fields are zero) falls back to unmarshaling the raw bytes as DepthEvent directly.
func parseDepthMessage(raw []byte) (DepthEvent, bool) {
	var wm WSMessage
	if err := json.Unmarshal(raw, &wm); err == nil && wm.Data.Symbol != "" {
		return wm.Data, true
	}
	var evt DepthEvent
	if err := json.Unmarshal(raw, &evt); err != nil {
		return DepthEvent{}, false
	}
	return evt, evt.Symbol != ""
}

type DepthSync struct {
	symbol    string
	market    string
	orderBook *OrderBook
	cfg       aggregation.CompressionConfig
	debug     bool
}

func NewDepthSync(symbol, market string, ob *OrderBook, cfg aggregation.CompressionConfig) *DepthSync {
	return &DepthSync{
		symbol:    symbol,
		market:    market,
		orderBook: ob,
		cfg:       cfg,
		debug:     os.Getenv("DEPTH_DEBUG") != "",
	}
}

// debugf prints [depth-debug] lines only when env DEPTH_DEBUG is set (any non-empty value).
// Used for one-shot diagnostics during a regression — does not spam in production.
func (ds *DepthSync) debugf(format string, args ...interface{}) {
	if !ds.debug {
		return
	}
	log.Printf("[depth-debug] "+format, args...)
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
//
// If drainPending does NOT find the first event in the buffer, needsFirstApply
// is set; the first non-stale streaming event is then applied via
// ApplyFirstEvent instead of processEvent. This is the path that handles the
// common case where the buffer is empty or contained only stale events.
//
// Diagnostic [depth-debug] logging is gated behind env DEPTH_DEBUG (any
// non-empty value). Off in normal operation.
func (ds *DepthSync) connectAndSync(ctx context.Context) error {
	wsURL := ds.wsURL()
	ds.debugf("%s:%s dialing %s", ds.symbol, ds.market, wsURL)
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("ws dial: %w", err)
	}
	defer conn.Close()
	conn.SetReadLimit(2 * 1024 * 1024)
	ds.debugf("%s:%s dialed ok, starting read loop", ds.symbol, ds.market)

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

	ds.debugf("%s:%s fetching snapshot via REST", ds.symbol, ds.market)
	snapCh := make(chan snapResult, 1)
	go func() {
		s, e := ds.fetchSnapshot(ctx)
		snapCh <- snapResult{snap: s, err: e}
	}()

	var pending []DepthEvent
	const pendingCap = 8192
	const pendingTrim = 4096

	snapshotApplied := false

	// Diagnostic counters — logged every 10 seconds.
	var (
		wsMsgs          uint64
		wsErrs          uint64
		wsBytes         uint64
		droppedSymbol   uint64
		dropSymExamples int
		staleSkipped    uint64
		applied         uint64
		bufferedPre     uint64 // counted while !snapshotApplied
		firstEventLogged bool
	)
	// Set by drain branch — if drainPending did NOT find first event in pending,
	// the first streaming event must be applied via ApplyFirstEvent (unchecked)
	// instead of processEvent (which validates pu/U+1 against snapshot lastUpd
	// and would always reject it).
	needsFirstApply := false
	diagTicker := time.NewTicker(10 * time.Second)
	defer diagTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case <-diagTicker.C:
			ds.debugf("%s:%s ws_msgs=%d errs=%d bytes=%d drop_sym=%d stale=%d applied=%d pre_buf=%d snap_applied=%v pending=%d",
				ds.symbol, ds.market, wsMsgs, wsErrs, wsBytes, droppedSymbol, staleSkipped, applied, bufferedPre, snapshotApplied, len(pending))

		case sr := <-snapCh:
			if sr.err != nil {
				return fmt.Errorf("fetch snapshot: %w", sr.err)
			}
			ds.applySnapshot(sr.snap)
			lastUpd := sr.snap.LastUpdateID
			log.Printf("[depth-sync] snapshot loaded %s:%s lastUpdateId=%d bids=%d asks=%d",
				ds.symbol, ds.market, lastUpd, len(sr.snap.Bids), len(sr.snap.Asks))
			ds.debugf("%s:%s snapshot applied, pending=%d, draining...", ds.symbol, ds.market, len(pending))

			drainStats, derr := ds.drainPendingDiag(pending, lastUpd)
			ds.debugf("%s:%s drain: found_first=%v dropped_stale=%d applied_rest=%d",
				ds.symbol, ds.market, drainStats.foundFirst, drainStats.droppedStale, drainStats.appliedRest)
			if derr != nil {
				return derr
			}
			pending = nil
			snapshotApplied = true
			needsFirstApply = !drainStats.foundFirst
			ds.debugf("%s:%s entering streaming phase (needs_first_apply=%v)",
				ds.symbol, ds.market, needsFirstApply)

		case m, ok := <-msgCh:
			if !ok {
				return fmt.Errorf("ws closed before snapshot/streaming")
			}
			if m.err != nil {
				wsErrs++
				return fmt.Errorf("ws read: %w", m.err)
			}
			wsMsgs++
			wsBytes += uint64(len(m.raw))

			evt, okParse := parseDepthMessage(m.raw)
			if !okParse {
				droppedSymbol++
				if dropSymExamples < 3 {
					ds.debugf("%s:%s parse failed or empty symbol (raw_len=%d sample %d/3)",
						ds.symbol, ds.market, len(m.raw), dropSymExamples+1)
					dropSymExamples++
				}
				continue
			}
			if evt.Symbol != ds.symbol {
				droppedSymbol++
				if dropSymExamples < 3 {
					ds.debugf("%s:%s dropped foreign symbol=%q (sample %d/3)",
						ds.symbol, ds.market, evt.Symbol, dropSymExamples+1)
					dropSymExamples++
				}
				continue
			}

			if !snapshotApplied {
				bufferedPre++
				pending = append(pending, evt)
				if len(pending) > pendingCap {
					pending = pending[len(pending)-pendingTrim:]
				}
				continue
			}

			// Streaming phase.
			if !firstEventLogged {
				ds.debugf("%s:%s first streaming event U=%d u=%d pu=%d lastUpd=%d bids_n=%d asks_n=%d",
					ds.symbol, ds.market, evt.FirstU, evt.LastU, evt.PrevU, ds.orderBook.GetLastUpdateID(), len(evt.Bids), len(evt.Asks))
				firstEventLogged = true
			}
			if ds.isStale(evt, ds.orderBook.GetLastUpdateID()) {
				staleSkipped++
				continue
			}
			// If drainPending didn't find the first event, the first non-stale
			// streaming event IS the first event — apply unchecked via ApplyFirstEvent.
			// Then continue with normal pu/U+1 validation.
			if needsFirstApply {
				if !ds.isFirstEvent(evt, ds.orderBook.GetLastUpdateID()) {
					// Defensive: shouldn't happen after stale-drop. Treat as mismatch.
					return fmt.Errorf("first streaming event not in overlap range: firstU=%d lastU=%d lastUpd=%d",
						evt.FirstU, evt.LastU, ds.orderBook.GetLastUpdateID())
				}
				ds.orderBook.ApplyFirstEvent(evt.LastU, evt.Bids, evt.Asks)
				needsFirstApply = false
				applied++
				ds.debugf("%s:%s ApplyFirstEvent done in streaming, lastUpd=%d",
					ds.symbol, ds.market, ds.orderBook.GetLastUpdateID())
				continue
			}
			if !ds.processEvent(evt) {
				return fmt.Errorf("sequence mismatch: firstU=%d lastU=%d prevU=%d lastUpd=%d",
					evt.FirstU, evt.LastU, evt.PrevU, ds.orderBook.GetLastUpdateID())
			}
			applied++
		}
	}
}

type drainDiag struct {
	foundFirst   bool
	droppedStale int
	appliedRest  int
}

// drainPendingDiag wraps drainPending with counters for diagnostic logging.
// Logic is identical to drainPending — same stale-drop, first-event detection,
// ApplyFirstEvent for the first, normal validation for the rest.
func (ds *DepthSync) drainPendingDiag(pending []DepthEvent, lastUpd int64) (drainDiag, error) {
	var d drainDiag
	if len(pending) == 0 {
		return d, nil
	}

	firstIdx := -1
	for i, evt := range pending {
		if ds.isStale(evt, lastUpd) {
			d.droppedStale++
			continue
		}
		if ds.isFirstEvent(evt, lastUpd) {
			firstIdx = i
			break
		}
	}

	if firstIdx == -1 {
		return d, nil
	}

	d.foundFirst = true
	first := pending[firstIdx]
	ds.orderBook.ApplyFirstEvent(first.LastU, first.Bids, first.Asks)

	for _, evt := range pending[firstIdx+1:] {
		if ds.isStale(evt, ds.orderBook.GetLastUpdateID()) {
			d.droppedStale++
			continue
		}
		if !ds.processEvent(evt) {
			return d, fmt.Errorf("drain sequence mismatch: firstU=%d lastU=%d prevU=%d lastUpd=%d",
				evt.FirstU, evt.LastU, evt.PrevU, ds.orderBook.GetLastUpdateID())
		}
		d.appliedRest++
	}
	return d, nil
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
	// Use single-stream paths for BOTH markets. Combined-stream paths
	// (/stream?streams=...) wrap the payload in {stream, data}; single-stream
	// (/ws/<stream>) sends the depthUpdate object flat. We use single for both
	// so parseDepthMessage has a consistent payload shape.
	if ds.market == "futures" {
		return fmt.Sprintf("wss://fstream.binance.com/ws/%s@depth%s", symbol, suffix)
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
