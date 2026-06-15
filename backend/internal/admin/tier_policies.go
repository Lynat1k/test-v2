package admin

import (
	"database/sql"
	"fmt"
	"log"
	"time"
)

type TierPolicy struct {
	Tier                   string `json:"tier"`
	SessionLimit           int    `json:"sessionLimit"`
	HistoryMaxDays         int    `json:"historyMaxDays"`
	ChartCompressionLocked int    `json:"chartCompressionLocked"`
	CreatedAt              string `json:"createdAt"`
	UpdatedAt              string `json:"updatedAt"`
}

var defaultTierPolicies = []struct {
	Tier                   string
	SessionLimit           int
	HistoryMaxDays         int
	ChartCompressionLocked int
}{
	{"guest", 1, 7, 1},
	{"free", 1, 180, 1},
	{"pro", 2, -1, 0},
	{"vip", 2, -1, 0},
	{"admin", -1, -1, 0},
}

func SeedTierPolicies(db *sql.DB) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM tier_policies").Scan(&count); err != nil {
		return fmt.Errorf("check tier_policies count: %w", err)
	}
	if count > 0 {
		log.Printf("[admin] tier_policies already seeded (%d rows), skipping", count)
		return nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	for _, p := range defaultTierPolicies {
		_, err := db.Exec(
			`INSERT INTO tier_policies (tier, session_limit, history_max_days, chart_compression_locked, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			p.Tier, p.SessionLimit, p.HistoryMaxDays, p.ChartCompressionLocked, now, now,
		)
		if err != nil {
			return fmt.Errorf("seed tier_policy %s: %w", p.Tier, err)
		}
	}
	log.Printf("[admin] seeded %d tier_policies", len(defaultTierPolicies))
	return nil
}

func LoadTierPolicies(db *sql.DB) (sessionLimits map[string]int, historyLimits map[string]time.Duration, err error) {
	rows, err := db.Query("SELECT tier, session_limit, history_max_days FROM tier_policies")
	if err != nil {
		return nil, nil, fmt.Errorf("query tier_policies: %w", err)
	}
	defer rows.Close()

	sessionLimits = make(map[string]int)
	historyLimits = make(map[string]time.Duration)

	for rows.Next() {
		var tier string
		var sessionLimit, historyMaxDays int
		if err := rows.Scan(&tier, &sessionLimit, &historyMaxDays); err != nil {
			return nil, nil, fmt.Errorf("scan tier_policy: %w", err)
		}

		sessionLimits[tier] = sessionLimit

		if historyMaxDays < 0 {
			historyLimits[tier] = -1
		} else {
			historyLimits[tier] = time.Duration(historyMaxDays) * 24 * time.Hour
		}
	}

	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("rows err: %w", err)
	}

	if len(sessionLimits) == 0 {
		log.Println("[admin] tier_policies table is empty, returning nil (fallback to config)")
		return nil, nil, nil
	}

	log.Printf("[admin] loaded %d tier_policies", len(sessionLimits))
	return sessionLimits, historyLimits, nil
}

func GetPolicies(db *sql.DB) (map[string]TierPolicy, error) {
	rows, err := db.Query("SELECT tier, session_limit, history_max_days, chart_compression_locked, created_at, updated_at FROM tier_policies")
	if err != nil {
		return nil, fmt.Errorf("query tier_policies: %w", err)
	}
	defer rows.Close()

	policies := make(map[string]TierPolicy)
	for rows.Next() {
		var p TierPolicy
		if err := rows.Scan(&p.Tier, &p.SessionLimit, &p.HistoryMaxDays, &p.ChartCompressionLocked, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan tier_policy: %w", err)
		}
		policies[p.Tier] = p
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows err: %w", err)
	}
	return policies, nil
}

func LoadCompressionLocked(db *sql.DB) (map[string]bool, error) {
	rows, err := db.Query("SELECT tier, chart_compression_locked FROM tier_policies")
	if err != nil {
		return nil, fmt.Errorf("query compression_locked: %w", err)
	}
	defer rows.Close()

	m := make(map[string]bool)
	for rows.Next() {
		var tier string
		var locked int
		if err := rows.Scan(&tier, &locked); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		m[tier] = locked == 1
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows err: %w", err)
	}

	if len(m) == 0 {
		return nil, nil
	}
	return m, nil
}

// EnsureCompressionLockedValues idempotently sets correct chart_compression_locked values
// for existing tier_policies rows. This repairs data when the column was added via ALTER TABLE
// AFTER the initial seed, leaving existing rows with DEFAULT 0 instead of the correct values.
func EnsureCompressionLockedValues(db *sql.DB) error {
	for _, p := range defaultTierPolicies {
		_, err := db.Exec(
			`UPDATE tier_policies SET chart_compression_locked = ?, updated_at = ? WHERE tier = ?`,
			p.ChartCompressionLocked, time.Now().UTC().Format(time.RFC3339), p.Tier,
		)
		if err != nil {
			return fmt.Errorf("update compression_locked for %s: %w", p.Tier, err)
		}
	}
	log.Println("[admin] ensured chart_compression_locked values for tier_policies")
	return nil
}

func UpsertPolicies(db *sql.DB, policies map[string]TierPolicy) error {
	now := time.Now().UTC().Format(time.RFC3339)
	for _, p := range policies {
		_, err := db.Exec(
			`INSERT INTO tier_policies (tier, session_limit, history_max_days, chart_compression_locked, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(tier) DO UPDATE SET session_limit=excluded.session_limit, history_max_days=excluded.history_max_days, chart_compression_locked=excluded.chart_compression_locked, updated_at=excluded.updated_at`,
			p.Tier, p.SessionLimit, p.HistoryMaxDays, p.ChartCompressionLocked, now, now,
		)
		if err != nil {
			return fmt.Errorf("upsert tier_policy %s: %w", p.Tier, err)
		}
	}
	return nil
}
