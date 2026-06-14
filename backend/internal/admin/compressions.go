package admin

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
)

// DefaultCompression represents a default chart compression for a ticker/market/timeframe.
type DefaultCompression struct {
	ID         string    `json:"id"`
	Symbol     string    `json:"symbol"`
	Market     string    `json:"market"`
	Timeframe  string    `json:"timeframe"`
	Multiplier int       `json:"multiplier"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

var validTimeframes = map[string]bool{
	"1m": true, "5m": true, "15m": true,
	"30m": true, "1h": true, "4h": true,
}

var spotAllowedTimeframes = map[string]bool{
	"15m": true, "30m": true, "1h": true, "4h": true,
}

var validMarkets = map[string]bool{
	"futures": true, "spot": true,
}

// GetDefaultCompressions returns all default compressions for a symbol across all markets and timeframes.
func GetDefaultCompressions(ctx context.Context, db *sql.DB, symbol string) ([]DefaultCompression, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, symbol, market, timeframe, multiplier, updated_at
		FROM default_compressions
		WHERE symbol = ?
		ORDER BY market, timeframe
	`, symbol)
	if err != nil {
		return nil, fmt.Errorf("query default compressions: %w", err)
	}
	defer rows.Close()

	var compressions []DefaultCompression
	for rows.Next() {
		var c DefaultCompression
		var updatedAt string
		if err := rows.Scan(&c.ID, &c.Symbol, &c.Market, &c.Timeframe, &c.Multiplier, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan default compression: %w", err)
		}
		c.UpdatedAt = parseTime(updatedAt)
		compressions = append(compressions, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate default compressions: %w", err)
	}
	return compressions, nil
}

// UpsertDefaultCompression inserts or replaces a default compression.
func UpsertDefaultCompression(ctx context.Context, db *sql.DB, symbol, market, timeframe string, multiplier int) error {
	if multiplier < 1 {
		return fmt.Errorf("multiplier must be >= 1")
	}
	if !validTimeframes[timeframe] {
		return fmt.Errorf("invalid timeframe: %s", timeframe)
	}
	if market == "spot" && !spotAllowedTimeframes[timeframe] {
		return fmt.Errorf("timeframe %s is not allowed for spot market", timeframe)
	}
	if !validMarkets[market] {
		return fmt.Errorf("invalid market: %s", market)
	}

	now := time.Now()
	_, err := db.ExecContext(ctx, `
		INSERT INTO default_compressions (id, symbol, market, timeframe, multiplier, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(symbol, market, timeframe) DO UPDATE SET multiplier=?, updated_at=?
	`, uuid.New().String(), symbol, market, timeframe, multiplier, now, multiplier, now)
	if err != nil {
		return fmt.Errorf("upsert default compression: %w", err)
	}
	return nil
}

// UpsertDefaultCompressionsBatch performs a batch upsert for multiple compressions.
func UpsertDefaultCompressionsBatch(ctx context.Context, db *sql.DB, symbol string, compressions []DefaultCompression) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO default_compressions (id, symbol, market, timeframe, multiplier, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(symbol, market, timeframe) DO UPDATE SET multiplier=?, updated_at=?
	`)
	if err != nil {
		return fmt.Errorf("prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, c := range compressions {
		if c.Multiplier < 1 {
			return fmt.Errorf("multiplier must be >= 1")
		}
		if !validTimeframes[c.Timeframe] {
			return fmt.Errorf("invalid timeframe: %s", c.Timeframe)
		}
		if c.Market == "spot" && !spotAllowedTimeframes[c.Timeframe] {
			return fmt.Errorf("timeframe %s is not allowed for spot market", c.Timeframe)
		}
		if !validMarkets[c.Market] {
			return fmt.Errorf("invalid market: %s", c.Market)
		}

		now := time.Now()
		if c.ID == "" {
			c.ID = uuid.New().String()
		}
		_, err := stmt.ExecContext(ctx, c.ID, symbol, c.Market, c.Timeframe, c.Multiplier, now, c.Multiplier, now)
		if err != nil {
			return fmt.Errorf("upsert compression for %s/%s/%s: %w", symbol, c.Market, c.Timeframe, err)
		}
	}

	return tx.Commit()
}

// ValidateCompressionMultiplier checks if the multiplier meets the base compression requirement.
func ValidateCompressionMultiplier(ctx context.Context, db *sql.DB, symbol, market string, multiplier int) error {
	var baseCompression int
	query := fmt.Sprintf("SELECT compression_%s FROM tickers WHERE symbol = ?", market)
	err := db.QueryRowContext(ctx, query, symbol).Scan(&baseCompression)
	if err == sql.ErrNoRows {
		return fmt.Errorf("ticker %s not found", symbol)
	} else if err != nil {
		return fmt.Errorf("get base compression: %w", err)
	}

	if multiplier < baseCompression {
		return fmt.Errorf("compression multiplier %d is less than base compression %d for %s:%s", multiplier, baseCompression, symbol, market)
	}
	return nil
}

// SeedDefaultCompressions seeds the default compressions table for BTCUSDT if empty.
func SeedDefaultCompressions(ctx context.Context, db *sql.DB) error {
	var count int
	err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM default_compressions").Scan(&count)
	if err != nil {
		return fmt.Errorf("count default compressions: %w", err)
	}
	if count > 0 {
		return nil
	}

	seeds := []struct {
		Market     string
		Timeframe  string
		Multiplier int
	}{
		{"futures", "1m", 25},
		{"futures", "5m", 25},
		{"futures", "15m", 50},
		{"futures", "30m", 50},
		{"futures", "1h", 100},
		{"futures", "4h", 100},
		{"spot", "15m", 500},
		{"spot", "30m", 500},
		{"spot", "1h", 1000},
		{"spot", "4h", 1000},
	}

	now := time.Now()
	for _, s := range seeds {
		_, err := db.ExecContext(ctx, `
			INSERT INTO default_compressions (id, symbol, market, timeframe, multiplier, updated_at)
			VALUES (?, 'BTCUSDT', ?, ?, ?, ?)
		`, uuid.New().String(), s.Market, s.Timeframe, s.Multiplier, now)
		if err != nil {
			return fmt.Errorf("seed default compression for BTCUSDT/%s/%s: %w", s.Market, s.Timeframe, err)
		}
	}
	return nil
}

// SeedDefaultCompressionsForSymbol seeds default compressions for a specific symbol if none exist.
func SeedDefaultCompressionsForSymbol(ctx context.Context, db *sql.DB, symbol string, ticker *Ticker) error {
	var count int
	err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM default_compressions WHERE symbol = ?", symbol).Scan(&count)
	if err != nil {
		return fmt.Errorf("count compressions for %s: %w", symbol, err)
	}
	if count > 0 {
		return nil
	}

	log.Printf("[admin] seeding default compressions for %s", symbol)

	seeds := []struct {
		Market     string
		Timeframe  string
		Multiplier int
	}{
		{"futures", "1m", ticker.CompressionFutures},
		{"futures", "5m", ticker.CompressionFutures},
		{"futures", "15m", ticker.CompressionFutures * 2},
		{"futures", "30m", ticker.CompressionFutures * 2},
		{"futures", "1h", ticker.CompressionFutures * 4},
		{"futures", "4h", ticker.CompressionFutures * 4},
		{"spot", "15m", ticker.CompressionSpot},
		{"spot", "30m", ticker.CompressionSpot},
		{"spot", "1h", ticker.CompressionSpot * 2},
		{"spot", "4h", ticker.CompressionSpot * 2},
	}

	now := time.Now()
	for _, s := range seeds {
		_, err := db.ExecContext(ctx, `
			INSERT INTO default_compressions (id, symbol, market, timeframe, multiplier, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, uuid.New().String(), symbol, s.Market, s.Timeframe, s.Multiplier, now)
		if err != nil {
			return fmt.Errorf("seed compression for %s/%s/%s: %w", symbol, s.Market, s.Timeframe, err)
		}
	}
	log.Printf("[admin] seeded %d default compressions for %s", len(seeds), symbol)
	return nil
}

// DeleteDefaultCompressionsForSymbol deletes all default compressions for a symbol.
func DeleteDefaultCompressionsForSymbol(ctx context.Context, db *sql.DB, symbol string) error {
	_, err := db.ExecContext(ctx, "DELETE FROM default_compressions WHERE symbol = ?", symbol)
	if err != nil {
		return fmt.Errorf("delete default compressions for symbol %s: %w", symbol, err)
	}
	return nil
}
