package clickhouse

import (
	"context"
	"embed"
	"fmt"
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

func New(ctx context.Context, dsn, user, password string) (*ClickhouseRepository, error) {
	conn, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{dsn},
		Auth: clickhouse.Auth{
			Username: user,
			Password: password,
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

func (r *ClickhouseRepository) InsertClusterBatch(ctx context.Context, rows []model.ClusterRow) error {
	if len(rows) == 0 {
		return nil
	}

	batch, err := r.conn.PrepareBatch(ctx, "INSERT INTO clusters_futures")
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}

	for _, row := range rows {
		if err := batch.Append(
			row.Symbol,
			row.Timeframe,
			row.CandleOpen,
			decimal.NewFromFloat(row.PriceLevel),
			decimal.NewFromFloat(row.BidVolume),
			decimal.NewFromFloat(row.AskVolume),
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

func (r *ClickhouseRepository) InsertDOMSnapshotBatch(ctx context.Context, rows []model.DOMRow) error {
	if len(rows) == 0 {
		return nil
	}

	batch, err := r.conn.PrepareBatch(ctx, "INSERT INTO clusters_futures_dom")
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

func (r *ClickhouseRepository) GetLatestCandles(ctx context.Context, symbol, timeframe string, limit int) ([]model.Candle, error) {
	query := `
		SELECT
			symbol,
			timeframe,
			candle_open,
			min(price_level) AS low,
			max(price_level) AS high,
			sum(bid_volume) AS total_bid,
			sum(ask_volume) AS total_ask,
			sum(bid_volume - ask_volume) AS total_delta,
			sum(bid_volume + ask_volume) AS total_volume,
			count(*) AS trades_count
		FROM clusters_futures
		WHERE symbol = ? AND timeframe = ?
		GROUP BY symbol, timeframe, candle_open
		ORDER BY candle_open DESC
		LIMIT ?
	`

	rows, err := r.conn.Query(ctx, query, symbol, timeframe, limit)
	if err != nil {
		return nil, fmt.Errorf("query latest candles: %w", err)
	}
	defer rows.Close()

	var candles []model.Candle
	for rows.Next() {
		var c model.Candle
		var low, high, totalBid, totalAsk, totalDelta, totalVolume decimal.Decimal
		if err := rows.Scan(
			&c.Symbol,
			&c.Timeframe,
			&c.CandleOpen,
			&low,
			&high,
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
		c.Open = c.Low
		c.Close = c.High
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
