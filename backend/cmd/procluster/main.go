package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	"github.com/procluster/procluster/internal/aggregator"
	"github.com/procluster/procluster/internal/api"
	"github.com/procluster/procluster/internal/cache"
	"github.com/procluster/procluster/internal/ingest"
	"github.com/procluster/procluster/internal/model"
	"github.com/procluster/procluster/internal/repository/clickhouse"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("[env] .env not loaded (using system env)")
	} else {
		log.Println("[env] .env loaded")
	}

	log.Println("procluster up")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rdb := redis.NewClient(&redis.Options{
		Addr:     getEnv("REDIS_ADDR", "localhost:6379"),
		Password: getEnv("REDIS_PASSWORD", ""),
		DB:       0,
	})
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("[redis] connection failed: %v", err)
	}
	log.Println("[redis] connected")

	chAddr := getEnv("CLICKHOUSE_ADDR", "localhost:9000")
	chUser := getEnv("CLICKHOUSE_USER", "default")
	chPass := getEnv("CLICKHOUSE_PASSWORD", "")

	repo, err := clickhouse.New(ctx, chAddr, chUser, chPass)
	if err != nil {
		log.Fatalf("[clickhouse] connection failed: %v", err)
	}
	defer repo.Close()
	log.Println("[clickhouse] connected")

	candleCache := cache.New(rdb)
	agg := aggregator.New(repo, rdb)
	sm := api.NewSessionManager(rdb)

	apiCfg := api.DefaultServerConfig()
	if port := getEnv("APP_PORT", ""); port != "" {
		apiCfg.Addr = ":" + port
	}

	restLimiter := api.NewRateLimiter(rdb, time.Minute, 60)
	wsLimiter := api.NewRateLimiter(rdb, time.Minute, 5)

	srv := api.NewServer(repo, candleCache, agg, sm, apiCfg, restLimiter, wsLimiter)

	hub := srv.Hub()
	go hub.Run(ctx)

	// Wire aggregator → WS hub for live candle_update broadcasts
	updatesCh := make(chan aggregator.CandleUpdate, 64)
	agg.SetUpdatesCh(updatesCh)
	go hub.ListenToAggregator(ctx, updatesCh)

	// Wire ingest → aggregator
	tradesCh := make(chan model.Trade, 1024)
	go agg.Run(ctx, tradesCh)

	// Start ingest workers
	futuresWorker := ingest.New("BTCUSDT", ingest.MarketFutures, tradesCh)
	go futuresWorker.Run(ctx)

	log.Println("[ingest] BTCUSDT futures connected to Binance @aggTrade")

	go func() {
		if err := srv.ListenAndServe(); err != nil && err.Error() != "http: Server closed" {
			log.Printf("[api] server error: %v", err)
		}
	}()

	log.Println("procluster ready")

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[api] shutdown error: %v", err)
	}

	log.Println("procluster stopped")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
