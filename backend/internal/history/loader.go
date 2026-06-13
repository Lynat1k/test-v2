package history

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/model"
	"github.com/procluster/procluster/internal/repository"
)

type LoaderConfig struct {
	Symbol    string
	Market    MarketType
	DateFrom  time.Time
	DateTo    time.Time
	PriceTick float64
	BaseLevel float64
}

type Stats struct {
	TradesTotal  uint64
	Candles1m    uint64
	Candles15m   uint64
	Candles30m   uint64
	Candles1h    uint64
	Candles4h    uint64
	Candles1d    uint64
	RowsInserted uint64
	OK           int
	Skipped      int
	Errors       int
}

func DefaultConfig(symbol string, market MarketType) LoaderConfig {
	cfg := LoaderConfig{
		Symbol: symbol,
		Market: market,
	}

	if market == MarketFutures {
		cfg.PriceTick = 0.1
		cfg.BaseLevel = 25
	} else {
		cfg.PriceTick = 0.01
		cfg.BaseLevel = 500
	}

	return cfg
}

func Run(ctx context.Context, cfg LoaderConfig, repo repository.MarketRepository) (*Stats, error) {
	stats := &Stats{}
	table := tableForMarket(cfg.Market)

	tmpDir, cleanup, err := TempDir()
	if err != nil {
		return nil, err
	}
	defer cleanup()

	days := int(cfg.DateTo.Sub(cfg.DateFrom).Hours()/24) + 1

	for day := 0; day < days; day++ {
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		default:
		}

		date := cfg.DateFrom.AddDate(0, 0, day)
		if date.After(cfg.DateTo) {
			break
		}

		if err := processDay(ctx, cfg, repo, table, date, day, days, stats, tmpDir); err != nil {
			if errors.Is(err, ErrNotFound) {
				fmt.Fprintf(os.Stderr, "[%d/%d] %s: archive not available, skipping\n", day+1, days, date.Format("2006-01-02"))
				stats.Skipped++
				continue
			}
			fmt.Fprintf(os.Stderr, "[%d/%d] %s: ERROR %v\n", day+1, days, date.Format("2006-01-02"), err)
			stats.Errors++
		}
	}

	return stats, nil
}

func processDay(ctx context.Context, cfg LoaderConfig, repo repository.MarketRepository, table string, date time.Time, day, total int, stats *Stats, tmpDir string) error {
	dateStr := date.Format("2006-01-02")
	prefix := fmt.Sprintf("[%d/%d] %s", day+1, total, dateStr)

	url := BuildURL(cfg.Market, cfg.Symbol, date)
	zipPath := filepath.Join(tmpDir, FilenameForDate(cfg.Symbol, date))

	fmt.Fprintf(os.Stderr, "%s: download... ", prefix)

	if err := DownloadToFile(ctx, url, zipPath); err != nil {
		return err
	}
	defer os.Remove(zipPath)

	fi, err := os.Stat(zipPath)
	if err != nil {
		return fmt.Errorf("stat zip: %w", err)
	}
	fmt.Fprintf(os.Stderr, "%.1fMB ", float64(fi.Size())/1024/1024)

	fmt.Fprintf(os.Stderr, "unzip... ")
	csvReader, err := UnzipFile(zipPath)
	if err != nil {
		return fmt.Errorf("unzip: %w", err)
	}
	defer csvReader.Close()

	fmt.Fprintf(os.Stderr, "parse... ")
	trades, err := ParseCSV(csvReader, cfg.Market)
	if err != nil {
		return fmt.Errorf("parse: %w", err)
	}
	fmt.Fprintf(os.Stderr, "%d trades ", len(trades))
	stats.TradesTotal += uint64(len(trades))

	if len(trades) == 0 {
		fmt.Fprintf(os.Stderr, "(empty, skipping)\n")
		return nil
	}

	sort.Slice(trades, func(i, j int) bool {
		return trades[i].TradeID < trades[j].TradeID
	})

	candles := aggregateByMinute(trades, cfg)
	stats.Candles1m += uint64(len(candles))

	fmt.Fprintf(os.Stderr, "aggregate %d 1m candles... ", len(candles))

	var allRows []model.ClusterRow
	for _, c := range candles {
		allRows = append(allRows, c.Rows...)
	}

	from := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 1)

	if err := repo.DeleteClustersByRange(ctx, table, cfg.Symbol, "1m", from, to); err != nil {
		return fmt.Errorf("delete 1m: %w", err)
	}

	batchSize := 10000
	for i := 0; i < len(allRows); i += batchSize {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		end := i + batchSize
		if end > len(allRows) {
			end = len(allRows)
		}

		if err := repo.InsertClusterBatch(ctx, allRows[i:end], table); err != nil {
			return fmt.Errorf("insert 1m batch: %w", err)
		}
	}
	stats.RowsInserted += uint64(len(allRows))

	fmt.Fprintf(os.Stderr, "insert %d rows... ", len(allRows))

	rollupRows := aggregation.Rollup(allRows)
	rollupByTf := make(map[string][]model.ClusterRow)
	for _, r := range rollupRows {
		rollupByTf[r.Timeframe] = append(rollupByTf[r.Timeframe], r)
	}

	fmt.Fprintf(os.Stderr, "rollup... ")
	for tf, tfRows := range rollupByTf {
		if len(tfRows) == 0 {
			continue
		}

		if err := repo.DeleteClustersByRange(ctx, table, cfg.Symbol, tf, from, to); err != nil {
			log.Printf("[rollup] delete %s error: %v", tf, err)
			continue
		}

		for i := 0; i < len(tfRows); i += batchSize {
			end := i + batchSize
			if end > len(tfRows) {
				end = len(tfRows)
			}
			if err := repo.InsertClusterBatch(ctx, tfRows[i:end], table); err != nil {
				log.Printf("[rollup] insert %s error: %v", tf, err)
				continue
			}
		}

		switch tf {
		case "15m":
			stats.Candles15m += uint64(len(tfRows))
		case "30m":
			stats.Candles30m += uint64(len(tfRows))
		case "1h":
			stats.Candles1h += uint64(len(tfRows))
		case "4h":
			stats.Candles4h += uint64(len(tfRows))
		case "1d":
			stats.Candles1d += uint64(len(tfRows))
		}

		stats.RowsInserted += uint64(len(tfRows))
	}

	stats.OK++
	fmt.Fprintf(os.Stderr, "done\n")
	return nil
}

type minuteCandle struct {
	candleOpen time.Time
	trades     []model.Trade
	Rows       []model.ClusterRow
}

func aggregateByMinute(trades []model.Trade, cfg LoaderConfig) []minuteCandle {
	minutes := make(map[time.Time]*minuteCandle)

	for _, t := range trades {
		minute := t.Time.Truncate(time.Minute)
		mc, ok := minutes[minute]
		if !ok {
			mc = &minuteCandle{
				candleOpen: minute,
				trades:     make([]model.Trade, 0, 256),
			}
			minutes[minute] = mc
		}
		mc.trades = append(mc.trades, t)
	}

	result := make([]minuteCandle, 0, len(minutes))
	for _, mc := range minutes {
		compressionConfig := aggregation.CompressionConfig{
			Symbol:    cfg.Symbol,
			PriceTick: cfg.PriceTick,
			BaseLevel: cfg.BaseLevel,
			MaxLevels: 10,
		}

		rows := aggregation.CompressTrades(mc.trades, compressionConfig)

		var openPrice, closePrice float64
		if len(mc.trades) > 0 {
			first, last := mc.trades[0], mc.trades[len(mc.trades)-1]
			openPrice = first.Price
			closePrice = last.Price
		}

		for i := range rows {
			rows[i].Symbol = cfg.Symbol
			rows[i].Timeframe = "1m"
			rows[i].CandleOpen = mc.candleOpen
			rows[i].OpenPrice = math.Trunc(openPrice*100) / 100
			rows[i].ClosePrice = math.Trunc(closePrice*100) / 100
		}

		mc.Rows = rows
		result = append(result, *mc)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].candleOpen.Before(result[j].candleOpen)
	})

	return result
}

func tableForMarket(market MarketType) string {
	if market == MarketSpot {
		return "clusters_spot"
	}
	return "clusters_futures"
}
