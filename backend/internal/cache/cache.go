package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/procluster/procluster/internal/model"
)

type CandleCache struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *CandleCache {
	return &CandleCache{rdb: rdb}
}

func (c *CandleCache) StoreCandle(ctx context.Context, candle model.Candle, market string) error {
	data, err := json.Marshal(candle)
	if err != nil {
		return fmt.Errorf("marshal candle: %w", err)
	}

	key := fmt.Sprintf("candles:%s:%s:%s", candle.Symbol, candle.Timeframe, market)
	score := float64(candle.CandleOpen.UnixMilli())

	c.rdb.ZAdd(ctx, key, redis.Z{
		Score:  score,
		Member: string(data),
	})

	c.rdb.ZRemRangeByRank(ctx, key, 0, -701)

	return nil
}

func (c *CandleCache) GetCandles(ctx context.Context, symbol, timeframe, market string, limit int) ([]model.Candle, error) {
	key := fmt.Sprintf("candles:%s:%s:%s", symbol, timeframe, market)

	results, err := c.rdb.ZRevRangeWithScores(ctx, key, 0, int64(limit-1)).Result()
	if err != nil {
		return nil, fmt.Errorf("get candles: %w", err)
	}

	var candles []model.Candle
	for _, z := range results {
		var candle model.Candle
		if err := json.Unmarshal([]byte(z.Member.(string)), &candle); err != nil {
			continue
		}
		candles = append(candles, candle)
	}

	return candles, nil
}

func (c *CandleCache) StoreCurrentCandle(ctx context.Context, candle model.Candle, market string) error {
	key := fmt.Sprintf("candle:current:%s:%s:%s", candle.Symbol, candle.Timeframe, market)

	data, err := json.Marshal(candle)
	if err != nil {
		return fmt.Errorf("marshal candle: %w", err)
	}

	c.rdb.Set(ctx, key, string(data), 2*time.Minute)
	return nil
}

func (c *CandleCache) GetCurrentCandle(ctx context.Context, symbol, timeframe, market string) (*model.Candle, error) {
	key := fmt.Sprintf("candle:current:%s:%s:%s", symbol, timeframe, market)

	data, err := c.rdb.Get(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get current candle: %w", err)
	}

	var candle model.Candle
	if err := json.Unmarshal([]byte(data), &candle); err != nil {
		return nil, fmt.Errorf("unmarshal candle: %w", err)
	}

	return &candle, nil
}

func ParseFloat(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
}
