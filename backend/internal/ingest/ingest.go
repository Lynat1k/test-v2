package ingest

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/procluster/procluster/internal/model"
)

type IngestWorker struct {
	symbol    string
	market    MarketType
	client    *WSClient
	gapFiller *GapFiller
	tradesCh  chan model.Trade
	mu        sync.Mutex
	lastID    int64
}

func New(symbol string, market MarketType, tradesCh chan model.Trade) *IngestWorker {
	var url string
	if market == MarketFutures {
		url = fmt.Sprintf("wss://fstream.binance.com/market/ws/%s@aggTrade", toLower(symbol))
	} else {
		url = fmt.Sprintf("wss://stream.binance.com:9443/ws/%s@trade", toLower(symbol))
	}

	w := &IngestWorker{
		symbol:    symbol,
		market:    market,
		client:    NewWSClient(url, market),
		gapFiller: NewGapFiller(),
		tradesCh:  tradesCh,
	}

	w.client.SetOnMessage(w.handleMessage)
	return w
}

func (w *IngestWorker) Run(ctx context.Context) {
	log.Printf("[ingest] starting worker for %s %s", w.symbol, w.market)
	w.client.Run(ctx)
}

func (w *IngestWorker) handleMessage(data []byte) {
	trade, err := ParseMessage(data, w.market)
	if err != nil {
		log.Printf("[ingest] parse error: %v", err)
		return
	}

	w.mu.Lock()
	if w.lastID > 0 && trade.TradeID <= w.lastID {
		w.mu.Unlock()
		return
	}
	w.lastID = trade.TradeID
	w.mu.Unlock()

	w.tradesCh <- *trade
}

func (w *IngestWorker) fillGap(ctx context.Context, lastID int64) {
	var trades []model.Trade
	var err error

	if w.market == MarketFutures {
		trades, err = w.gapFiller.FillGapFutures(ctx, w.symbol, lastID)
	} else {
		trades, err = w.gapFiller.FillGapSpot(ctx, w.symbol, lastID)
	}

	if err != nil {
		log.Printf("[ingest] gap fill error: %v", err)
		return
	}

	log.Printf("[ingest] filled gap: %d trades (from ID %d)", len(trades), lastID+1)
	for _, t := range trades {
		w.tradesCh <- t
	}
}

func (w *IngestWorker) LastTradeID() int64 {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.lastID
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
