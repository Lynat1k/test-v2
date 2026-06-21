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

	chdriver "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/joho/godotenv"
	"github.com/shopspring/decimal"

	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/model"
	chrepo "github.com/procluster/procluster/internal/repository/clickhouse"
)

func main() {
	symbol := flag.String("symbol", "BTCUSDT", "symbol to backfill")
	market := flag.String("market", "futures", "market (futures or spot)")
	batchDays := flag.Int("batch", 1, "days per batch")
	fromDate := flag.String("from", "", "override start date (YYYY-MM-DD)")
	flag.Parse()

	if err := godotenv.Load(); err != nil {
		log.Println("[env] .env not loaded (using system env)")
	} else {
		log.Println("[env] .env loaded")
	}

	chAddr := getEnv("CLICKHOUSE_ADDR", "localhost:9000")
	chUser := getEnv("CLICKHOUSE_USER", "default")
	chPass := getEnv("CLICKHOUSE_PASSWORD", "")
	chDB := getEnv("CLICKHOUSE_DB", "default")

	table := "clusters_futures"
	if *market == "spot" {
		table = "clusters_spot"
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

	conn, err := chdriver.Open(&chdriver.Options{
		Addr: []string{chAddr},
		Auth: chdriver.Auth{
			Username: chUser,
			Password: chPass,
			Database: chDB,
		},
	})
	if err != nil {
		log.Fatalf("clickhouse connect: %v", err)
	}
	defer conn.Close()

	repo, err := chrepo.New(ctx, chAddr, chUser, chPass, chDB)
	if err != nil {
		log.Fatalf("clickhouse repo: %v", err)
	}

	var batchStart time.Time
	if *fromDate != "" {
		t, err := time.Parse("2006-01-02", *fromDate)
		if err != nil {
			log.Fatalf("invalid --from date: %v", err)
		}
		batchStart = t
	} else {
		var minTime time.Time
		row := conn.QueryRow(ctx, "SELECT min(candle_open) FROM "+table+" WHERE symbol = ? AND timeframe = '1m'", *symbol)
		if err := row.Scan(&minTime); err != nil {
			log.Fatalf("query min time: %v", err)
		}
		batchStart = minTime.Truncate(24 * time.Hour)
	}

	var maxTime time.Time
	row := conn.QueryRow(ctx, "SELECT max(candle_open) FROM "+table+" WHERE symbol = ? AND timeframe = '1m'", *symbol)
	if err := row.Scan(&maxTime); err != nil {
		log.Fatalf("query max time: %v", err)
	}
	batchEnd := maxTime.Truncate(24 * time.Hour).Add(24 * time.Hour)

	log.Printf("range: %s to %s", batchStart.Format("2006-01-02"), batchEnd.Format("2006-01-02"))

	total1m := 0
	total5m := 0

	for d := batchStart; d.Before(batchEnd); d = d.AddDate(0, 0, *batchDays) {
		to := d.AddDate(0, 0, *batchDays)
		if to.After(batchEnd) {
			to = batchEnd
		}

		select {
		case <-ctx.Done():
			log.Printf("interrupted after %s", d.Format("2006-01-02"))
			goto done
		default:
		}

		log.Printf("[batch] %s to %s ...", d.Format("2006-01-02"), to.Format("2006-01-02"))

		rows1m, err := conn.Query(ctx,
			"SELECT symbol,timeframe,candle_open,price_level,bid_volume,ask_volume,compression,open_price,close_price "+
				"FROM "+table+
				" WHERE symbol=? AND timeframe='1m' AND candle_open>=? AND candle_open<? ORDER BY candle_open,price_level",
			*symbol, d, to,
		)
		if err != nil {
			log.Fatalf("query: %v", err)
		}

		var allRows []model.ClusterRow
		for rows1m.Next() {
			var r model.ClusterRow
			var priceLevel, bidVol, askVol, openP, closeP decimal.Decimal
			if err := rows1m.Scan(&r.Symbol, &r.Timeframe, &r.CandleOpen, &priceLevel, &bidVol, &askVol, &r.Compression, &openP, &closeP); err != nil {
				log.Fatalf("scan: %v", err)
			}
			r.PriceLevel, _ = priceLevel.Float64()
			r.BidVolume, _ = bidVol.Float64()
			r.AskVolume, _ = askVol.Float64()
			r.OpenPrice, _ = openP.Float64()
			r.ClosePrice, _ = closeP.Float64()
			allRows = append(allRows, r)
		}
		rows1m.Close()

		if len(allRows) == 0 {
			log.Printf("[batch] no 1m data, skip")
			continue
		}

		total1m += len(allRows)
		log.Printf("[batch] read %d 1m rows", len(allRows))

		rollupRows := aggregation.AggregateForTimeframe(allRows, "5m")
		if len(rollupRows) == 0 {
			log.Printf("[batch] no 5m rows produced")
			continue
		}

		log.Printf("[batch] produced %d 5m rows", len(rollupRows))

		if err := repo.DeleteClustersByRange(ctx, table, *symbol, "5m", d, to.Add(-time.Millisecond)); err != nil {
			log.Printf("[batch] delete existing 5m (may be ok): %v", err)
		}

		if err := repo.InsertClusterBatch(ctx, rollupRows, table); err != nil {
			log.Fatalf("insert: %v", err)
		}

		total5m += len(rollupRows)
		log.Printf("[batch] wrote %d 5m rows", len(rollupRows))
	}

done:
	log.Printf("DONE: %d 1m rows -> %d 5m rows", total1m, total5m)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
