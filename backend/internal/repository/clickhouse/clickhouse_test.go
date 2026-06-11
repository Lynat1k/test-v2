package clickhouse

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/procluster/procluster/internal/model"
)

func TestIntegration(t *testing.T) {
	dsn := os.Getenv("CLICKHOUSE_DSN")
	if dsn == "" {
		dsn = "localhost:9000"
	}

	user := os.Getenv("CLICKHOUSE_USER")
	if user == "" {
		user = "default"
	}

	password := os.Getenv("CLICKHOUSE_PASSWORD")
	if password == "" {
		password = "clickhouse"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	repo, err := New(ctx, dsn, user, password)
	if err != nil {
		t.Skipf("skipping integration test: %v", err)
	}
	defer repo.Close()

	if err := repo.ApplyMigrations(ctx); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}

	rows := []model.ClusterRow{
		{
			Symbol:      "BTCUSDT",
			Timeframe:   "1m",
			CandleOpen:  time.Now().Truncate(time.Minute),
			PriceLevel:  100000.0,
			BidVolume:   1.5,
			AskVolume:   0.8,
			Compression: 25,
		},
		{
			Symbol:      "BTCUSDT",
			Timeframe:   "1m",
			CandleOpen:  time.Now().Truncate(time.Minute),
			PriceLevel:  100002.5,
			BidVolume:   2.3,
			AskVolume:   1.1,
			Compression: 25,
		},
	}

	if err := repo.InsertClusterBatch(ctx, rows); err != nil {
		t.Fatalf("insert clusters: %v", err)
	}

	candles, err := repo.GetLatestCandles(ctx, "BTCUSDT", "1m", 10)
	if err != nil {
		t.Fatalf("get latest candles: %v", err)
	}

	if len(candles) == 0 {
		t.Fatal("expected at least 1 candle")
	}

	clusters, err := repo.GetClusters(ctx, "BTCUSDT", "1m", rows[0].CandleOpen.UnixMilli())
	if err != nil {
		t.Fatalf("get clusters: %v", err)
	}

	if len(clusters) < 2 {
		t.Fatalf("expected at least 2 cluster rows, got %d", len(clusters))
	}

	domRows := []model.DOMRow{
		{
			Symbol:      "BTCUSDT",
			SnapshotTS:  time.Now(),
			PriceLevel:  100000.0,
			BidSize:     5.0,
			AskSize:     3.2,
			Compression: 25,
		},
	}

	if err := repo.InsertDOMSnapshotBatch(ctx, domRows); err != nil {
		t.Fatalf("insert DOM snapshot: %v", err)
	}

	t.Log("integration test passed")
}
