package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/procluster/procluster/internal/history"
	"github.com/procluster/procluster/internal/repository/clickhouse"
)

func main() {
	symbol := flag.String("symbol", "BTCUSDT", "symbol to load")
	market := flag.String("market", "futures", "market: futures or spot")
	dateFromStr := flag.String("from", "", "start date (YYYY-MM-DD)")
	dateToStr := flag.String("to", "", "end date (YYYY-MM-DD)")
	flag.Parse()

	if *dateFromStr == "" || *dateToStr == "" {
		fmt.Fprintf(os.Stderr, "Usage: loader -symbol BTCUSDT -market futures -from 2026-05-01 -to 2026-06-01\n")
		os.Exit(1)
	}

	var marketType history.MarketType
	switch *market {
	case "futures":
		marketType = history.MarketFutures
	case "spot":
		marketType = history.MarketSpot
	default:
		fmt.Fprintf(os.Stderr, "invalid market: %s (use 'futures' or 'spot')\n", *market)
		os.Exit(1)
	}

	dateFrom, err := time.Parse("2006-01-02", *dateFromStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid from date: %v\n", err)
		os.Exit(1)
	}

	dateTo, err := time.Parse("2006-01-02", *dateToStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid to date: %v\n", err)
		os.Exit(1)
	}

	if err := godotenv.Load(); err != nil {
		log.Println("[env] .env not loaded (using system env)")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		fmt.Fprintf(os.Stderr, "\n[interrupted]\n")
		cancel()
	}()

	chAddr := getEnv("CLICKHOUSE_ADDR", "localhost:9000")
	chUser := getEnv("CLICKHOUSE_USER", "default")
	chPass := getEnv("CLICKHOUSE_PASSWORD", "")
	chDB := getEnv("CLICKHOUSE_DB", "default")

	repo, err := clickhouse.New(ctx, chAddr, chUser, chPass, chDB)
	if err != nil {
		fmt.Fprintf(os.Stderr, "clickhouse connection failed: %v\n", err)
		os.Exit(1)
	}
	defer repo.Close()

	if err := repo.ApplyMigrations(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "migrations failed: %v\n", err)
		os.Exit(1)
	}

	cfg := history.DefaultConfig(*symbol, marketType)
	cfg.DateFrom = dateFrom
	cfg.DateTo = dateTo

	days := int(dateTo.Sub(dateFrom).Hours()/24) + 1
	fmt.Fprintf(os.Stderr, "[loader] %s %s %s → %s (%d days)\n", *symbol, *market, *dateFromStr, *dateToStr, days)

	stats, err := history.Run(ctx, cfg, repo)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[loader] FATAL: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "\n[loader] SUMMARY\n")
	fmt.Fprintf(os.Stderr, "  Days OK:       %d\n", stats.OK)
	fmt.Fprintf(os.Stderr, "  Days skipped:  %d (archive not available)\n", stats.Skipped)
	fmt.Fprintf(os.Stderr, "  Days failed:   %d\n", stats.Errors)
	fmt.Fprintf(os.Stderr, "  Trades loaded: %d\n", stats.TradesTotal)
	fmt.Fprintf(os.Stderr, "  1m candles:    %d\n", stats.Candles1m)
	fmt.Fprintf(os.Stderr, "  15m candles:   %d\n", stats.Candles15m)
	fmt.Fprintf(os.Stderr, "  30m candles:   %d\n", stats.Candles30m)
	fmt.Fprintf(os.Stderr, "  1h candles:    %d\n", stats.Candles1h)
	fmt.Fprintf(os.Stderr, "  4h candles:    %d\n", stats.Candles4h)
	fmt.Fprintf(os.Stderr, "  1d candles:    %d\n", stats.Candles1d)
	fmt.Fprintf(os.Stderr, "  Rows inserted: %d\n", stats.RowsInserted)

	table := "clusters_futures"
	if marketType == history.MarketSpot {
		table = "clusters_spot"
	}

	fmt.Fprintf(os.Stderr, "\n[loader] ClickHouse table size check:\n")
	fmt.Fprintf(os.Stderr, "  SELECT table, formatReadableSize(sum(bytes)) AS size\n")
	fmt.Fprintf(os.Stderr, "  FROM system.parts\n")
	fmt.Fprintf(os.Stderr, "  WHERE table LIKE 'clusters_%%' AND active\n")
	fmt.Fprintf(os.Stderr, "  GROUP BY table;\n")

	fmt.Fprintf(os.Stderr, "\n[loader] Row count by timeframe:\n")
	fmt.Fprintf(os.Stderr, "  SELECT timeframe, count(*) AS rows FROM %s WHERE symbol = '%s' GROUP BY timeframe ORDER BY timeframe;\n", table, *symbol)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
