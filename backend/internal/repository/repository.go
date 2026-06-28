package repository

import (
	"context"
	"time"

	"github.com/procluster/procluster/internal/model"
)

type MarketRepository interface {
	InsertClusterBatch(ctx context.Context, rows []model.ClusterRow, table string) error
	DeleteClustersByRange(ctx context.Context, table, symbol, timeframe string, from, to time.Time) error
	InsertDOMSnapshotBatch(ctx context.Context, rows []model.DOMRow, table string) error
	InsertBookDepthRatioBatch(ctx context.Context, rows []model.BookDepthRatio) error
	GetBookDepthRatio(ctx context.Context, symbol, market string, from, to time.Time) ([]model.BookDepthRatio, error)
	InsertLongShortRatioBatch(ctx context.Context, rows []model.LongShortRatio) error
	GetLongShortRatio(ctx context.Context, symbol, market string, from, to time.Time) ([]model.LongShortRatio, error)
	GetLatestCandles(ctx context.Context, symbol, timeframe, market string, limit int, before *int64) ([]model.Candle, error)
	GetClusters(ctx context.Context, symbol, timeframe string, candleOpen int64) ([]model.ClusterRow, error)
	GetClustersBatch(ctx context.Context, symbol, timeframe, market string, candleOpens []int64, priceStep float64) (map[int64][]model.ClusterRow, error)
	GetClustersBatchFromCache(ctx context.Context, symbol, market, timeframe string, candleOpens []int64, priceStep float64) (map[int64][]model.ClusterRow, error)
	PutClustersBatchToCache(ctx context.Context, symbol, market, timeframe string, priceStep float64, byCandle map[int64][]model.ClusterRow) error
}
