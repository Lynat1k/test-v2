package admin

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"
)

type TierPolicy struct {
	Tier                    string         `json:"tier"`
	SessionLimit            int            `json:"sessionLimit"`
	HistoryMaxDays          int            `json:"historyMaxDays"`
	CompressionMax          int            `json:"compressionMax"`
	MaxIndicators           int            `json:"maxIndicators"`
	CustomIndicatorSettings int            `json:"customIndicatorSettings"`
	TelegramEnabled         int            `json:"telegramEnabled"`
	WorkspacesCount         int            `json:"workspacesCount"`
	AnomaliesEnabled        int            `json:"anomaliesEnabled"`
	HistoryDaysPerTf        map[string]int `json:"historyDaysPerTf"`
	GatedIndicators         []string       `json:"gatedIndicators"`
	CreatedAt               string         `json:"createdAt"`
	UpdatedAt               string         `json:"updatedAt"`
}

const defaultHistoryDaysPerTf = `{"1m":1,"5m":1,"15m":1,"30m":1,"1h":1,"4h":1}`

var defaultTierPolicies = []struct {
	Tier                    string
	SessionLimit            int
	HistoryMaxDays          int
	CompressionMax          int
	MaxIndicators           int
	CustomIndicatorSettings int
	TelegramEnabled         int
	WorkspacesCount         int
	AnomaliesEnabled        int
	HistoryDaysPerTf        string
	GatedIndicators         string
}{
	{"guest", 1, 7, 1, 1, 0, 0, 1, 0, `{"1m":1,"5m":1,"15m":1,"30m":1,"1h":1,"4h":1}`, `["buySellZone"]`},
	{"free", 1, 180, 1, 1, 0, 0, 1, 0, `{"1m":1,"5m":1,"15m":1,"30m":1,"1h":1,"4h":1}`, `["buySellZone"]`},
	{"pro", 2, -1, 3, 5, 1, 0, 2, 1, `{"1m":3,"5m":7,"15m":14,"30m":30,"1h":60,"4h":180}`, `["buySellZone"]`},
	{"vip", 2, -1, 6, 15, 1, 1, 2, 1, `{"1m":7,"5m":14,"15m":30,"30m":60,"1h":120,"4h":360}`, `["buySellZone"]`},
	{"admin", -1, -1, 10, -1, 1, 1, 2, 1, `{"1m":14,"5m":30,"15m":60,"30m":120,"1h":240,"4h":720}`, `[]`},
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
			`INSERT INTO tier_policies (tier, session_limit, history_max_days, compression_max, max_indicators,
			 custom_indicator_settings, telegram_enabled, workspaces_count, anomalies_enabled, history_days_per_tf,
			 gated_indicators, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			p.Tier, p.SessionLimit, p.HistoryMaxDays, p.CompressionMax, p.MaxIndicators,
			p.CustomIndicatorSettings, p.TelegramEnabled, p.WorkspacesCount, p.AnomaliesEnabled, p.HistoryDaysPerTf,
			p.GatedIndicators, now, now,
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

func LoadCompressionMax(db *sql.DB) (map[string]int, error) {
	rows, err := db.Query("SELECT tier, compression_max FROM tier_policies")
	if err != nil {
		return nil, fmt.Errorf("query compression_max: %w", err)
	}
	defer rows.Close()

	m := make(map[string]int)
	for rows.Next() {
		var tier string
		var compMax int
		if err := rows.Scan(&tier, &compMax); err != nil {
			return nil, fmt.Errorf("scan compression_max: %w", err)
		}
		m[tier] = compMax
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows err: %w", err)
	}
	if len(m) == 0 {
		return nil, nil
	}
	return m, nil
}

func GetLimitsForTier(db *sql.DB, tier string) (TierPolicy, error) {
	var p TierPolicy
	var historyDaysPerTf string
	err := db.QueryRow(`SELECT tier, session_limit, history_max_days, compression_max, max_indicators,
		custom_indicator_settings, telegram_enabled, workspaces_count, anomalies_enabled, history_days_per_tf,
		created_at, updated_at FROM tier_policies WHERE tier = ?`, tier).Scan(
		&p.Tier, &p.SessionLimit, &p.HistoryMaxDays, &p.CompressionMax, &p.MaxIndicators,
		&p.CustomIndicatorSettings, &p.TelegramEnabled, &p.WorkspacesCount, &p.AnomaliesEnabled, &historyDaysPerTf,
		&p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return TierPolicy{}, err
	}
	p.HistoryDaysPerTf = make(map[string]int)
	if err := json.Unmarshal([]byte(historyDaysPerTf), &p.HistoryDaysPerTf); err != nil {
		p.HistoryDaysPerTf = map[string]int{"1m": 1, "5m": 1, "15m": 1, "30m": 1, "1h": 1, "4h": 1}
	}
	return p, nil
}

func GetPolicies(db *sql.DB) (map[string]TierPolicy, error) {
	rows, err := db.Query(`SELECT tier, session_limit, history_max_days, compression_max, max_indicators,
		custom_indicator_settings, telegram_enabled, workspaces_count, anomalies_enabled, history_days_per_tf,
		gated_indicators, created_at, updated_at FROM tier_policies`)
	if err != nil {
		return nil, fmt.Errorf("query tier_policies: %w", err)
	}
	defer rows.Close()

	policies := make(map[string]TierPolicy)
	for rows.Next() {
		var p TierPolicy
		var historyDaysPerTf string
		var gatedIndicators string
		if err := rows.Scan(&p.Tier, &p.SessionLimit, &p.HistoryMaxDays, &p.CompressionMax, &p.MaxIndicators,
			&p.CustomIndicatorSettings, &p.TelegramEnabled, &p.WorkspacesCount, &p.AnomaliesEnabled, &historyDaysPerTf,
			&gatedIndicators, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan tier_policy: %w", err)
		}
		p.HistoryDaysPerTf = make(map[string]int)
		if err := json.Unmarshal([]byte(historyDaysPerTf), &p.HistoryDaysPerTf); err != nil {
			p.HistoryDaysPerTf = map[string]int{"1m": 1, "5m": 1, "15m": 1, "30m": 1, "1h": 1, "4h": 1}
		}
		p.GatedIndicators = parseGatedIndicators(gatedIndicators)
		policies[p.Tier] = p
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows err: %w", err)
	}
	return policies, nil
}

// PublicTierPolicy is the subset of TierPolicy fields exposed to
// unauthenticated callers (plan comparison cards). Omits timestamps.
type PublicTierPolicy struct {
	Tier                    string         `json:"tier"`
	SessionLimit            int            `json:"sessionLimit"`
	HistoryMaxDays          int            `json:"historyMaxDays"`
	CompressionMax          int            `json:"compressionMax"`
	MaxIndicators           int            `json:"maxIndicators"`
	CustomIndicatorSettings int            `json:"customIndicatorSettings"`
	TelegramEnabled         int            `json:"telegramEnabled"`
	WorkspacesCount         int            `json:"workspacesCount"`
	AnomaliesEnabled        int            `json:"anomaliesEnabled"`
	HistoryDaysPerTf        map[string]int `json:"historyDaysPerTf"`
}

// GetPublicPolicies returns only free/pro/vip tiers with fields needed by the
// plan-comparison cards. No auth required. Omits admin/guest and timestamps.
func GetPublicPolicies(db *sql.DB) (map[string]PublicTierPolicy, error) {
	all, err := GetPolicies(db)
	if err != nil {
		return nil, err
	}
	public := make(map[string]PublicTierPolicy, 3)
	for _, tier := range []string{"free", "pro", "vip"} {
		p, ok := all[tier]
		if !ok {
			continue
		}
		public[tier] = PublicTierPolicy{
			Tier:                    p.Tier,
			SessionLimit:            p.SessionLimit,
			HistoryMaxDays:          p.HistoryMaxDays,
			CompressionMax:          p.CompressionMax,
			MaxIndicators:           p.MaxIndicators,
			CustomIndicatorSettings: p.CustomIndicatorSettings,
			TelegramEnabled:         p.TelegramEnabled,
			WorkspacesCount:         p.WorkspacesCount,
			AnomaliesEnabled:        p.AnomaliesEnabled,
			HistoryDaysPerTf:        p.HistoryDaysPerTf,
		}
	}
	return public, nil
}

// parseGatedIndicators decodes the gated_indicators JSON column into a string
// slice. Empty/NULL/corrupt values degrade to an empty (non-nil) slice so the
// JSON response always serializes as [] rather than null.
func parseGatedIndicators(s string) []string {
	out := []string{}
	if s == "" {
		return out
	}
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return []string{}
	}
	if out == nil {
		return []string{}
	}
	return out
}

func UpsertPolicies(db *sql.DB, policies map[string]TierPolicy) error {
	now := time.Now().UTC().Format(time.RFC3339)
	for _, p := range policies {
		historyDaysPerTfJSON, err := json.Marshal(p.HistoryDaysPerTf)
		if err != nil {
			return fmt.Errorf("marshal history_days_per_tf for %s: %w", p.Tier, err)
		}
		gated := p.GatedIndicators
		if gated == nil {
			gated = []string{}
		}
		gatedIndicatorsJSON, err := json.Marshal(gated)
		if err != nil {
			return fmt.Errorf("marshal gated_indicators for %s: %w", p.Tier, err)
		}
		_, err = db.Exec(
			`INSERT INTO tier_policies (tier, session_limit, history_max_days, compression_max, max_indicators,
			 custom_indicator_settings, telegram_enabled, workspaces_count, anomalies_enabled, history_days_per_tf,
			 gated_indicators, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(tier) DO UPDATE SET
			 session_limit=excluded.session_limit, history_max_days=excluded.history_max_days,
			 compression_max=excluded.compression_max, max_indicators=excluded.max_indicators,
			 custom_indicator_settings=excluded.custom_indicator_settings, telegram_enabled=excluded.telegram_enabled,
			 workspaces_count=excluded.workspaces_count, anomalies_enabled=excluded.anomalies_enabled,
			 history_days_per_tf=excluded.history_days_per_tf, gated_indicators=excluded.gated_indicators,
			 updated_at=excluded.updated_at`,
			p.Tier, p.SessionLimit, p.HistoryMaxDays, p.CompressionMax, p.MaxIndicators,
			p.CustomIndicatorSettings, p.TelegramEnabled, p.WorkspacesCount, p.AnomaliesEnabled,
			string(historyDaysPerTfJSON), string(gatedIndicatorsJSON), now, now,
		)
		if err != nil {
			return fmt.Errorf("upsert tier_policy %s: %w", p.Tier, err)
		}
	}
	return nil
}
