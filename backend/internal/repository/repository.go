package repository

import (
	"context"

	"github.com/procluster/procluster/internal/model"
)

type MarketRepository interface {
	InsertClusterBatch(ctx context.Context, rows []model.ClusterRow) error
	InsertDOMSnapshotBatch(ctx context.Context, rows []model.DOMRow) error
	GetLatestCandles(ctx context.Context, symbol, timeframe string, limit int) ([]model.Candle, error)
	GetClusters(ctx context.Context, symbol, timeframe string, candleOpen int64) ([]model.ClusterRow, error)
}
