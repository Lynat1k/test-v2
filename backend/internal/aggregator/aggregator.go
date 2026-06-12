package aggregator

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/model"
	"github.com/procluster/procluster/internal/repository"
)

type Aggregator struct {
	repo    repository.MarketRepository
	rdb     *redis.Client
	configs map[string]aggregationCompressionConfig
	mu      sync.Mutex
}

type aggregationCompressionConfig struct {
	Symbol    string
	PriceTick float64
	BaseLevel float64
}

func New(repo repository.MarketRepository, rdb *redis.Client) *Aggregator {
	a := &Aggregator{
		repo:    repo,
		rdb:     rdb,
		configs: make(map[string]aggregationCompressionConfig),
	}

	a.configs["BTCUSDT:futures"] = aggregationCompressionConfig{
		Symbol:    "BTCUSDT",
		PriceTick: 0.1,
		BaseLevel: 25,
	}
	a.configs["BTCUSDT:spot"] = aggregationCompressionConfig{
		Symbol:    "BTCUSDT",
		PriceTick: 0.01,
		BaseLevel: 500,
	}

	return a
}

func (a *Aggregator) Run(ctx context.Context, trades <-chan model.Trade) {
	var currentCandleOpen time.Time

	flushTimer := time.NewTimer(time.Until(nextMinute()))
	defer flushTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-flushTimer.C:
			if !currentCandleOpen.IsZero() {
				if err := a.FlushCandle(ctx, "BTCUSDT", "futures", "1m", currentCandleOpen); err != nil {
					log.Printf("[aggregator] flush error: %v", err)
				}
			}
			flushTimer.Reset(time.Until(nextMinute()))
		case trade, ok := <-trades:
			if !ok {
				return
			}
			candleOpen := truncateToMinute(trade.Time)
			if candleOpen != currentCandleOpen {
				if !currentCandleOpen.IsZero() {
					if err := a.FlushCandle(ctx, "BTCUSDT", "futures", "1m", currentCandleOpen); err != nil {
						log.Printf("[aggregator] flush error: %v", err)
					}
				}
				currentCandleOpen = candleOpen
				flushTimer.Reset(time.Until(nextMinute()))
			}
			a.processTrade(trade)
		}
	}
}

func (a *Aggregator) processTrade(trade model.Trade) {
	candleOpen := truncateToMinute(trade.Time)
	config := a.getConfig("BTCUSDT", "futures")

	level := aggregation.CompressPrice(trade.Price, config.BaseLevel*config.PriceTick)
	side := aggregation.InterpretTrade(trade.IsBuyerMaker)
	volume := aggregation.TruncateVolume(trade.Qty)

	key := fmt.Sprintf("cluster:levels:%s:%s:1m:%d", "BTCUSDT", "futures", candleOpen.UnixMilli())

	field := fmt.Sprintf("%f", level)

	a.mu.Lock()
	defer a.mu.Unlock()

	existing, _ := a.rdb.HGet(context.Background(), key, field).Result()

	var bidVol, askVol float64
	if existing != "" {
		fmt.Sscanf(existing, "%f,%f", &bidVol, &askVol)
	}

	if side == model.SideSell {
		askVol += volume
	} else {
		bidVol += volume
	}

	a.rdb.HSet(context.Background(), key, field, fmt.Sprintf("%f,%f", bidVol, askVol))
	a.rdb.Expire(context.Background(), key, 2*time.Minute)

	metaKey := fmt.Sprintf("cluster:hot:%s:%s:1m:%d", "BTCUSDT", "futures", candleOpen.UnixMilli())
	a.rdb.HSet(context.Background(), metaKey,
		"symbol", "BTCUSDT",
		"timeframe", "1m",
		"candle_open", candleOpen.UnixMilli(),
		"last_trade_time", trade.Time.UnixMilli(),
	)
	a.rdb.Expire(context.Background(), metaKey, 2*time.Minute)
}

func (a *Aggregator) FlushCandle(ctx context.Context, symbol, market, timeframe string, candleOpen time.Time) error {
	config := a.getConfig(symbol, market)
	if config.BaseLevel == 0 {
		return fmt.Errorf("no config for %s:%s", symbol, market)
	}

	metaKey := fmt.Sprintf("cluster:hot:%s:%s:%s:%d", symbol, market, timeframe, candleOpen.UnixMilli())
	levelsKey := fmt.Sprintf("cluster:levels:%s:%s:%s:%d", symbol, market, timeframe, candleOpen.UnixMilli())

	fields, err := a.rdb.HGetAll(ctx, levelsKey).Result()
	if err != nil {
		return fmt.Errorf("get levels: %w", err)
	}

	if len(fields) == 0 {
		return nil
	}

	var trades []model.Trade
	tradeID := int64(0)
	for field, val := range fields {
		var priceLevel float64
		fmt.Sscanf(field, "%f", &priceLevel)

		var bidVol, askVol float64
		fmt.Sscanf(val, "%f,%f", &bidVol, &askVol)

		tradeID++
		trades = append(trades, model.Trade{
			Price:        priceLevel + config.PriceTick*config.BaseLevel/2,
			Qty:          bidVol,
			IsBuyerMaker: false,
			TradeID:      tradeID,
			Time:         candleOpen,
		})

		tradeID++
		trades = append(trades, model.Trade{
			Price:        priceLevel + config.PriceTick*config.BaseLevel/2,
			Qty:          askVol,
			IsBuyerMaker: true,
			TradeID:      tradeID,
			Time:         candleOpen,
		})
	}

	compressionConfig := aggregation.CompressionConfig{
		Symbol:    symbol,
		PriceTick: config.PriceTick,
		BaseLevel: config.BaseLevel,
		MaxLevels: 10,
	}

	rows := aggregation.CompressTrades(trades, compressionConfig)
	for i := range rows {
		rows[i].Symbol = symbol
		rows[i].Timeframe = timeframe
		rows[i].CandleOpen = candleOpen
	}

	if err := a.repo.InsertClusterBatch(ctx, rows); err != nil {
		return fmt.Errorf("insert cluster batch: %w", err)
	}

	if err := a.rollup(ctx, symbol, market, rows); err != nil {
		return fmt.Errorf("rollup: %w", err)
	}

	a.rdb.Del(ctx, levelsKey, metaKey)

	log.Printf("[aggregator] flushed candle %s %s %s at %v (%d rows)", symbol, market, timeframe, candleOpen, len(rows))
	return nil
}

func (a *Aggregator) rollup(ctx context.Context, symbol, market string, rows []model.ClusterRow) error {
	for _, tf := range []string{"1h", "4h", "1d"} {
		rollupRows := a.aggregateForTimeframe(rows, tf)
		for i := range rollupRows {
			rollupRows[i].BidVolume = aggregation.TruncateVolume(rollupRows[i].BidVolume)
			rollupRows[i].AskVolume = aggregation.TruncateVolume(rollupRows[i].AskVolume)
			rollupRows[i].Timeframe = tf
		}
		if len(rollupRows) > 0 {
			log.Printf("[rollup] inserting %d rows for %s %s", len(rollupRows), symbol, tf)
			if err := a.repo.InsertClusterBatch(ctx, rollupRows); err != nil {
				log.Printf("[rollup] ERROR inserting %s: %v", tf, err)
				return fmt.Errorf("insert rollup %s: %w", tf, err)
			}
			log.Printf("[rollup] OK %s: %d rows", tf, len(rollupRows))
		}
	}
	return nil
}

func (a *Aggregator) aggregateForTimeframe(rows []model.ClusterRow, tf string) []model.ClusterRow {
	buckets := make(map[float64]*model.ClusterRow)

	for _, row := range rows {
		existing, ok := buckets[row.PriceLevel]
		if !ok {
			existing = &model.ClusterRow{
				Symbol:      row.Symbol,
				Timeframe:   tf,
				CandleOpen:  row.CandleOpen,
				PriceLevel:  row.PriceLevel,
				Compression: row.Compression,
			}
			buckets[row.PriceLevel] = existing
		}
		existing.BidVolume += row.BidVolume
		existing.AskVolume += row.AskVolume
	}

	result := make([]model.ClusterRow, 0, len(buckets))
	for _, row := range buckets {
		result = append(result, *row)
	}
	return result
}

func (a *Aggregator) getConfig(symbol, market string) aggregationCompressionConfig {
	key := fmt.Sprintf("%s:%s", symbol, market)
	config, ok := a.configs[key]
	if !ok {
		return aggregationCompressionConfig{
			Symbol:    symbol,
			PriceTick: 0.1,
			BaseLevel: 25,
		}
	}
	return config
}

func truncateToMinute(t time.Time) time.Time {
	return t.Truncate(time.Minute)
}

func nextMinute() time.Time {
	now := time.Now()
	return now.Truncate(time.Minute).Add(time.Minute)
}
