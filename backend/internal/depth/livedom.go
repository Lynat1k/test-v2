package depth

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/procluster/procluster/internal/config"
)

type HubBroadcaster interface {
	Broadcast(channelKey string, data []byte)
}

type LiveDOMMessage struct {
	Type   string      `json:"type"`
	Symbol string      `json:"symbol"`
	Market string      `json:"market"`
	Data   LiveDOMData `json:"data"`
}

type LiveDOMData struct {
	LastPrice float64    `json:"lastPrice"`
	Levels    []DOMLevel `json:"levels"`
}

type LiveDOMBroadcaster struct {
	hub     HubBroadcaster
	books   map[string]*OrderBook
	configs map[string]config.SymbolConfig
}

func NewLiveDOMBroadcaster(
	hub HubBroadcaster,
	books map[string]*OrderBook,
	configs map[string]config.SymbolConfig,
) *LiveDOMBroadcaster {
	return &LiveDOMBroadcaster{
		hub:     hub,
		books:   books,
		configs: configs,
	}
}

func (b *LiveDOMBroadcaster) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.broadcastAll()
		}
	}
}

func (b *LiveDOMBroadcaster) broadcastAll() {
	for key, ob := range b.books {
		cfg, ok := b.configs[key]
		if !ok {
			continue
		}

		centerPrice := ob.GetLastPrice()
		if centerPrice <= 0 {
			continue
		}

		baseStep := cfg.BaseLevel * cfg.PriceTick
		levels := ob.GetAggregatedLevels(centerPrice, 0.05, baseStep)

		msg := LiveDOMMessage{
			Type:   "dom_update",
			Symbol: cfg.Symbol,
			Market: cfg.Market,
			Data: LiveDOMData{
				LastPrice: centerPrice,
				Levels:    levels,
			},
		}

		data, err := json.Marshal(msg)
		if err != nil {
			log.Printf("[livedom] marshal error: %v", err)
			continue
		}

		channelKey := "dom:" + cfg.Symbol + ":" + cfg.Market
		b.hub.Broadcast(channelKey, data)
	}
}
