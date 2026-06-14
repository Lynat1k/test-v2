package admin

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/procluster/procluster/internal/config"
)

var symbolRe = regexp.MustCompile(`^[A-Z0-9]{2,10}$`)

type Ticker struct {
	ID                 string    `json:"id"`
	Symbol             string    `json:"symbol"`
	Name               string    `json:"name"`
	PriceTickSpot      float64   `json:"priceTickSpot"`
	PriceTickFutures   float64   `json:"priceTickFutures"`
	CompressionSpot    int       `json:"compressionSpot"`
	CompressionFutures int       `json:"compressionFutures"`
	IsActive           bool      `json:"isActive"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func intToBool(i int) bool {
	return i == 1
}

func validateTicker(t *Ticker) error {
	if t.Symbol == "" {
		return fmt.Errorf("symbol is required")
	}
	if !symbolRe.MatchString(t.Symbol) {
		return fmt.Errorf("symbol must match ^[A-Z0-9]{2,10}$")
	}
	if t.PriceTickSpot <= 0 {
		return fmt.Errorf("PriceTickSpot must be > 0")
	}
	if t.PriceTickFutures <= 0 {
		return fmt.Errorf("PriceTickFutures must be > 0")
	}
	if t.CompressionSpot < 1 {
		return fmt.Errorf("CompressionSpot must be >= 1")
	}
	if t.CompressionFutures < 1 {
		return fmt.Errorf("CompressionFutures must be >= 1")
	}
	return nil
}

func normalizeSymbol(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

func AddTicker(ctx context.Context, db *sql.DB, t *Ticker) error {
	if err := validateTicker(t); err != nil {
		return err
	}

	t.Symbol = normalizeSymbol(t.Symbol)

	id := uuid.New().String()
	now := time.Now().UTC()
	t.ID = id
	t.CreatedAt = now
	t.UpdatedAt = now

	query := `INSERT INTO tickers (id, symbol, name, price_tick_spot, price_tick_futures, compression_spot, compression_futures, is_active, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := db.ExecContext(ctx, query,
		id, t.Symbol, t.Name,
		t.PriceTickSpot, t.PriceTickFutures,
		t.CompressionSpot, t.CompressionFutures,
		boolToInt(t.IsActive),
		t.CreatedAt.Format(time.RFC3339), t.UpdatedAt.Format(time.RFC3339),
	)
	if err != nil {
		log.Printf("[admin] add ticker: %v", err)
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("ticker with symbol %s already exists", t.Symbol)
		}
		return fmt.Errorf("add ticker: %w", err)
	}
	return nil
}

func GetTickerByID(ctx context.Context, db *sql.DB, id string) (*Ticker, error) {
	query := `SELECT id, symbol, name, price_tick_spot, price_tick_futures, compression_spot, compression_futures, is_active, created_at, updated_at
		FROM tickers WHERE id = ?`

	t := &Ticker{}
	var isActive int
	var name sql.NullString
	var createdAt, updatedAt string
	err := db.QueryRowContext(ctx, query, id).Scan(
		&t.ID, &t.Symbol, &name,
		&t.PriceTickSpot, &t.PriceTickFutures,
		&t.CompressionSpot, &t.CompressionFutures,
		&isActive, &createdAt, &updatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		log.Printf("[admin] get ticker by id: %v", err)
		return nil, fmt.Errorf("get ticker: %w", err)
	}
	t.Name = name.String
	t.IsActive = intToBool(isActive)
	t.CreatedAt = parseTime(createdAt)
	t.UpdatedAt = parseTime(updatedAt)
	return t, nil
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	// Strip monotonic clock suffix " m=+..." which modernc.org/sqlite appends
	if idx := strings.Index(s, " m="); idx >= 0 {
		s = s[:idx]
	}
	for _, layout := range []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05.999999999 -0700 MST",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	log.Printf("[admin] parseTime: unrecognised format %q", s)
	return time.Time{}
}

func ListTickers(ctx context.Context, db *sql.DB) ([]Ticker, error) {
	query := `SELECT id, symbol, name, price_tick_spot, price_tick_futures, compression_spot, compression_futures, is_active, created_at, updated_at
		FROM tickers ORDER BY symbol ASC`

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		log.Printf("[admin] list tickers query error: %v", err)
		return nil, fmt.Errorf("list tickers query: %w", err)
	}
	defer rows.Close()

	var tickers []Ticker
	for rows.Next() {
		var t Ticker
		var isActive int
		var name sql.NullString
		var createdAt, updatedAt string
		if err := rows.Scan(
			&t.ID, &t.Symbol, &name,
			&t.PriceTickSpot, &t.PriceTickFutures,
			&t.CompressionSpot, &t.CompressionFutures,
			&isActive, &createdAt, &updatedAt,
		); err != nil {
			log.Printf("[admin] list tickers scan error: %v", err)
			return nil, fmt.Errorf("list tickers scan: %w", err)
		}
		t.Name = name.String
		t.IsActive = intToBool(isActive)
		t.CreatedAt = parseTime(createdAt)
		t.UpdatedAt = parseTime(updatedAt)
		tickers = append(tickers, t)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[admin] list tickers rows error: %v", err)
		return nil, fmt.Errorf("list tickers rows: %w", err)
	}
	if tickers == nil {
		tickers = []Ticker{}
	}
	return tickers, nil
}

func UpdateTicker(ctx context.Context, db *sql.DB, t *Ticker) error {
	if err := validateTicker(t); err != nil {
		return err
	}

	t.Symbol = normalizeSymbol(t.Symbol)
	t.UpdatedAt = time.Now().UTC()

	query := `UPDATE tickers SET symbol = ?, name = ?, price_tick_spot = ?, price_tick_futures = ?, compression_spot = ?, compression_futures = ?, is_active = ?, updated_at = ?
		WHERE id = ?`

	res, err := db.ExecContext(ctx, query,
		t.Symbol, t.Name,
		t.PriceTickSpot, t.PriceTickFutures,
		t.CompressionSpot, t.CompressionFutures,
		boolToInt(t.IsActive),
		t.UpdatedAt.Format(time.RFC3339), t.ID,
	)
	if err != nil {
		log.Printf("[admin] update ticker: %v", err)
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("ticker with symbol %s already exists", t.Symbol)
		}
		return fmt.Errorf("update ticker: %w", err)
	}

	rows, err := res.RowsAffected()
	if err != nil {
		log.Printf("[admin] update ticker rows affected: %v", err)
		return fmt.Errorf("update ticker rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("ticker not found")
	}
	return nil
}

func DeleteTicker(ctx context.Context, db *sql.DB, id string) error {
	query := `DELETE FROM tickers WHERE id = ?`

	res, err := db.ExecContext(ctx, query, id)
	if err != nil {
		log.Printf("[admin] delete ticker: %v", err)
		return fmt.Errorf("delete ticker: %w", err)
	}

	rows, err := res.RowsAffected()
	if err != nil {
		log.Printf("[admin] delete ticker rows affected: %v", err)
		return fmt.Errorf("delete ticker rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("ticker not found")
	}
	return nil
}

func SeedDefaultTickers(ctx context.Context, db *sql.DB) error {
	var count int
	err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM tickers").Scan(&count)
	if err != nil {
		log.Printf("[admin] seed tickers count: %v", err)
		return fmt.Errorf("seed tickers count: %w", err)
	}
	if count > 0 {
		return nil
	}

	t := &Ticker{
		Symbol:             "BTCUSDT",
		Name:               "Bitcoin",
		PriceTickSpot:      0.01,
		PriceTickFutures:   0.1,
		CompressionSpot:    500,
		CompressionFutures: 25,
		IsActive:           true,
	}

	if err := AddTicker(ctx, db, t); err != nil {
		log.Printf("[admin] seed default ticker: %v", err)
		return fmt.Errorf("seed default ticker: %w", err)
	}
	log.Printf("[admin] seeded default ticker: %s", t.Symbol)
	return nil
}

func SymbolConfigsFromTickers(tickers []Ticker) map[string]config.SymbolConfig {
	m := make(map[string]config.SymbolConfig)
	for _, t := range tickers {
		if !t.IsActive {
			continue
		}

		symbol := strings.ToUpper(t.Symbol)

		futuresKey := fmt.Sprintf("%s:%s", symbol, "futures")
		m[futuresKey] = config.SymbolConfig{
			Symbol:       symbol,
			Market:       "futures",
			PriceTick:    t.PriceTickFutures,
			BaseLevel:    float64(t.CompressionFutures),
			SnapInterval: time.Minute,
		}

		spotKey := fmt.Sprintf("%s:%s", symbol, "spot")
		m[spotKey] = config.SymbolConfig{
			Symbol:       symbol,
			Market:       "spot",
			PriceTick:    t.PriceTickSpot,
			BaseLevel:    float64(t.CompressionSpot),
			SnapInterval: 15 * time.Minute,
		}
	}
	return m
}
