package clickhouse

import (
	"context"
	"embed"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/shopspring/decimal"

	"github.com/procluster/procluster/internal/model"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type ClickhouseRepository struct {
	conn driver.Conn
}

func New(ctx context.Context, dsn, user, password, database string) (*ClickhouseRepository, error) {
	conn, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{dsn},
		Auth: clickhouse.Auth{
			Username: user,
			Password: password,
			Database: database,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("open clickhouse: %w", err)
	}

	if err := conn.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping clickhouse: %w", err)
	}

	return &ClickhouseRepository{conn: conn}, nil
}

func (r *ClickhouseRepository) Close() error {
	return r.conn.Close()
}

func (r *ClickhouseRepository) QueryRow(ctx context.Context, query string, args ...interface{}) driver.Row {
	return r.conn.QueryRow(ctx, query, args...)
}

func (r *ClickhouseRepository) ApplyMigrations(ctx context.Context) error {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		data, err := migrationsFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}

		statements := splitStatements(string(data))
		for _, stmt := range statements {
			stmt = trimSpace(stmt)
			if stmt == "" {
				continue
			}
			if err := r.conn.Exec(ctx, stmt); err != nil {
				return fmt.Errorf("apply migration %s: %w", entry.Name(), err)
			}
		}
	}

	return nil
}

func splitStatements(sql string) []string {
	var statements []string
	var current []byte
	inSingleQuote := false
	inDoubleQuote := false

	for i := 0; i < len(sql); i++ {
		ch := sql[i]

		if ch == '\'' && !inDoubleQuote {
			inSingleQuote = !inSingleQuote
		} else if ch == '"' && !inSingleQuote {
			inDoubleQuote = !inDoubleQuote
		}

		if ch == ';' && !inSingleQuote && !inDoubleQuote {
			statements = append(statements, string(current))
			current = current[:0]
		} else {
			current = append(current, ch)
		}
	}

	if len(current) > 0 {
		statements = append(statements, string(current))
	}

	return statements
}

func trimSpace(s string) string {
	start := 0
	for start < len(s) && (s[start] == ' ' || s[start] == '\t' || s[start] == '\n' || s[start] == '\r') {
		start++
	}
	end := len(s)
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\n' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}

func (r *ClickhouseRepository) InsertClusterBatch(ctx context.Context, rows []model.ClusterRow, table string) error {
	if len(rows) == 0 {
		return nil
	}

	batch, err := r.conn.PrepareBatch(ctx, "INSERT INTO "+table)
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}

	for _, row := range rows {
		if row.CandleOpen.IsZero() || row.CandleOpen.Year() < 2009 || row.CandleOpen.Year() > 2100 {
			log.Printf("[clickhouse] skipping row with invalid candle_open %v (symbol=%s timeframe=%s)", row.CandleOpen, row.Symbol, row.Timeframe)
			continue
		}
		if err := batch.Append(
			row.Symbol,
			row.Timeframe,
			row.CandleOpen,
			decimal.NewFromFloat(row.PriceLevel),
			decimal.NewFromFloat(row.BidVolume),
			decimal.NewFromFloat(row.AskVolume),
			row.Compression,
			decimal.NewFromFloat(row.OpenPrice),
			decimal.NewFromFloat(row.ClosePrice),
		); err != nil {
			return fmt.Errorf("append row: %w", err)
		}
	}

	if err := batch.Send(); err != nil {
		return fmt.Errorf("send batch: %w", err)
	}

	return nil
}

func (r *ClickhouseRepository) DeleteClustersByRange(ctx context.Context, table, symbol, timeframe string, from, to time.Time) error {
	query := fmt.Sprintf("ALTER TABLE %s DELETE WHERE symbol = ? AND timeframe = ? AND candle_open >= ? AND candle_open <= ?", table)
	if err := r.conn.Exec(ctx, query, symbol, timeframe, from, to); err != nil {
		return fmt.Errorf("delete clusters by range: %w", err)
	}
	return nil
}

func (r *ClickhouseRepository) InsertDOMSnapshotBatch(ctx context.Context, rows []model.DOMRow, table string) error {
	if len(rows) == 0 {
		return nil
	}

	batch, err := r.conn.PrepareBatch(ctx, "INSERT INTO "+table)
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}

	for _, row := range rows {
		if err := batch.Append(
			row.Symbol,
			row.SnapshotTS,
			decimal.NewFromFloat(row.PriceLevel),
			decimal.NewFromFloat(row.BidSize),
			decimal.NewFromFloat(row.AskSize),
			row.Compression,
		); err != nil {
			return fmt.Errorf("append row: %w", err)
		}
	}

	if err := batch.Send(); err != nil {
		return fmt.Errorf("send batch: %w", err)
	}

	return nil
}

func (r *ClickhouseRepository) GetLatestCandles(ctx context.Context, symbol, timeframe, market string, limit int, before *int64) ([]model.Candle, error) {
	table := "clusters_futures"
	if market == "spot" {
		table = "clusters_spot"
	}

	timeFilter := ""
	if before != nil {
		timeFilter = " AND candle_open < toDateTime64(?, 3)"
	}

	// Two-step to avoid aggregating the whole symbol history:
	//  1) inner subquery cheaply reads ONLY candle_open (PK-ordered column) to find
	//     the candle_open of the Nth most-recent candle.
	//  2) outer aggregation runs ONLY over that bounded candle_open range, so cost
	//     scales with N, not with total history length.
	// Result is identical to the old "aggregate all, then LIMIT N": candle_open >=
	// Nth-most-recent selects exactly those N most-recent candles.
	query := fmt.Sprintf(`
		SELECT
			symbol,
			timeframe,
			candle_open,
			min(price_level) AS low,
			max(price_level) AS high,
			any(open_price) AS open_price,
			any(close_price) AS close_price,
			sum(bid_volume) AS total_bid,
			sum(ask_volume) AS total_ask,
			sum(bid_volume - ask_volume) AS total_delta,
			sum(bid_volume + ask_volume) AS total_volume,
			count(*) AS trades_count
		FROM %[1]s
		WHERE symbol = ? AND timeframe = ?%[2]s
			AND candle_open >= (
				SELECT min(candle_open) FROM (
					SELECT candle_open
					FROM %[1]s
					WHERE symbol = ? AND timeframe = ?%[2]s
					GROUP BY candle_open
					ORDER BY candle_open DESC
					LIMIT ?
				)
			)
		GROUP BY symbol, timeframe, candle_open
		ORDER BY candle_open DESC
		LIMIT ?
	`, table, timeFilter)

	var args []interface{}
	args = append(args, symbol, timeframe) // outer WHERE
	if before != nil {
		args = append(args, time.UnixMilli(*before)) // outer time filter
	}
	args = append(args, symbol, timeframe) // inner WHERE
	if before != nil {
		args = append(args, time.UnixMilli(*before)) // inner time filter
	}
	args = append(args, limit) // inner LIMIT (Nth most-recent)
	args = append(args, limit) // outer LIMIT (safety)

	rows, err := r.conn.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query latest candles: %w", err)
	}
	defer rows.Close()

	var candles []model.Candle
	for rows.Next() {
		var c model.Candle
		var low, high, openPrice, closePrice, totalBid, totalAsk, totalDelta, totalVolume decimal.Decimal
		if err := rows.Scan(
			&c.Symbol,
			&c.Timeframe,
			&c.CandleOpen,
			&low,
			&high,
			&openPrice,
			&closePrice,
			&totalBid,
			&totalAsk,
			&totalDelta,
			&totalVolume,
			&c.TradesCount,
		); err != nil {
			return nil, fmt.Errorf("scan candle: %w", err)
		}
		c.Low, _ = low.Float64()
		c.High, _ = high.Float64()
		c.TotalBid, _ = totalBid.Float64()
		c.TotalAsk, _ = totalAsk.Float64()
		c.TotalDelta, _ = totalDelta.Float64()
		c.TotalVolume, _ = totalVolume.Float64()

		op, _ := openPrice.Float64()
		cp, _ := closePrice.Float64()
		if op > 0 && cp > 0 {
			c.Open = op
			c.Close = cp
		} else {
			// Legacy candles without open/close data
			c.Open = c.Low
			c.Close = c.High
		}
		candles = append(candles, c)
	}

	return candles, rows.Err()
}

func (r *ClickhouseRepository) GetClusters(ctx context.Context, symbol, timeframe string, candleOpen int64) ([]model.ClusterRow, error) {
	ts := time.UnixMilli(candleOpen)

	query := `
		SELECT
			symbol,
			timeframe,
			candle_open,
			price_level,
			bid_volume,
			ask_volume,
			compression
		FROM clusters_futures
		WHERE symbol = ? AND timeframe = ? AND candle_open = ?
		ORDER BY price_level ASC
	`

	rows, err := r.conn.Query(ctx, query, symbol, timeframe, ts)
	if err != nil {
		return nil, fmt.Errorf("query clusters: %w", err)
	}
	defer rows.Close()

	var result []model.ClusterRow
	for rows.Next() {
		var row model.ClusterRow
		var priceLevel, bidVolume, askVolume decimal.Decimal
		if err := rows.Scan(
			&row.Symbol,
			&row.Timeframe,
			&row.CandleOpen,
			&priceLevel,
			&bidVolume,
			&askVolume,
			&row.Compression,
		); err != nil {
			return nil, fmt.Errorf("scan cluster row: %w", err)
		}
		row.PriceLevel, _ = priceLevel.Float64()
		row.BidVolume, _ = bidVolume.Float64()
		row.AskVolume, _ = askVolume.Float64()
		result = append(result, row)
	}

	return result, rows.Err()
}

func (r *ClickhouseRepository) GetClustersBatch(ctx context.Context, symbol, timeframe, market string, candleOpens []int64, priceStep float64) (map[int64][]model.ClusterRow, error) {
	if len(candleOpens) == 0 {
		return nil, nil
	}

	table := "clusters_futures"
	if market == "spot" {
		table = "clusters_spot"
	}

	// candle_open IN (?, ?, ...) — cheaper to plan than a long OR chain.
	placeholders := make([]string, len(candleOpens))
	args := []interface{}{symbol, timeframe}
	for i, ts := range candleOpens {
		placeholders[i] = "?"
		args = append(args, time.UnixMilli(ts))
	}
	inClause := "candle_open IN (" + strings.Join(placeholders, ", ") + ")"

	var query string
	if priceStep > 0 {
		// Aggregate clusters into larger buckets by priceStep.
		// Embed priceStep directly via Sprintf (%g) — it's a validated server-side float, no injection risk.
		query = fmt.Sprintf(`
			SELECT
				symbol,
				timeframe,
				candle_open,
				floor(price_level / %g) * %g AS price_bucket,
				sum(bid_volume) AS bid_volume,
				sum(ask_volume) AS ask_volume,
				toUInt16(0) AS compression
			FROM %s
			WHERE symbol = ? AND timeframe = ? AND %s
			GROUP BY symbol, timeframe, candle_open, floor(price_level / %g) * %g
			ORDER BY candle_open, floor(price_level / %g) * %g ASC
		`, priceStep, priceStep, table, inClause, priceStep, priceStep, priceStep, priceStep)
	} else {
		// No aggregation — return raw clusters
		query = fmt.Sprintf(`
			SELECT
				symbol,
				timeframe,
				candle_open,
				price_level,
				bid_volume,
				ask_volume,
				compression
			FROM %s
			WHERE symbol = ? AND timeframe = ? AND %s
			ORDER BY candle_open, price_level ASC
		`, table, inClause)
	}

	log.Printf("[clickhouse] GetClustersBatch: symbol=%s tf=%s n=%d priceStep=%.2f", symbol, timeframe, len(candleOpens), priceStep)

	rows, err := r.conn.Query(ctx, query, args...)
	if err != nil {
		log.Printf("[clickhouse] GetClustersBatch QUERY ERROR: %v", err)
		return nil, fmt.Errorf("query clusters batch: %w", err)
	}
	defer rows.Close()

	result := make(map[int64][]model.ClusterRow)
	for rows.Next() {
		var row model.ClusterRow
		var priceLevel, bidVolume, askVolume decimal.Decimal
		if err := rows.Scan(
			&row.Symbol,
			&row.Timeframe,
			&row.CandleOpen,
			&priceLevel,
			&bidVolume,
			&askVolume,
			&row.Compression,
		); err != nil {
			log.Printf("[clickhouse] GetClustersBatch SCAN ERROR: %v", err)
			return nil, fmt.Errorf("scan cluster row: %w", err)
		}
		row.PriceLevel, _ = priceLevel.Float64()
		row.BidVolume, _ = bidVolume.Float64()
		row.AskVolume, _ = askVolume.Float64()

		key := row.CandleOpen.UnixMilli()
		result[key] = append(result[key], row)
	}

	if err := rows.Err(); err != nil {
		log.Printf("[clickhouse] GetClustersBatch ROWS_ERR: %v", err)
		return nil, fmt.Errorf("rows iteration: %w", err)
	}

	return result, nil
}

// GetClustersBatchFromCache reads pre-aggregated cluster levels for the given
// candleOpens at a specific priceStep from cluster_cache. Only candles present in
// the cache are returned (the caller treats absent ones as misses). argMax over
// updated_at collapses any duplicate ReplacingMergeTree versions on read.
func (r *ClickhouseRepository) GetClustersBatchFromCache(ctx context.Context, symbol, market, timeframe string, candleOpens []int64, priceStep float64) (map[int64][]model.ClusterRow, error) {
	if len(candleOpens) == 0 || priceStep <= 0 {
		return nil, nil
	}

	placeholders := make([]string, len(candleOpens))
	args := []interface{}{symbol, market, timeframe, decimal.NewFromFloat(priceStep)}
	for i, ts := range candleOpens {
		placeholders[i] = "?"
		args = append(args, time.UnixMilli(ts))
	}

	query := fmt.Sprintf(`
		SELECT
			candle_open,
			price_bucket,
			argMax(bid_volume, updated_at) AS bid_volume,
			argMax(ask_volume, updated_at) AS ask_volume
		FROM cluster_cache
		WHERE symbol = ? AND market = ? AND timeframe = ? AND price_step = ?
			AND candle_open IN (%s)
		GROUP BY candle_open, price_bucket
		ORDER BY candle_open, price_bucket ASC
	`, strings.Join(placeholders, ", "))

	rows, err := r.conn.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query cluster_cache: %w", err)
	}
	defer rows.Close()

	result := make(map[int64][]model.ClusterRow)
	for rows.Next() {
		var row model.ClusterRow
		var priceBucket, bidVolume, askVolume decimal.Decimal
		if err := rows.Scan(&row.CandleOpen, &priceBucket, &bidVolume, &askVolume); err != nil {
			return nil, fmt.Errorf("scan cluster_cache row: %w", err)
		}
		row.Symbol = symbol
		row.Timeframe = timeframe
		row.PriceLevel, _ = priceBucket.Float64()
		row.BidVolume, _ = bidVolume.Float64()
		row.AskVolume, _ = askVolume.Float64()

		key := row.CandleOpen.UnixMilli()
		result[key] = append(result[key], row)
	}

	return result, rows.Err()
}

// PutClustersBatchToCache writes pre-aggregated cluster levels for the given closed
// candles into cluster_cache. updated_at is left to its DEFAULT now(). Callers must
// pass only CLOSED candles at the admin-default priceStep.
func (r *ClickhouseRepository) PutClustersBatchToCache(ctx context.Context, symbol, market, timeframe string, priceStep float64, byCandle map[int64][]model.ClusterRow) error {
	if len(byCandle) == 0 || priceStep <= 0 {
		return nil
	}

	batch, err := r.conn.PrepareBatch(ctx, "INSERT INTO cluster_cache (symbol, market, timeframe, candle_open, price_step, price_bucket, bid_volume, ask_volume)")
	if err != nil {
		return fmt.Errorf("prepare cluster_cache batch: %w", err)
	}

	stepDec := decimal.NewFromFloat(priceStep)
	for ts, levels := range byCandle {
		candleOpen := time.UnixMilli(ts)
		for _, row := range levels {
			if err := batch.Append(
				symbol,
				market,
				timeframe,
				candleOpen,
				stepDec,
				decimal.NewFromFloat(row.PriceLevel),
				decimal.NewFromFloat(row.BidVolume),
				decimal.NewFromFloat(row.AskVolume),
			); err != nil {
				return fmt.Errorf("append cluster_cache row: %w", err)
			}
		}
	}

	if err := batch.Send(); err != nil {
		return fmt.Errorf("send cluster_cache batch: %w", err)
	}

	return nil
}
