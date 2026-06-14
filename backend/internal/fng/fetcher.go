package fng

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	cacheKey      = "fng:current"
	cacheTTL      = 24 * time.Hour
	fetchInterval = 1 * time.Hour
)

type FNGData struct {
	Value          string `json:"value"`
	Classification string `json:"classification"`
	Timestamp      int64  `json:"timestamp"`
}

type alternativeMeResponse struct {
	Name string `json:"name"`
	Data []struct {
		Value               string `json:"value"`
		ValueClassification string `json:"value_classification"`
		Timestamp           string `json:"timestamp"`
	} `json:"data"`
}

type FNGFetcher struct {
	rdb    *redis.Client
	client *http.Client
}

func NewFNGFetcher(rdb *redis.Client) *FNGFetcher {
	return &FNGFetcher{
		rdb: rdb,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (f *FNGFetcher) Run(ctx context.Context) {
	f.fetchAndCache(ctx)

	ticker := time.NewTicker(fetchInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			f.fetchAndCache(ctx)
		}
	}
}

func (f *FNGFetcher) fetchAndCache(ctx context.Context) {
	data, err := f.Fetch(ctx)
	if err != nil {
		log.Printf("[fng] fetch error: %v (will use cache)", err)
		return
	}

	pipe := f.rdb.Pipeline()
	pipe.HSet(ctx, cacheKey,
		"value", data.Value,
		"classification", data.Classification,
		"timestamp", strconv.FormatInt(data.Timestamp, 10),
	)
	pipe.Expire(ctx, cacheKey, cacheTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		log.Printf("[fng] cache write error: %v", err)
	}
	log.Printf("[fng] cached: value=%s classification=%s", data.Value, data.Classification)
}

func (f *FNGFetcher) Fetch(ctx context.Context) (*FNGData, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.alternative.me/fng/?limit=1", nil)
	if err != nil {
		return nil, err
	}

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return nil, err
	}

	var apiResp alternativeMeResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, err
	}

	if len(apiResp.Data) == 0 {
		return nil, fmt.Errorf("empty data from alternative.me")
	}

	item := apiResp.Data[0]
	ts, _ := strconv.ParseInt(item.Timestamp, 10, 64)

	return &FNGData{
		Value:          item.Value,
		Classification: item.ValueClassification,
		Timestamp:      ts,
	}, nil
}

func (f *FNGFetcher) GetCached(ctx context.Context) (*FNGData, error) {
	vals, err := f.rdb.HGetAll(ctx, cacheKey).Result()
	if err != nil {
		return nil, err
	}
	if len(vals) == 0 {
		return nil, fmt.Errorf("no cached FNG data")
	}

	ts, _ := strconv.ParseInt(vals["timestamp"], 10, 64)
	return &FNGData{
		Value:          vals["value"],
		Classification: vals["classification"],
		Timestamp:      ts,
	}, nil
}
