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

type LastPriceSetter interface {
	SetLastPrice(price float64)
}

type Aggregator struct {
	repo          repository.MarketRepository
	rdb           *redis.Client
	configs       map[string]aggregationCompressionConfig
	orderBooks    map[string]LastPriceSetter
	mu            sync.Mutex
	UpdatesCh     chan<- CandleUpdate
	CandleCloseCh chan<- CandleCloseSignal
}

type CandleLevel struct {
	PriceLevel float64 `json:"priceLevel"`
	BidVolume  float64 `json:"bidVolume"`
	AskVolume  float64 `json:"askVolume"`
}

type CandleCloseSignal struct {
	Symbol     string
	Market     string
	Timeframe  string
	CandleOpen time.Time
}

type CandleUpdate struct {
	Symbol      string        `json:"symbol"`
	Market      string        `json:"market"`
	Timeframe   string        `json:"timeframe"`
	CandleOpen  int64         `json:"candleOpen"`
	Open        float64       `json:"open"`
	High        float64       `json:"high"`
	Low         float64       `json:"low"`
	Close       float64       `json:"close"`
	TotalVolume float64       `json:"totalVolume"`
	TradesCount uint64        `json:"tradesCount"`
	Levels      []CandleLevel `json:"levels"`
}

type aggregationCompressionConfig struct {
	Symbol    string
	PriceTick float64
	BaseLevel float64
}

type liveCandle struct {
	open        float64
	high        float64
	low         float64
	close       float64
	totalVolume float64
	tradesCount uint64
}

type candleState struct {
	currentCandleOpen time.Time
	live              liveCandle
	lastUpdateTime    time.Time
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

func (a *Aggregator) SetUpdatesCh(ch chan<- CandleUpdate) {
	a.UpdatesCh = ch
}

func (a *Aggregator) SetCandleCloseCh(ch chan<- CandleCloseSignal) {
	a.CandleCloseCh = ch
}

func (a *Aggregator) SetOrderBooks(books map[string]LastPriceSetter) {
	a.orderBooks = books
}

func BookKey(symbol, market string) string {
	return symbol + ":" + market
}

func (a *Aggregator) Run(ctx context.Context, trades <-chan model.Trade) {
	states := make(map[string]*candleState)
	flushTimer := time.NewTimer(time.Until(nextMinute()))
	defer flushTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-flushTimer.C:
			now := time.Now()
			for key, st := range states {
				if !st.currentCandleOpen.IsZero() {
					symbol, market := splitBookKey(key)
					if err := a.FlushCandle(ctx, symbol, market, "1m", st.currentCandleOpen); err != nil {
						log.Printf("[aggregator] flush error %s: %v", key, err)
					}
				}
				st.currentCandleOpen = time.Time{}
				st.live = liveCandle{}
				st.lastUpdateTime = time.Time{}
				_ = now
			}
			flushTimer.Reset(time.Until(nextMinute()))
		case trade, ok := <-trades:
			if !ok {
				return
			}
			key := BookKey(trade.Symbol, trade.Market)
			st, exists := states[key]
			if !exists {
				st = &candleState{}
				states[key] = st
			}

			candleOpen := truncateToMinute(trade.Time)
			if candleOpen != st.currentCandleOpen {
				if !st.currentCandleOpen.IsZero() {
					if err := a.FlushCandle(ctx, trade.Symbol, trade.Market, "1m", st.currentCandleOpen); err != nil {
						log.Printf("[aggregator] flush error %s: %v", key, err)
					}
				}
				st.currentCandleOpen = candleOpen
				st.live = liveCandle{}
				st.lastUpdateTime = time.Time{}
			}
			a.processTrade(trade, &st.live, &st.lastUpdateTime)
		}
	}
}

func (a *Aggregator) processTrade(trade model.Trade, live *liveCandle, lastUpdateTime *time.Time) {
	candleOpen := truncateToMinute(trade.Time)
	config := a.getConfig(trade.Symbol, trade.Market)

	if ob, ok := a.orderBooks[BookKey(trade.Symbol, trade.Market)]; ok {
		ob.SetLastPrice(trade.Price)
	}

	level := aggregation.CompressPrice(trade.Price, config.BaseLevel*config.PriceTick)
	side := aggregation.InterpretTrade(trade.IsBuyerMaker)
	volume := aggregation.TruncateVolume(trade.Qty)

	key := fmt.Sprintf("cluster:levels:%s:%s:1m:%d", trade.Symbol, trade.Market, candleOpen.UnixMilli())

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

	metaKey := fmt.Sprintf("cluster:hot:%s:%s:1m:%d", trade.Symbol, trade.Market, candleOpen.UnixMilli())

	firstPrice, _ := a.rdb.HGet(context.Background(), metaKey, "first_price").Float64()
	firstTime, _ := a.rdb.HGet(context.Background(), metaKey, "first_trade_time").Int64()
	lastPrice, _ := a.rdb.HGet(context.Background(), metaKey, "last_price").Float64()
	lastTime, _ := a.rdb.HGet(context.Background(), metaKey, "last_trade_time").Int64()

	tradeTimeMs := trade.Time.UnixMilli()

	if firstPrice == 0 || tradeTimeMs < firstTime || (tradeTimeMs == firstTime && trade.TradeID < firstTime) {
		a.rdb.HSet(context.Background(), metaKey, "first_price", trade.Price, "first_trade_time", tradeTimeMs)
	}
	if lastPrice == 0 || tradeTimeMs > lastTime || (tradeTimeMs == lastTime && trade.TradeID > lastTime) {
		a.rdb.HSet(context.Background(), metaKey, "last_price", trade.Price, "last_trade_time", tradeTimeMs)
	}

	a.rdb.HSet(context.Background(), metaKey,
		"symbol", trade.Symbol,
		"timeframe", "1m",
		"candle_open", candleOpen.UnixMilli(),
		"last_trade_time", tradeTimeMs,
	)
	a.rdb.Expire(context.Background(), metaKey, 2*time.Minute)

	live.close = trade.Price
	live.totalVolume += volume
	live.tradesCount++
	if live.open == 0 {
		live.open = trade.Price
	}
	if trade.Price > live.high || live.high == 0 {
		live.high = trade.Price
	}
	if trade.Price < live.low || live.low == 0 {
		live.low = trade.Price
	}

	if a.UpdatesCh != nil && time.Since(*lastUpdateTime) >= 200*time.Millisecond {
		*lastUpdateTime = time.Now()

		levels := a.readLevelsFromRedis(key)

		select {
		case a.UpdatesCh <- CandleUpdate{
			Symbol:      trade.Symbol,
			Market:      trade.Market,
			Timeframe:   "1m",
			CandleOpen:  candleOpen.UnixMilli(),
			Open:        live.open,
			High:        live.high,
			Low:         live.low,
			Close:       live.close,
			TotalVolume: live.totalVolume,
			TradesCount: live.tradesCount,
			Levels:      levels,
		}:
		default:
		}
	}
}

func (a *Aggregator) FlushCandle(ctx context.Context, symbol, market, timeframe string, candleOpen time.Time) error {
	config := a.getConfig(symbol, market)
	if config.BaseLevel == 0 {
		return fmt.Errorf("no config for %s:%s", symbol, market)
	}

	metaKey := fmt.Sprintf("cluster:hot:%s:%s:%s:%d", symbol, market, timeframe, candleOpen.UnixMilli())
	levelsKey := fmt.Sprintf("cluster:levels:%s:%s:%s:%d", symbol, market, timeframe, candleOpen.UnixMilli())

	openPrice, _ := a.rdb.HGet(ctx, metaKey, "first_price").Float64()
	closePrice, _ := a.rdb.HGet(ctx, metaKey, "last_price").Float64()

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
		rows[i].OpenPrice = openPrice
		rows[i].ClosePrice = closePrice
	}

	if err := a.repo.InsertClusterBatch(ctx, rows, tableForMarket(market)); err != nil {
		return fmt.Errorf("insert cluster batch: %w", err)
	}

	if err := a.rollup(ctx, symbol, market, rows); err != nil {
		return fmt.Errorf("rollup: %w", err)
	}

	a.rdb.Del(ctx, levelsKey, metaKey)

	if a.CandleCloseCh != nil {
		select {
		case a.CandleCloseCh <- CandleCloseSignal{
			Symbol:     symbol,
			Market:     market,
			Timeframe:  timeframe,
			CandleOpen: candleOpen,
		}:
		default:
		}
	}

	log.Printf("[aggregator] flushed candle %s %s %s at %v (%d rows, open=%.2f close=%.2f)", symbol, market, timeframe, candleOpen, len(rows), openPrice, closePrice)
	return nil
}

func (a *Aggregator) rollup(ctx context.Context, symbol, market string, rows []model.ClusterRow) error {
	rollupRows := aggregation.Rollup(rows)

	buckets := make(map[string][]model.ClusterRow)
	for _, r := range rollupRows {
		buckets[r.Timeframe] = append(buckets[r.Timeframe], r)
	}

	for tf, tfRows := range buckets {
		if len(tfRows) > 0 {
			log.Printf("[rollup] inserting %d rows for %s %s %s", len(tfRows), symbol, market, tf)
			if err := a.repo.InsertClusterBatch(ctx, tfRows, tableForMarket(market)); err != nil {
				log.Printf("[rollup] ERROR inserting %s %s %s: %v", symbol, market, tf, err)
				return fmt.Errorf("insert rollup %s: %w", tf, err)
			}
			log.Printf("[rollup] OK %s %s %s: %d rows", symbol, market, tf, len(tfRows))
		}
	}
	return nil
}

func (a *Aggregator) readLevelsFromRedis(key string) []CandleLevel {
	fields, err := a.rdb.HGetAll(context.Background(), key).Result()
	if err != nil || len(fields) == 0 {
		return nil
	}

	levels := make([]CandleLevel, 0, len(fields))
	for field, val := range fields {
		var priceLevel float64
		fmt.Sscanf(field, "%f", &priceLevel)

		var bidVol, askVol float64
		fmt.Sscanf(val, "%f,%f", &bidVol, &askVol)

		levels = append(levels, CandleLevel{
			PriceLevel: priceLevel,
			BidVolume:  bidVol,
			AskVolume:  askVol,
		})
	}
	return levels
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

func tableForMarket(market string) string {
	if market == "spot" {
		return "clusters_spot"
	}
	return "clusters_futures"
}

func splitBookKey(key string) (string, string) {
	for i := 0; i < len(key); i++ {
		if key[i] == ':' {
			return key[:i], key[i+1:]
		}
	}
	return key, ""
}

func truncateToMinute(t time.Time) time.Time {
	return t.Truncate(time.Minute)
}

func nextMinute() time.Time {
	now := time.Now()
	return now.Truncate(time.Minute).Add(time.Minute)
}
