package main

import (
	"context"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	"github.com/procluster/procluster/internal/admin"
	"github.com/procluster/procluster/internal/aggregator"
	"github.com/procluster/procluster/internal/api"
	"github.com/procluster/procluster/internal/auth"
	"github.com/procluster/procluster/internal/cache"
	"github.com/procluster/procluster/internal/config"
	"github.com/procluster/procluster/internal/depth"
	"github.com/procluster/procluster/internal/fng"
	"github.com/procluster/procluster/internal/ingest"
	"github.com/procluster/procluster/internal/longshort"
	"github.com/procluster/procluster/internal/model"
	"github.com/procluster/procluster/internal/repository/clickhouse"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("[env] .env not loaded (using system env)")
	} else {
		log.Println("[env] .env loaded")
	}

	chDB := getEnv("CLICKHOUSE_DB", "default")
	log.Printf("[config] effective settings: CLICKHOUSE_ADDR=%s CLICKHOUSE_DB=%s REDIS_ADDR=%s SQLITE_PATH=%s APP_PORT=%s",
		getEnv("CLICKHOUSE_ADDR", "localhost:9000"),
		chDB,
		getEnv("REDIS_ADDR", "localhost:6379"),
		getEnv("SQLITE_PATH", "./data/procluster.db"),
		getEnv("APP_PORT", "8080"),
	)

	logBuf := admin.NewLogBuffer(200)
	log.SetOutput(io.MultiWriter(os.Stderr, logBuf))

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
	// chDB already set above

	repo, err := clickhouse.New(ctx, chAddr, chUser, chPass, chDB)
	if err != nil {
		log.Fatalf("[clickhouse] connection failed: %v", err)
	}
	defer repo.Close()
	log.Println("[clickhouse] connected")

	if err := repo.ApplyMigrations(ctx); err != nil {
		log.Fatalf("[clickhouse] migrations failed: %v", err)
	}
	log.Println("[clickhouse] migrations applied")

	sqliteDSN := getEnv("SQLITE_PATH", "./data/procluster.db")
	sqliteDB, err := auth.OpenSQLite(sqliteDSN)
	if err != nil {
		log.Fatalf("[sqlite] connection failed: %v", err)
	}
	defer sqliteDB.Close()

	if err := auth.Migrate(sqliteDB); err != nil {
		log.Fatalf("[sqlite] migrations failed: %v", err)
	}
	log.Println("[sqlite] connected and migrated")

	if err := admin.SeedDefaultTickers(ctx, sqliteDB); err != nil {
		log.Printf("[main] seed tickers: %v", err)
	} else {
		log.Println("[main] seed tickers: ok")
	}
	if err := admin.SeedDefaultCompressions(ctx, sqliteDB); err != nil {
		log.Printf("[main] seed compressions: %v", err)
	} else {
		log.Println("[main] seed compressions: ok")
	}

	authCfg := auth.LoadAuthConfig()

	if err := admin.SeedTierPolicies(sqliteDB); err != nil {
		log.Printf("[main] seed tier_policies: %v", err)
	} else {
		log.Println("[main] seed tier_policies: ok")
	}

	if err := admin.InitSiteSettings(sqliteDB); err != nil {
		log.Printf("[main] init site_settings: %v", err)
	} else {
		log.Println("[main] site_settings initialized")
	}

	sessionLimits, historyLimits, err := admin.LoadTierPolicies(sqliteDB)
	if err != nil {
		log.Printf("[main] load tier_policies: %v, using config defaults", err)
	}
	if sessionLimits != nil {
		log.Printf("[main] using session limits from tier_policies: %v", sessionLimits)
	} else {
		sessionLimits = authCfg.SessionLimits
		log.Println("[main] using session limits from auth config (fallback)")
	}

	candleCache := cache.New(rdb)
	agg := aggregator.New(repo, rdb)
	sm := api.NewSessionManager(rdb, sessionLimits)

	apiCfg := api.DefaultServerConfig()
	if port := getEnv("APP_PORT", ""); port != "" {
		apiCfg.Addr = ":" + port
	}

	restLimiter := api.NewRateLimiter(rdb, time.Minute, 60)
	wsLimiter := api.NewRateLimiter(rdb, time.Minute, 5)

	fngFetcher := fng.NewFNGFetcher(rdb)

	srv := api.NewServer(repo, candleCache, agg, sm, apiCfg, restLimiter, wsLimiter, fngFetcher, authCfg, rdb)
	srv.SetBetaEnabled(admin.BetaModeEnabled)

	if historyLimits != nil {
		srv.SetTierHistoryLimits(historyLimits)
		log.Println("[main] set history limits from tier_policies")
	} else {
		// fallback: maxDepthForRole will use auth config directly
		log.Println("[main] history limits: using auth config defaults (fallback)")
	}

	authHandler := auth.NewHandler(authCfg, sqliteDB, auth.NewAuthRateLimiter(rdb, authCfg))

	compressionMaxMap, err := admin.LoadCompressionMax(sqliteDB)
	if err != nil {
		log.Printf("[main] load compression_max: %v, using defaults", err)
	}
	if compressionMaxMap != nil {
		authHandler.SetTierCompressionMax(compressionMaxMap)
		log.Printf("[main] set compression_max from tier_policies: %v", compressionMaxMap)
	} else {
		log.Println("[main] compression_max: using defaults (all tiers=1)")
	}

	authHandler.RegisterRoutes(srv.Mux())

	metricsHist := admin.NewMetricsHistory()
	metricsHist.StartSampler(ctx)

	adminHandler := admin.NewAdminHandler(sqliteDB, authCfg, repo, rdb, logBuf, metricsHist)
	adminHandler.RefreshCompressions = func() {
		allCompr, err := admin.GetAllDefaultCompressions(context.Background(), sqliteDB)
		if err != nil {
			log.Printf("[main] refresh default compressions: %v", err)
			return
		}
		srv.SetDefaultCompressions(allCompr)
		log.Printf("[main] refreshed default compressions: %d entries", len(allCompr))
	}
	adminHandler.RefreshTickers = func() {
		dbTickers, err := admin.ListTickers(context.Background(), sqliteDB)
		if err != nil {
			log.Printf("[main] refresh active tickers: %v", err)
			return
		}
		srv.SetActiveTickers(dbTickers)
		log.Printf("[main] refreshed active tickers: %d tickers", len(dbTickers))
	}
	adminHandler.RegisterAdminRoutes(srv.Mux())
	adminHandler.RegisterPublicRoutes(srv.Mux())

	hub := srv.Hub()
	go hub.Run(ctx)

	updatesCh := make(chan aggregator.CandleUpdate, 64)
	agg.SetUpdatesCh(updatesCh)
	go hub.ListenToAggregator(ctx, updatesCh)

	candleCloseCh := make(chan aggregator.CandleCloseSignal, 64)
	agg.SetCandleCloseCh(candleCloseCh)

	dbTickers, err := admin.ListTickers(ctx, sqliteDB)
	var symbolConfigs map[string]config.SymbolConfig
	if err != nil {
		log.Printf("[main] failed to list tickers: %v, using defaults", err)
		symbolConfigs = config.SymbolMap()
	} else {
		symbolConfigs = admin.SymbolConfigsFromTickers(dbTickers)
		if len(symbolConfigs) == 0 {
			log.Println("[main] no active tickers found, using defaults")
			symbolConfigs = config.SymbolMap()
		}
		if len(dbTickers) > 0 {
			srv.SetActiveTickers(dbTickers)
			log.Printf("[main] set active tickers for public API: %d tickers", len(dbTickers))
		}
	}
	if allCompr, comprErr := admin.GetAllDefaultCompressions(ctx, sqliteDB); comprErr != nil {
		log.Printf("[main] failed to load default compressions: %v", comprErr)
	} else {
		srv.SetDefaultCompressions(allCompr)
		log.Printf("[main] set default compressions for public API: %d entries", len(allCompr))
	}
	// Feed per-symbol price-tick/base into the live aggregator so non-BTC tickers
	// (e.g. ETH base 10, tick 0.01) bucket on the correct grid instead of the BTC default.
	agg.RegisterConfigs(symbolConfigs)

	orderBooks := make(map[string]*depth.OrderBook)
	for key, sc := range symbolConfigs {
		orderBooks[key] = depth.NewOrderBook(sc.Symbol, sc.Market)
	}

	aggOrderBooks := make(map[string]aggregator.LastPriceSetter, len(orderBooks))
	for key, ob := range orderBooks {
		aggOrderBooks[key] = ob
	}
	agg.SetOrderBooks(aggOrderBooks)

	for key, sc := range symbolConfigs {
		ob := orderBooks[key]
		depthSync := depth.NewDepthSync(sc.Symbol, sc.Market, ob, sc.CompressionConfig())
		go depthSync.Run(ctx)
		log.Printf("[depth-sync] started %s:%s", sc.Symbol, sc.Market)
	}

	snapshotter := depth.NewSnapshotter(repo, orderBooks, candleCloseCh, symbolConfigs)
	go snapshotter.Run(ctx)
	log.Println("[snapshotter] started")

	liveDOM := depth.NewLiveDOMBroadcaster(hub, orderBooks, symbolConfigs)
	go liveDOM.Run(ctx)
	log.Println("[livedom] started")

	lsrPoller := longshort.NewPoller(repo, symbolConfigs)
	go lsrPoller.Run(ctx)
	log.Println("[longshort] started")

	go fngFetcher.Run(ctx)
	log.Println("[fng-fetcher] started")

	tradesCh := make(chan model.Trade, 1024)
	go agg.Run(ctx, tradesCh)

	for _, sc := range symbolConfigs {
		worker := ingest.New(sc.Symbol, ingest.MarketType(sc.Market), tradesCh)
		go worker.Run(ctx)
		log.Printf("[ingest] started %s %s @aggTrade", sc.Symbol, sc.Market)
	}

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
