package depth

import (
	"context"
	"log"
	"time"

	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/aggregator"
	"github.com/procluster/procluster/internal/config"
	"github.com/procluster/procluster/internal/model"
	"github.com/procluster/procluster/internal/repository"
)

type Snapshotter struct {
	repo    repository.MarketRepository
	books   map[string]*OrderBook
	closeCh <-chan aggregator.CandleCloseSignal
	configs map[string]config.SymbolConfig
}

func NewSnapshotter(
	repo repository.MarketRepository,
	books map[string]*OrderBook,
	closeCh <-chan aggregator.CandleCloseSignal,
	configs map[string]config.SymbolConfig,
) *Snapshotter {
	return &Snapshotter{
		repo:    repo,
		books:   books,
		closeCh: closeCh,
		configs: configs,
	}
}

func (s *Snapshotter) Run(ctx context.Context) {
	spotTicker := time.NewTicker(time.Second)
	defer spotTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case sig, ok := <-s.closeCh:
			if !ok {
				return
			}
			if sig.Market == "futures" {
				if err := s.takeSnapshot(sig); err != nil {
					log.Printf("[snapshotter] error %s:%s: %v", sig.Symbol, sig.Market, err)
				}
			}
		case <-spotTicker.C:
			now := time.Now()
			if now.Minute()%15 == 0 && now.Second() == 0 {
				s.takeSpotSnapshot("BTCUSDT")
			}
		}
	}
}

func (s *Snapshotter) takeSpotSnapshot(symbol string) {
	key := symbol + ":spot"
	ob, ok := s.books[key]
	if !ok {
		return
	}

	cfg, ok := s.configs[key]
	if !ok {
		return
	}

	centerPrice := ob.GetLastPrice()
	if centerPrice <= 0 {
		return
	}

	levels := ob.GetAggregatedLevels(centerPrice, 0.05, cfg.BaseLevel*cfg.PriceTick)
	if len(levels) == 0 {
		return
	}

	snapshotTS := time.Now().Truncate(time.Minute)
	rows := make([]model.DOMRow, 0, len(levels))
	for _, l := range levels {
		rows = append(rows, model.DOMRow{
			Symbol:      symbol,
			SnapshotTS:  snapshotTS,
			PriceLevel:  l.PriceLevel,
			BidSize:     l.BidSize,
			AskSize:     l.AskSize,
			Compression: uint16(cfg.BaseLevel),
		})
	}

	if err := s.repo.InsertDOMSnapshotBatch(context.Background(), rows, cfg.DOMTable()); err != nil {
		log.Printf("[snapshotter] insert spot DOM error: %v", err)
		return
	}
	log.Printf("[snapshotter] spot DOM snapshot %s at %v (%d levels)", symbol, snapshotTS, len(rows))
}

func (s *Snapshotter) takeSnapshot(sig aggregator.CandleCloseSignal) error {
	key := sig.Symbol + ":" + sig.Market
	ob, ok := s.books[key]
	if !ok {
		return nil
	}

	cfg, ok := s.configs[key]
	if !ok {
		return nil
	}

	centerPrice := ob.GetLastPrice()
	if centerPrice <= 0 {
		return nil
	}

	baseStep := cfg.BaseLevel * cfg.PriceTick
	levels := ob.GetAggregatedLevels(centerPrice, 0.05, baseStep)
	if len(levels) == 0 {
		return nil
	}

	snapshotTS := sig.CandleOpen.Add(time.Minute)
	rows := make([]model.DOMRow, 0, len(levels))
	for _, l := range levels {
		rows = append(rows, model.DOMRow{
			Symbol:      sig.Symbol,
			SnapshotTS:  snapshotTS,
			PriceLevel:  l.PriceLevel,
			BidSize:     aggregation.TruncateVolume(l.BidSize),
			AskSize:     aggregation.TruncateVolume(l.AskSize),
			Compression: uint16(cfg.BaseLevel),
		})
	}

	if err := s.repo.InsertDOMSnapshotBatch(context.Background(), rows, cfg.DOMTable()); err != nil {
		return err
	}
	log.Printf("[snapshotter] DOM snapshot %s:%s at %v (%d levels)", sig.Symbol, sig.Market, snapshotTS, len(rows))
	return nil
}
