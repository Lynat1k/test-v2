package api

import (
	"context"
	"encoding/json"
	"log"

	"github.com/procluster/procluster/internal/aggregator"
)

type CandleUpdateMsg struct {
	Type   string      `json:"type"`
	Data   interface{} `json:"data"`
	Symbol string      `json:"symbol"`
}

func (h *Hub) ListenToAggregator(ctx context.Context, updates <-chan aggregator.CandleUpdate) {
	for {
		select {
		case <-ctx.Done():
			return
		case update, ok := <-updates:
			if !ok {
				return
			}
			channelKey := buildChannelKey(update.Symbol, update.Market, update.Timeframe)
			if !h.HasSubscribers(channelKey) {
				continue
			}
			msg := CandleUpdateMsg{
				Type:   "candle_update",
				Symbol: update.Symbol,
				Data:   update,
			}
			data, err := json.Marshal(msg)
			if err != nil {
				log.Printf("[hub] marshal candle update: %v", err)
				continue
			}
			h.Broadcast(channelKey, data)
		}
	}
}

func buildChannelKey(symbol, market, timeframe string) string {
	return symbol + ":" + market + ":" + timeframe
}
