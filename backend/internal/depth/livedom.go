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

// Pruning window — wider than the ±5% display filter so a sudden price move
// doesn't accidentally drop nearby levels.
const pruneRange = 0.10

func (b *LiveDOMBroadcaster) Run(ctx context.Context) {
	// Outbound cadence to frontend — DO NOT CHANGE without intent.
	outTicker := time.NewTicker(time.Second)
	defer outTicker.Stop()

	pruneTicker := time.NewTicker(30 * time.Second)
	defer pruneTicker.Stop()

	logTicker := time.NewTicker(60 * time.Second)
	defer logTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-outTicker.C:
			b.broadcastAll()
		case <-pruneTicker.C:
			b.pruneAll()
		case <-logTicker.C:
			b.logStats()
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

func (b *LiveDOMBroadcaster) pruneAll() {
	for _, ob := range b.books {
		center := ob.GetLastPrice()
		if center <= 0 {
			continue
		}
		ob.Prune(center, pruneRange)
	}
}

func (b *LiveDOMBroadcaster) logStats() {
	for key, ob := range b.books {
		center := ob.GetLastPrice()
		if center <= 0 {
			continue
		}
		s := ob.Stats()
		if s.Bids+s.Asks == 0 {
			continue
		}
		// coverage = max distance from center as % of center, taking the wider side.
		var below, above float64
		if s.MinPrice > 0 && s.MinPrice < center {
			below = (center - s.MinPrice) / center * 100
		}
		if s.MaxPrice > center {
			above = (s.MaxPrice - center) / center * 100
		}
		coverage := below
		if above > coverage {
			coverage = above
		}
		log.Printf("[depth-stats] %s bids=%d asks=%d range=[%.2f..%.2f] center=%.2f coverage=±%.2f%%",
			key, s.Bids, s.Asks, s.MinPrice, s.MaxPrice, center, coverage)
	}
}
