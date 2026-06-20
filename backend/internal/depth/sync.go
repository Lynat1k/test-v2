package depth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
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

func (ds *DepthSync) connectAndSync(ctx context.Context) error {
	snapRaw, err := ds.fetchSnapshot(ctx)
	if err != nil {
		return fmt.Errorf("fetch snapshot: %w", err)
	}

	bids := make([]PriceLevel, len(snapRaw.Bids))
	for i, pair := range snapRaw.Bids {
		p, _ := strconv.ParseFloat(pair[0], 64)
		q, _ := strconv.ParseFloat(pair[1], 64)
		bids[i] = PriceLevel{Price: p, Qty: q}
	}
	asks := make([]PriceLevel, len(snapRaw.Asks))
	for i, pair := range snapRaw.Asks {
		p, _ := strconv.ParseFloat(pair[0], 64)
		q, _ := strconv.ParseFloat(pair[1], 64)
		asks[i] = PriceLevel{Price: p, Qty: q}
	}

	ds.orderBook.SnapshotFromREST(snapRaw.LastUpdateID, bids, asks)
	log.Printf("[depth-sync] snapshot loaded %s:%s lastUpdateId=%d bids=%d asks=%d",
		ds.symbol, ds.market, snapRaw.LastUpdateID, len(bids), len(asks))

	wsURL := ds.wsURL()
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("ws dial: %w", err)
	}
	defer conn.Close()

	conn.SetReadLimit(2 * 1024 * 1024) // 2 MB — enough for large Binance diff bursts

	done := make(chan error, 1)
	go func() {
		done <- ds.readLoop(ctx, conn)
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		return err
	}
}

func (ds *DepthSync) readLoop(ctx context.Context, conn *websocket.Conn) error {
	var pending []DepthEvent
	snapshotApplied := false

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("ws read: %w", err)
		}

		var wsMsg WSMessage
		if err := json.Unmarshal(raw, &wsMsg); err != nil {
			log.Printf("[depth-sync] invalid message: %v", err)
			continue
		}

		evt := wsMsg.Data
		if evt.Symbol != ds.symbol {
			continue
		}

		if !snapshotApplied {
			pending = append(pending, evt)
			lastUpd := ds.orderBook.GetLastUpdateID()

			for _, p := range pending {
				if ds.isFirstEvent(p, lastUpd) {
					snapshotApplied = true
					for _, pp := range pending {
						ds.processEvent(pp)
					}
					pending = nil
					break
				}
			}

			if !snapshotApplied && len(pending) > 1000 {
				pending = pending[len(pending)-500:]
			}
			continue
		}

		if !ds.processEvent(evt) {
			return fmt.Errorf("sequence mismatch: pu=%d expected=%d", evt.PrevU, ds.orderBook.GetLastUpdateID())
		}
	}
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
		url = fmt.Sprintf("https://fapi.binance.com/fapi/v1/depth?symbol=%s&limit=1000", ds.symbol)
	} else {
		url = fmt.Sprintf("https://api.binance.com/api/v3/depth?symbol=%s&limit=1000", ds.symbol)
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

	bids := make([]PriceLevel, 0, len(snap.Bids))
	for _, pair := range snap.Bids {
		if len(pair) < 2 {
			continue
		}
		p, err1 := strconv.ParseFloat(pair[0], 64)
		q, err2 := strconv.ParseFloat(pair[1], 64)
		if err1 != nil || err2 != nil || p <= 0 {
			continue
		}
		bids = append(bids, PriceLevel{Price: p, Qty: q})
	}

	asks := make([]PriceLevel, 0, len(snap.Asks))
	for _, pair := range snap.Asks {
		if len(pair) < 2 {
			continue
		}
		p, err1 := strconv.ParseFloat(pair[0], 64)
		q, err2 := strconv.ParseFloat(pair[1], 64)
		if err1 != nil || err2 != nil || p <= 0 {
			continue
		}
		asks = append(asks, PriceLevel{Price: p, Qty: q})
	}

	snap.Bids = nil
	snap.Asks = nil

	result := &snapshotResponse{
		LastUpdateID: snap.LastUpdateID,
		Bids:         make([][2]string, len(bids)),
		Asks:         make([][2]string, len(asks)),
	}
	for i, b := range bids {
		result.Bids[i] = [2]string{strconv.FormatFloat(b.Price, 'f', -1, 64), strconv.FormatFloat(b.Qty, 'f', -1, 64)}
	}
	for i, a := range asks {
		result.Asks[i] = [2]string{strconv.FormatFloat(a.Price, 'f', -1, 64), strconv.FormatFloat(a.Qty, 'f', -1, 64)}
	}

	return result, nil
}

func (ds *DepthSync) wsURL() string {
	symbol := ds.symbol
	if ds.market == "futures" {
		return fmt.Sprintf("wss://fstream.binance.com/stream?streams=%s@depth", toLower(symbol))
	}
	return fmt.Sprintf("wss://stream.binance.com:9443/ws/%s@depth", toLower(symbol))
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
