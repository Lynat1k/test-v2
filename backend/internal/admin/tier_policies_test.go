package admin

import (
	"database/sql"
	"os"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/procluster/procluster/internal/auth"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	f, err := os.CreateTemp("", "tier_policies_test_*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	f.Close()
	_ = os.Remove(f.Name())

	db, err := sql.Open("sqlite", f.Name())
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close(); os.Remove(f.Name()) })

	if err := auth.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestSeedTierPolicies_EmptyDB_Creates5Rows(t *testing.T) {
	db := openTestDB(t)

	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("SeedTierPolicies: %v", err)
	}

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM tier_policies").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 5 {
		t.Fatalf("expected 5 rows, got %d", count)
	}

	type expectedRow struct {
		tier             string
		wantSessionLimit int
		wantHistoryDays  int
		wantCompMax      int
		wantMaxInd       int
		wantWorkspaces   int
	}
	rows := []expectedRow{
		{"guest", 1, 7, 1, 1, 1},
		{"free", 1, 180, 1, 1, 1},
		{"pro", 2, -1, 3, 5, 2},
		{"vip", 2, -1, 6, 15, 2},
		{"admin", -1, -1, 10, 100, 2},
	}
	for _, r := range rows {
		var sessionLimit, historyDays, compMax, maxInd, workspaces int
		err := db.QueryRow("SELECT session_limit, history_max_days, compression_max, max_indicators, workspaces_count FROM tier_policies WHERE tier = ?", r.tier).Scan(&sessionLimit, &historyDays, &compMax, &maxInd, &workspaces)
		if err != nil {
			t.Fatalf("get %s: %v", r.tier, err)
		}
		if sessionLimit != r.wantSessionLimit {
			t.Errorf("tier=%s session_limit: got %d, want %d", r.tier, sessionLimit, r.wantSessionLimit)
		}
		if historyDays != r.wantHistoryDays {
			t.Errorf("tier=%s history_max_days: got %d, want %d", r.tier, historyDays, r.wantHistoryDays)
		}
		if compMax != r.wantCompMax {
			t.Errorf("tier=%s compression_max: got %d, want %d", r.tier, compMax, r.wantCompMax)
		}
		if maxInd != r.wantMaxInd {
			t.Errorf("tier=%s max_indicators: got %d, want %d", r.tier, maxInd, r.wantMaxInd)
		}
		if workspaces != r.wantWorkspaces {
			t.Errorf("tier=%s workspaces_count: got %d, want %d", r.tier, workspaces, r.wantWorkspaces)
		}
	}
}

func TestSeedTierPolicies_Idempotent(t *testing.T) {
	db := openTestDB(t)

	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("first seed: %v", err)
	}
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("second seed: %v", err)
	}

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM tier_policies").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 5 {
		t.Errorf("expected 5 rows after second seed, got %d", count)
	}
}

func TestLoadTierPolicies_ReturnsCorrectMaps(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	sessionLimits, historyLimits, err := LoadTierPolicies(db)
	if err != nil {
		t.Fatalf("LoadTierPolicies: %v", err)
	}

	if sessionLimits == nil || historyLimits == nil {
		t.Fatal("expected non-nil maps")
	}

	expectedSessions := map[string]int{"guest": 1, "free": 1, "pro": 2, "vip": 2, "admin": -1}
	for tier, want := range expectedSessions {
		got, ok := sessionLimits[tier]
		if !ok {
			t.Errorf("missing session limit for tier %s", tier)
			continue
		}
		if got != want {
			t.Errorf("session limit %s: got %d, want %d", tier, got, want)
		}
	}

	expectedHistory := map[string]time.Duration{
		"guest": 7 * 24 * time.Hour,
		"free":  180 * 24 * time.Hour,
		"pro":   -1,
		"vip":   -1,
		"admin": -1,
	}
	for tier, want := range expectedHistory {
		got, ok := historyLimits[tier]
		if !ok {
			t.Errorf("missing history limit for tier %s", tier)
			continue
		}
		if got != want {
			t.Errorf("history limit %s: got %v, want %v", tier, got, want)
		}
	}
}

func TestLoadTierPolicies_EmptyTable_ReturnsNil(t *testing.T) {
	db := openTestDB(t)

	sessionLimits, historyLimits, err := LoadTierPolicies(db)
	if err != nil {
		t.Fatalf("LoadTierPolicies on empty: %v", err)
	}
	if sessionLimits != nil {
		t.Error("expected nil sessionLimits on empty table")
	}
	if historyLimits != nil {
		t.Error("expected nil historyLimits on empty table")
	}
}

func TestGetPolicies(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	policies, err := GetPolicies(db)
	if err != nil {
		t.Fatalf("GetPolicies: %v", err)
	}

	if len(policies) != 5 {
		t.Fatalf("expected 5 policies, got %d", len(policies))
	}

	for _, tier := range []string{"guest", "free", "pro", "vip", "admin"} {
		p, ok := policies[tier]
		if !ok {
			t.Errorf("missing policy for %s", tier)
			continue
		}
		if p.Tier != tier {
			t.Errorf("tier field: got %s, want %s", p.Tier, tier)
		}
		if p.CreatedAt == "" || p.UpdatedAt == "" {
			t.Errorf("timestamps missing for %s", tier)
		}
		if p.HistoryDaysPerTf == nil {
			t.Errorf("historyDaysPerTf missing for %s", tier)
		} else {
			for _, tf := range []string{"1m", "5m", "15m", "30m", "1h", "4h"} {
				if _, ok := p.HistoryDaysPerTf[tf]; !ok {
					t.Errorf("historyDaysPerTf missing timeframe %s for tier %s", tf, tier)
				}
			}
		}
	}
}

func TestGetPolicies_SeedValues(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	policies, err := GetPolicies(db)
	if err != nil {
		t.Fatalf("GetPolicies: %v", err)
	}

	checks := []struct {
		tier      string
		compMax   int
		maxInd    int
		tg        int
		ws        int
		anomalies int
		custom    int
	}{
		{"guest", 1, 1, 0, 1, 0, 0},
		{"free", 1, 1, 0, 1, 0, 0},
		{"pro", 3, 5, 0, 2, 1, 1},
		{"vip", 6, 15, 1, 2, 1, 1},
		{"admin", 10, 100, 1, 2, 1, 1},
	}
	for _, c := range checks {
		p := policies[c.tier]
		if p.CompressionMax != c.compMax {
			t.Errorf("%s compressionMax: got %d, want %d", c.tier, p.CompressionMax, c.compMax)
		}
		if p.MaxIndicators != c.maxInd {
			t.Errorf("%s maxIndicators: got %d, want %d", c.tier, p.MaxIndicators, c.maxInd)
		}
		if p.TelegramEnabled != c.tg {
			t.Errorf("%s telegramEnabled: got %d, want %d", c.tier, p.TelegramEnabled, c.tg)
		}
		if p.WorkspacesCount != c.ws {
			t.Errorf("%s workspacesCount: got %d, want %d", c.tier, p.WorkspacesCount, c.ws)
		}
		if p.AnomaliesEnabled != c.anomalies {
			t.Errorf("%s anomaliesEnabled: got %d, want %d", c.tier, p.AnomaliesEnabled, c.anomalies)
		}
		if p.CustomIndicatorSettings != c.custom {
			t.Errorf("%s customIndicatorSettings: got %d, want %d", c.tier, p.CustomIndicatorSettings, c.custom)
		}
	}
}

func TestUpsertPolicies(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	updated := map[string]TierPolicy{
		"pro": {Tier: "pro", SessionLimit: 5, HistoryMaxDays: 365, CompressionMax: 5, MaxIndicators: 10,
			CustomIndicatorSettings: 1, TelegramEnabled: 0, WorkspacesCount: 2, AnomaliesEnabled: 1,
			HistoryDaysPerTf: map[string]int{"1m": 5, "5m": 10, "15m": 20, "30m": 30, "1h": 60, "4h": 180}},
	}
	if err := UpsertPolicies(db, updated); err != nil {
		t.Fatalf("UpsertPolicies: %v", err)
	}

	var sessionLimit, historyDays, compMax int
	err := db.QueryRow("SELECT session_limit, history_max_days, compression_max FROM tier_policies WHERE tier = 'pro'").Scan(&sessionLimit, &historyDays, &compMax)
	if err != nil {
		t.Fatalf("query pro: %v", err)
	}
	if sessionLimit != 5 {
		t.Errorf("pro session_limit: got %d, want 5", sessionLimit)
	}
	if historyDays != 365 {
		t.Errorf("pro history_max_days: got %d, want 365", historyDays)
	}
	if compMax != 5 {
		t.Errorf("pro compression_max: got %d, want 5", compMax)
	}

	var sessionLimitGuest int
	err = db.QueryRow("SELECT session_limit FROM tier_policies WHERE tier = 'guest'").Scan(&sessionLimitGuest)
	if err != nil {
		t.Fatalf("query guest: %v", err)
	}
	if sessionLimitGuest != 1 {
		t.Errorf("guest session_limit changed: got %d, want 1", sessionLimitGuest)
	}
}

func TestUpsertPolicies_InsertsNewTier(t *testing.T) {
	db := openTestDB(t)

	policies := map[string]TierPolicy{
		"custom": {Tier: "custom", SessionLimit: 3, HistoryMaxDays: 30, CompressionMax: 2,
			HistoryDaysPerTf: map[string]int{"1m": 1, "5m": 2, "15m": 3, "30m": 5, "1h": 10, "4h": 30}},
	}
	if err := UpsertPolicies(db, policies); err != nil {
		t.Fatalf("UpsertPolicies: %v", err)
	}

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM tier_policies").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 row, got %d", count)
	}
}

func TestSeedTierPolicies_MaintainsExistingData(t *testing.T) {
	db := openTestDB(t)

	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("first seed: %v", err)
	}

	if _, err := db.Exec("UPDATE tier_policies SET session_limit = 99 WHERE tier = 'pro'"); err != nil {
		t.Fatalf("update: %v", err)
	}

	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("second seed: %v", err)
	}

	var sessionLimit int
	if err := db.QueryRow("SELECT session_limit FROM tier_policies WHERE tier = 'pro'").Scan(&sessionLimit); err != nil {
		t.Fatalf("query: %v", err)
	}
	if sessionLimit != 99 {
		t.Errorf("seed reverted pro session_limit to %d, want 99", sessionLimit)
	}
}

func TestHistoryDepth_TierPolicyValuesMatchCurrentBehavior(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, historyLimits, err := LoadTierPolicies(db)
	if err != nil {
		t.Fatalf("LoadTierPolicies: %v", err)
	}

	expected := map[string]time.Duration{
		"guest": 7 * 24 * time.Hour,
		"free":  180 * 24 * time.Hour,
		"pro":   -1,
		"vip":   -1,
		"admin": -1,
	}

	for tier, want := range expected {
		got, ok := historyLimits[tier]
		if !ok {
			t.Errorf("missing history limit for %s", tier)
			continue
		}
		if got != want {
			t.Errorf("history limit %s: got %v, want %v", tier, got, want)
		}
	}
}

func TestSessionLimit_TierPolicyValuesMatchCurrentConfig(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	sessionLimits, _, err := LoadTierPolicies(db)
	if err != nil {
		t.Fatalf("LoadTierPolicies: %v", err)
	}

	expected := map[string]int{
		"guest": 1,
		"free":  1,
		"pro":   2,
		"vip":   2,
		"admin": -1,
	}

	for tier, want := range expected {
		got, ok := sessionLimits[tier]
		if !ok {
			t.Errorf("missing session limit for %s", tier)
			continue
		}
		if got != want {
			t.Errorf("session limit %s: got %d, want %d", tier, got, want)
		}
	}
}
