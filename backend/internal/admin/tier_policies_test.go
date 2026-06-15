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

	// Apply migrations to get the tier_policies table
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

	rows := []struct {
		tier             string
		wantSessionLimit int
		wantHistoryDays  int
	}{
		{"guest", 1, 7},
		{"free", 1, 180},
		{"pro", 2, -1},
		{"vip", 2, -1},
		{"admin", -1, -1},
	}
	for _, r := range rows {
		var sessionLimit, historyDays int
		err := db.QueryRow("SELECT session_limit, history_max_days FROM tier_policies WHERE tier = ?", r.tier).Scan(&sessionLimit, &historyDays)
		if err != nil {
			t.Fatalf("get %s: %v", r.tier, err)
		}
		if sessionLimit != r.wantSessionLimit {
			t.Errorf("tier=%s session_limit: got %d, want %d", r.tier, sessionLimit, r.wantSessionLimit)
		}
		if historyDays != r.wantHistoryDays {
			t.Errorf("tier=%s history_max_days: got %d, want %d", r.tier, historyDays, r.wantHistoryDays)
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

	// Verify session limits match current config values
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

	// Verify history limits match current config values
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
	}
}

func TestUpsertPolicies(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	updated := map[string]TierPolicy{
		"pro": {Tier: "pro", SessionLimit: 5, HistoryMaxDays: 365},
	}
	if err := UpsertPolicies(db, updated); err != nil {
		t.Fatalf("UpsertPolicies: %v", err)
	}

	var sessionLimit, historyDays int
	err := db.QueryRow("SELECT session_limit, history_max_days FROM tier_policies WHERE tier = 'pro'").Scan(&sessionLimit, &historyDays)
	if err != nil {
		t.Fatalf("query pro: %v", err)
	}
	if sessionLimit != 5 {
		t.Errorf("pro session_limit: got %d, want 5", sessionLimit)
	}
	if historyDays != 365 {
		t.Errorf("pro history_max_days: got %d, want 365", historyDays)
	}

	// guest should be unchanged
	err = db.QueryRow("SELECT session_limit FROM tier_policies WHERE tier = 'guest'").Scan(&sessionLimit)
	if err != nil {
		t.Fatalf("query guest: %v", err)
	}
	if sessionLimit != 1 {
		t.Errorf("guest session_limit changed: got %d, want 1", sessionLimit)
	}
}

func TestUpsertPolicies_InsertsNewTier(t *testing.T) {
	db := openTestDB(t)

	// Upsert on empty table should insert
	policies := map[string]TierPolicy{
		"custom": {Tier: "custom", SessionLimit: 3, HistoryMaxDays: 30},
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

	// Manually update a value
	if _, err := db.Exec("UPDATE tier_policies SET session_limit = 99 WHERE tier = 'pro'"); err != nil {
		t.Fatalf("update: %v", err)
	}

	// Re-seed — should NOT revert the manual change
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

	// These values MUST match the current hardcoded behavior in maxDepthForRole
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

func TestSeedTierPolicies_SetsCompressionLocked(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("SeedTierPolicies: %v", err)
	}

	rows := []struct {
		tier       string
		wantLocked int
	}{
		{"guest", 1},
		{"free", 1},
		{"pro", 0},
		{"vip", 0},
		{"admin", 0},
	}
	for _, r := range rows {
		var locked int
		err := db.QueryRow("SELECT chart_compression_locked FROM tier_policies WHERE tier = ?", r.tier).Scan(&locked)
		if err != nil {
			t.Fatalf("get %s: %v", r.tier, err)
		}
		if locked != r.wantLocked {
			t.Errorf("tier=%s chart_compression_locked: got %d, want %d", r.tier, locked, r.wantLocked)
		}
	}
}

func TestGetPolicies_IncludesCompressionLocked(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	policies, err := GetPolicies(db)
	if err != nil {
		t.Fatalf("GetPolicies: %v", err)
	}

	for _, tier := range []string{"guest", "free", "pro", "vip", "admin"} {
		p, ok := policies[tier]
		if !ok {
			t.Errorf("missing policy for %s", tier)
			continue
		}
		if tier == "guest" || tier == "free" {
			if p.ChartCompressionLocked != 1 {
				t.Errorf("tier=%s ChartCompressionLocked: got %d, want 1", tier, p.ChartCompressionLocked)
			}
		} else {
			if p.ChartCompressionLocked != 0 {
				t.Errorf("tier=%s ChartCompressionLocked: got %d, want 0", tier, p.ChartCompressionLocked)
			}
		}
	}
}

func TestLoadCompressionLocked(t *testing.T) {
	db := openTestDB(t)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	m, err := LoadCompressionLocked(db)
	if err != nil {
		t.Fatalf("LoadCompressionLocked: %v", err)
	}
	if m == nil {
		t.Fatal("expected non-nil map")
	}

	expected := map[string]bool{
		"guest": true,
		"free":  true,
		"pro":   false,
		"vip":   false,
		"admin": false,
	}
	for tier, want := range expected {
		got, ok := m[tier]
		if !ok {
			t.Errorf("missing entry for %s", tier)
			continue
		}
		if got != want {
			t.Errorf("compression locked %s: got %v, want %v", tier, got, want)
		}
	}
}

func TestLoadCompressionLocked_EmptyTable_ReturnsNil(t *testing.T) {
	db := openTestDB(t)
	m, err := LoadCompressionLocked(db)
	if err != nil {
		t.Fatalf("LoadCompressionLocked on empty: %v", err)
	}
	if m != nil {
		t.Error("expected nil map on empty table")
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

	// These values MUST match current auth.AuthConfig.SessionLimits defaults
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

func TestEnsureCompressionLockedValues_FixesExistingRows(t *testing.T) {
	db := openTestDB(t)

	// Seed policies (this sets chart_compression_locked correctly for fresh rows)
	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Simulate the bug: set all chart_compression_locked to 0 (as ALTER ADD COLUMN DEFAULT 0 would)
	if _, err := db.Exec("UPDATE tier_policies SET chart_compression_locked = 0"); err != nil {
		t.Fatalf("simulate corruption: %v", err)
	}

	// Verify corruption
	var freeVal int
	db.QueryRow("SELECT chart_compression_locked FROM tier_policies WHERE tier = 'free'").Scan(&freeVal)
	if freeVal != 0 {
		t.Fatalf("expected corrupted free=0, got %d", freeVal)
	}

	// Run repair
	if err := EnsureCompressionLockedValues(db); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	expected := map[string]int{"guest": 1, "free": 1, "pro": 0, "vip": 0, "admin": 0}
	for tier, want := range expected {
		var got int
		if err := db.QueryRow("SELECT chart_compression_locked FROM tier_policies WHERE tier = ?", tier).Scan(&got); err != nil {
			t.Fatalf("query %s: %v", tier, err)
		}
		if got != want {
			t.Errorf("tier %s: got %d, want %d", tier, got, want)
		}
	}
}

func TestEnsureCompressionLockedValues_Idempotent(t *testing.T) {
	db := openTestDB(t)

	if err := SeedTierPolicies(db); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Run twice
	if err := EnsureCompressionLockedValues(db); err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	if err := EnsureCompressionLockedValues(db); err != nil {
		t.Fatalf("second ensure: %v", err)
	}

	var freeVal int
	db.QueryRow("SELECT chart_compression_locked FROM tier_policies WHERE tier = 'free'").Scan(&freeVal)
	if freeVal != 1 {
		t.Errorf("free should be 1 after second ensure, got %d", freeVal)
	}
}
