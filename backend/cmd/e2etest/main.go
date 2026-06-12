package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/procluster/procluster/internal/aggregator"
	"github.com/procluster/procluster/internal/cache"
	"github.com/procluster/procluster/internal/ingest"
	"github.com/procluster/procluster/internal/model"
	chrepo "github.com/procluster/procluster/internal/repository/clickhouse"
)

func main() {
	log.SetFlags(log.Ltime | log.Lmicroseconds)
	log.Println("=== E2E TEST: ingest + aggregator + rollup ===")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("interrupted, shutting down...")
		cancel()
	}()

	chDSN := "localhost:9000"
	if v := os.Getenv("CLICKHOUSE_DSN"); v != "" {
		chDSN = v
	}
	chUser := "default"
	if v := os.Getenv("CLICKHOUSE_USER"); v != "" {
		chUser = v
	}
	chPass := "clickhouse"
	if v := os.Getenv("CLICKHOUSE_PASSWORD"); v != "" {
		chPass = v
	}

	chRepo, err := chrepo.New(ctx, chDSN, chUser, chPass)
	if err != nil {
		log.Fatalf("clickhouse connect: %v", err)
	}
	defer chRepo.Close()
	log.Println("[ok] ClickHouse connected")

	if err := chRepo.ApplyMigrations(ctx); err != nil {
		log.Fatalf("apply migrations: %v", err)
	}
	log.Println("[ok] Migrations applied")

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis connect: %v", err)
	}
	defer rdb.Close()
	log.Println("[ok] Redis connected")

	_ = cache.New(rdb)

	agg := aggregator.New(chRepo, rdb)

	tradesCh := make(chan model.Trade, 1000)

	spotWorker := ingest.New("BTCUSDT", ingest.MarketSpot, tradesCh)
	futuresWorker := ingest.New("BTCUSDT", ingest.MarketFutures, tradesCh)

	go spotWorker.Run(ctx)
	go futuresWorker.Run(ctx)
	go agg.Run(ctx, tradesCh)

	log.Println("[ok] Workers started, waiting for 1m candle to close...")
	log.Println("    Spot: wss://stream.binance.com:9443/ws/btcusdt@trade")
	log.Println("    Futures: wss://fstream.binance.com/market/ws/btcusdt@aggTrade")

	tradeCount := 0
	lastLog := time.Now()
	seenTrades := make(map[int64]bool)

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("=== E2E TEST COMPLETE ===")
			showResults(ctx, chRepo, rdb)
			return
		case trade := <-tradesCh:
			tradeCount++
			if !seenTrades[trade.TradeID] {
				seenTrades[trade.TradeID] = true
				if tradeCount <= 5 || tradeCount%50 == 0 {
					side := "BUY"
					if trade.IsBuyerMaker {
						side = "SELL"
					}
					log.Printf("[trade #%d] id=%d price=%.2f qty=%.4f side=%s time=%v",
						tradeCount, trade.TradeID, trade.Price, trade.Qty, side, trade.Time.Format("15:04:05.000"))
				}
			}
		case <-ticker.C:
			if time.Since(lastLog) > 0 {
				log.Printf("[status] trades=%d unique=%d spot_id=%d futures_id=%d",
					tradeCount, len(seenTrades), spotWorker.LastTradeID(), futuresWorker.LastTradeID())
				lastLog = time.Now()
			}
		}
	}
}

func showResults(ctx context.Context, repo *chrepo.ClickhouseRepository, rdb *redis.Client) {
	log.Println("\n--- ClickHouse: 1m candles ---")
	candles, err := repo.GetLatestCandles(ctx, "BTCUSDT", "1m", 5)
	if err != nil {
		log.Printf("  error getting candles: %v", err)
	} else {
		for _, c := range candles {
			log.Printf("  %s %s open=%v high=%.2f low=%.2f vol=%.2f trades=%d",
				c.Symbol, c.Timeframe, c.CandleOpen, c.High, c.Low, c.TotalVolume, c.TradesCount)
		}
	}

	for _, tf := range []string{"1h", "4h", "1d"} {
		log.Printf("\n--- ClickHouse: %s candles ---", tf)
		candles, err := repo.GetLatestCandles(ctx, "BTCUSDT", tf, 3)
		if err != nil {
			log.Printf("  error: %v", err)
		} else {
			for _, c := range candles {
				log.Printf("  %s %s open=%v vol=%.2f", c.Symbol, c.Timeframe, c.CandleOpen, c.TotalVolume)
			}
			if len(candles) == 0 {
				log.Println("  (no data — rollup will appear after 1h/4h/1d boundaries)")
			}
		}
	}

	log.Println("\n--- Redis keys ---")
	keys, _ := rdb.Keys(ctx, "cluster:*").Result()
	log.Printf("  cluster:* keys: %d", len(keys))
	for _, k := range keys[:min(len(keys), 10)] {
		log.Printf("    %s", k)
	}

	candleKeys, _ := rdb.Keys(ctx, "candle:*").Result()
	log.Printf("  candle:* keys: %d", len(candleKeys))
	for _, k := range candleKeys {
		log.Printf("    %s", k)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
