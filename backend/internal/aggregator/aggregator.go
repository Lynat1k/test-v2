package aggregator

import (
	"context"
	"fmt"
	"log"
	"sort"
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

	tfStates map[string]map[string]*tfLiveState // bookKey -> tf -> state
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
	currentCandleOpen      time.Time
	lastFlushedCandleOpen  time.Time
	live                   liveCandle
	lastUpdateTime         time.Time
}

type priceLevel struct {
	bid float64
	ask float64
}

type tfLiveState struct {
	currentCandleOpen time.Time
	live              liveCandle
	lastUpdateTime    time.Time
	levels            map[float64]*priceLevel
	flushed           bool
}

type closedTfState struct {
	tf    string
	state *tfLiveState
}

var higherTimeframes = []string{"5m", "15m", "30m", "1h", "4h", "1d"}

func New(repo repository.MarketRepository, rdb *redis.Client) *Aggregator {
	a := &Aggregator{
		repo:     repo,
		rdb:      rdb,
		configs:  make(map[string]aggregationCompressionConfig),
		tfStates: make(map[string]map[string]*tfLiveState),
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
			prevMinute := now.Truncate(time.Minute).Add(-time.Minute)

			// ФИКС 1: flush только prevMinute, без сброса state
			for key, st := range states {
				if !st.currentCandleOpen.IsZero() && st.currentCandleOpen.Equal(prevMinute) {
					symbol, market := splitBookKey(key)
					if err := a.FlushCandle(ctx, symbol, market, "1m", st.currentCandleOpen); err != nil {
						log.Printf("[aggregator] flush error %s: %v", key, err)
					}
					st.lastFlushedCandleOpen = st.currentCandleOpen
					// currentCandleOpen НЕ сбрасывается — предотвращает воскрешение past candle
				}
			}

			// Дозакрытие higher-TF бакетов на тихом рынке
			for bk, tfm := range a.tfStates {
				for tf, st := range tfm {
					if st.currentCandleOpen.IsZero() || st.flushed {
						continue
					}
					bucketEnd := st.currentCandleOpen.Add(tfDuration(tf))
					if !now.Before(bucketEnd) {
						symbol, market := splitBookKey(bk)
						a.flushTfBucket(ctx, symbol, market, tf, st)
						st.flushed = true
						// НЕ удаляем из tfm — иначе trade path создаст дубль
					}
				}
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

			// Guard: late 1m trade (ts < current минуты) — отбрасываем целиком
			if candleOpen.Before(st.currentCandleOpen) {
				log.Printf("[aggregator] late 1m trade %s %d @ %v (current=%v)", trade.Symbol, trade.TradeID, trade.Time, st.currentCandleOpen)
				continue
			}

			if candleOpen != st.currentCandleOpen {
				if !st.currentCandleOpen.IsZero() {
					if st.currentCandleOpen.After(st.lastFlushedCandleOpen) {
						if err := a.FlushCandle(ctx, trade.Symbol, trade.Market, "1m", st.currentCandleOpen); err != nil {
							log.Printf("[aggregator] flush error %s: %v", key, err)
						}
					} else {
						log.Printf("[aggregator] stale 1m trade %s %d @ %v (candle %v already flushed)", trade.Symbol, trade.TradeID, trade.Time, st.currentCandleOpen)
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
	volume := trade.Qty

	key := fmt.Sprintf("cluster:levels:%s:%s:1m:%d", trade.Symbol, trade.Market, candleOpen.UnixMilli())

	field := fmt.Sprintf("%f", level)

	a.mu.Lock()

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

	closedTfBuckets := a.updateTFStates(trade, level, side, volume)

	a.mu.Unlock()

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

	// Flush closed higher-TF buckets outside lock (I/O safe)
	for _, ct := range closedTfBuckets {
		a.flushTfBucket(context.Background(), trade.Symbol, trade.Market, ct.tf, ct.state)
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

		a.pushTFUpdates(trade.Symbol, trade.Market)
	}
}

func (a *Aggregator) updateTFStates(trade model.Trade, level float64, side model.Side, volume float64) (closed []closedTfState) {
	bookKey := BookKey(trade.Symbol, trade.Market)
	states, exists := a.tfStates[bookKey]
	if !exists {
		states = make(map[string]*tfLiveState)
		a.tfStates[bookKey] = states
	}

	for _, tf := range higherTimeframes {
		aligned := aggregation.AlignToTimeframe(trade.Time, tf)

		st, ok := states[tf]
		if !ok || !aligned.Equal(st.currentCandleOpen) {
			// Stale check: бакет уже закрыт таймером, не создаём дубль
			if ok && st.flushed {
				if aligned.Equal(st.currentCandleOpen) {
					log.Printf("[aggregator] late higher-TF %s %s %d @ %v (bucket %v already flushed)", trade.Symbol, tf, trade.TradeID, trade.Time, st.currentCandleOpen)
					continue
				}
			}
			if ok && !st.currentCandleOpen.IsZero() && !st.flushed {
				closed = append(closed, closedTfState{tf: tf, state: st})
			}
			states[tf] = &tfLiveState{
				currentCandleOpen: aligned,
				flushed:           false,
				live: liveCandle{
					open:        trade.Price,
					high:        trade.Price,
					low:         trade.Price,
					close:       trade.Price,
					totalVolume: volume,
					tradesCount: 1,
				},
				levels: map[float64]*priceLevel{
					level: {bid: 0, ask: 0},
				},
			}
			pl := states[tf].levels[level]
			if side == model.SideSell {
				pl.ask = volume
			} else {
				pl.bid = volume
			}
			continue
		}

		// Same bucket, already flushed by timer — discard
		if st.flushed {
			log.Printf("[aggregator] late higher-TF %s %s %d @ %v (bucket %v already flushed)", trade.Symbol, tf, trade.TradeID, trade.Time, st.currentCandleOpen)
			continue
		}

		st.live.close = trade.Price
		st.live.totalVolume += volume
		st.live.tradesCount++
		if trade.Price > st.live.high || st.live.high == 0 {
			st.live.high = trade.Price
		}
		if trade.Price < st.live.low || st.live.low == 0 {
			st.live.low = trade.Price
		}

		pl, ok := st.levels[level]
		if !ok {
			pl = &priceLevel{}
			st.levels[level] = pl
		}
		if side == model.SideSell {
			pl.ask += volume
		} else {
			pl.bid += volume
		}
	}
	return
}

func (a *Aggregator) pushTFUpdates(symbol, market string) {
	bookKey := BookKey(symbol, market)
	states := a.tfStates[bookKey]
	if states == nil {
		return
	}

	for tf, st := range states {
		levels := make([]CandleLevel, 0, len(st.levels))
		for price, pl := range st.levels {
			levels = append(levels, CandleLevel{
				PriceLevel: price,
				BidVolume:  aggregation.TruncateVolume(pl.ask),
				AskVolume:  aggregation.TruncateVolume(pl.bid),
			})
		}

		select {
		case a.UpdatesCh <- CandleUpdate{
			Symbol:      symbol,
			Market:      market,
			Timeframe:   tf,
			CandleOpen:  st.currentCandleOpen.UnixMilli(),
			Open:        st.live.open,
			High:        st.live.high,
			Low:         st.live.low,
			Close:       st.live.close,
			TotalVolume: st.live.totalVolume,
			TradesCount: st.live.tradesCount,
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
			BidVolume:  aggregation.TruncateVolume(askVol),
			AskVolume:  aggregation.TruncateVolume(bidVol),
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

func tfDuration(tf string) time.Duration {
	switch tf {
	case "5m":
		return 5 * time.Minute
	case "15m":
		return 15 * time.Minute
	case "30m":
		return 30 * time.Minute
	case "1h":
		return time.Hour
	case "4h":
		return 4 * time.Hour
	case "1d":
		return 24 * time.Hour
	}
	return time.Minute
}

// tfStateToRows конвертирует tfLiveState в ClusterRows.
// Формат идентичен результату aggregation.Rollup для того же набора трейдов.
func (a *Aggregator) tfStateToRows(st *tfLiveState, symbol, market string) []model.ClusterRow {
	config := a.getConfig(symbol, market)
	rows := make([]model.ClusterRow, 0, len(st.levels))
	for price, pl := range st.levels {
		rows = append(rows, model.ClusterRow{
			Symbol:      symbol,
			PriceLevel:  price,
			BidVolume:   aggregation.TruncateVolume(pl.ask),
			AskVolume:   aggregation.TruncateVolume(pl.bid),
			Compression: uint16(config.BaseLevel),
			OpenPrice:   st.live.open,
			ClosePrice:  st.live.close,
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].PriceLevel < rows[j].PriceLevel
	})
	return rows
}

// flushTfBucket пишет closed tfLiveState в ClickHouse.
// Один INSERT на бакет — без дублей, корректные OHLC.
func (a *Aggregator) flushTfBucket(ctx context.Context, symbol, market, tf string, st *tfLiveState) {
	rows := a.tfStateToRows(st, symbol, market)
	for i := range rows {
		rows[i].Timeframe = tf
		rows[i].CandleOpen = st.currentCandleOpen
	}
	if len(rows) == 0 {
		return
	}
	if err := a.repo.InsertClusterBatch(ctx, rows, tableForMarket(market)); err != nil {
		log.Printf("[aggregator] flushTfBucket ERROR %s %s %s @ %v: %v", symbol, market, tf, st.currentCandleOpen, err)
		return
	}
	log.Printf("[aggregator] flushTfBucket OK %s %s %s @ %v (%d rows, open=%.2f close=%.2f)", symbol, market, tf, st.currentCandleOpen, len(rows), st.live.open, st.live.close)
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
