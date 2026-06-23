package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func makeTestUser(t *testing.T, db *sql.DB, email string) string {
	t.Helper()
	u := &User{
		Email:         email,
		Nickname:      strings.ReplaceAll(email, "@", "_"),
		PasswordHash:  "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:          "Free",
		EmailVerified: true,
	}
	if err := CreateUser(context.Background(), db, u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return u.ID
}

func TestUserIndicatorCRUD(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()
	uid := makeTestUser(t, db, "crud@test.com")

	if _, exists, err := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m"); err != nil || exists {
		t.Fatalf("expected no row, got exists=%v err=%v", exists, err)
	}

	body := `[{"id":"cvd","isActive":true,"settings":{}}]`
	if err := UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m", body); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got, exists, err := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if err != nil || !exists || got != body {
		t.Fatalf("after upsert: exists=%v err=%v got=%s", exists, err, got)
	}

	// Update same PK
	body2 := `[{"id":"cvd","isActive":false,"settings":{}}]`
	if err := UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m", body2); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, _, _ = GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if got != body2 {
		t.Fatalf("update mismatch: got=%s want=%s", got, body2)
	}

	// Delete
	if err := DeleteUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, exists, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m"); exists {
		t.Fatalf("expected row gone after delete")
	}

	// Delete non-existent → sql.ErrNoRows
	if err := DeleteUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("delete missing: expected ErrNoRows, got %v", err)
	}
}

func TestMergeAddUserIndicator(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()
	uid := makeTestUser(t, db, "merge@test.com")

	// Empty starting state — merge-add inserts as-is
	first := `[{"id":"cvd","settings":{}}]`
	if err := MergeAddUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*", first); err != nil {
		t.Fatalf("merge into empty: %v", err)
	}
	got, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
	if !strings.Contains(got, `"id":"cvd"`) {
		t.Fatalf("after first merge: %s", got)
	}

	// Add a new id — appended
	if err := MergeAddUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*",
		`[{"id":"delta","settings":{}}]`); err != nil {
		t.Fatalf("merge new id: %v", err)
	}
	got, _, _ = GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
	var arr []map[string]interface{}
	if err := json.Unmarshal([]byte(got), &arr); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(arr) != 2 {
		t.Fatalf("expected 2 entries, got %d in %s", len(arr), got)
	}

	// Re-add cvd — must NOT duplicate (idempotent)
	if err := MergeAddUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*",
		`[{"id":"cvd","settings":{"changed":true}}]`); err != nil {
		t.Fatalf("merge dup id: %v", err)
	}
	got, _, _ = GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
	_ = json.Unmarshal([]byte(got), &arr)
	if len(arr) != 2 {
		t.Fatalf("dup must not append: %s", got)
	}
	// The pre-existing cvd settings stay (merge-add does not overwrite)
	for _, it := range arr {
		if it["id"] == "cvd" {
			if _, hasChanged := it["settings"].(map[string]interface{})["changed"]; hasChanged {
				t.Fatalf("merge-add overwrote existing cvd settings: %s", got)
			}
		}
	}

	// Malformed JSON — error, no mutation
	before := got
	err := MergeAddUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*", `{"not":"an array"}`)
	if err == nil {
		t.Fatalf("expected error on non-array JSON")
	}
	after, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
	if after != before {
		t.Fatalf("row mutated despite error: before=%s after=%s", before, after)
	}
}

// parseArr parses an indicators_json row into a slice of maps for assertion.
func parseArr(t *testing.T, s string) []map[string]interface{} {
	t.Helper()
	if s == "" {
		return nil
	}
	var arr []map[string]interface{}
	if err := json.Unmarshal([]byte(s), &arr); err != nil {
		t.Fatalf("parse %s: %v", s, err)
	}
	return arr
}

// findByID locates the item with the given id and reports missing.
func findByID(arr []map[string]interface{}, id string) map[string]interface{} {
	for _, it := range arr {
		if v, _ := it["id"].(string); v == id {
			return it
		}
	}
	return nil
}

func TestPropagateUserIndicator(t *testing.T) {
	t.Run("a) no rows -> creates only '*' row", func(t *testing.T) {
		db := setupTestDB(t)
		defer db.Close()
		ctx := context.Background()
		uid := makeTestUser(t, db, "propa@test.com")

		one := json.RawMessage(`{"id":"cvd","isActive":true,"settings":{"color":"red"}}`)
		if err := PropagateUserIndicator(ctx, db, uid, "BTCUSDT", "futures", one); err != nil {
			t.Fatalf("propagate: %v", err)
		}

		// '*' row exists with [cvd]
		got, exists, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
		if !exists {
			t.Fatalf("'*' row missing")
		}
		arr := parseArr(t, got)
		if len(arr) != 1 || findByID(arr, "cvd") == nil {
			t.Fatalf("'*' content wrong: %s", got)
		}

		// No per-tf rows created
		rows, _ := db.QueryContext(ctx,
			`SELECT timeframe FROM user_indicators WHERE user_id=? AND symbol=? AND market=?`,
			uid, "BTCUSDT", "futures")
		defer rows.Close()
		var tfs []string
		for rows.Next() {
			var tf string
			_ = rows.Scan(&tf)
			tfs = append(tfs, tf)
		}
		if len(tfs) != 1 || tfs[0] != "*" {
			t.Fatalf("expected only '*' row, got %v", tfs)
		}
	})

	t.Run("b) '*'=[delta], propagate cvd -> '*'=[delta, cvd]", func(t *testing.T) {
		db := setupTestDB(t)
		defer db.Close()
		ctx := context.Background()
		uid := makeTestUser(t, db, "propb@test.com")

		_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*", `[{"id":"delta","settings":{}}]`)

		one := json.RawMessage(`{"id":"cvd","settings":{"color":"green"}}`)
		if err := PropagateUserIndicator(ctx, db, uid, "BTCUSDT", "futures", one); err != nil {
			t.Fatalf("propagate: %v", err)
		}

		got, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
		arr := parseArr(t, got)
		if len(arr) != 2 || findByID(arr, "delta") == nil || findByID(arr, "cvd") == nil {
			t.Fatalf("'*' content wrong: %s", got)
		}
	})

	t.Run("c) '*'=[cvd@old], propagate cvd@new -> '*'=[cvd@new]", func(t *testing.T) {
		db := setupTestDB(t)
		defer db.Close()
		ctx := context.Background()
		uid := makeTestUser(t, db, "propc@test.com")

		_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*",
			`[{"id":"cvd","settings":{"color":"red"}}]`)

		one := json.RawMessage(`{"id":"cvd","settings":{"color":"blue"}}`)
		if err := PropagateUserIndicator(ctx, db, uid, "BTCUSDT", "futures", one); err != nil {
			t.Fatalf("propagate: %v", err)
		}

		got, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
		arr := parseArr(t, got)
		if len(arr) != 1 {
			t.Fatalf("'*' length wrong: %s", got)
		}
		cvd := findByID(arr, "cvd")
		if cvd == nil {
			t.Fatalf("cvd missing: %s", got)
		}
		settings, _ := cvd["settings"].(map[string]interface{})
		if settings["color"] != "blue" {
			t.Fatalf("cvd settings not overwritten: %s", got)
		}
	})

	t.Run("d) '*'=[cvd], 1m=[delta], 5m=[delta,cvd@old], propagate cvd@new", func(t *testing.T) {
		db := setupTestDB(t)
		defer db.Close()
		ctx := context.Background()
		uid := makeTestUser(t, db, "propd@test.com")

		_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*",
			`[{"id":"cvd","settings":{"color":"red"}}]`)
		_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m",
			`[{"id":"delta","settings":{"k":1}}]`)
		_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "5m",
			`[{"id":"delta","settings":{"k":2}},{"id":"cvd","settings":{"color":"red"}}]`)

		one := json.RawMessage(`{"id":"cvd","settings":{"color":"blue"}}`)
		if err := PropagateUserIndicator(ctx, db, uid, "BTCUSDT", "futures", one); err != nil {
			t.Fatalf("propagate: %v", err)
		}

		// '*' -> [cvd@new]
		star, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
		starArr := parseArr(t, star)
		if len(starArr) != 1 {
			t.Fatalf("'*' length: %s", star)
		}
		if cvd := findByID(starArr, "cvd"); cvd == nil ||
			cvd["settings"].(map[string]interface{})["color"] != "blue" {
			t.Fatalf("'*' cvd wrong: %s", star)
		}

		// 1m -> [delta, cvd@new] — sibling delta untouched, cvd appended
		oneM, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m")
		oneArr := parseArr(t, oneM)
		if len(oneArr) != 2 {
			t.Fatalf("1m length: %s", oneM)
		}
		if delta := findByID(oneArr, "delta"); delta == nil ||
			delta["settings"].(map[string]interface{})["k"] != float64(1) {
			t.Fatalf("1m delta lost or mutated: %s", oneM)
		}
		if cvd := findByID(oneArr, "cvd"); cvd == nil ||
			cvd["settings"].(map[string]interface{})["color"] != "blue" {
			t.Fatalf("1m cvd missing or wrong: %s", oneM)
		}

		// 5m -> [delta, cvd@new] — sibling delta untouched (k=2), cvd overwritten
		fiveM, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "5m")
		fiveArr := parseArr(t, fiveM)
		if len(fiveArr) != 2 {
			t.Fatalf("5m length: %s", fiveM)
		}
		if delta := findByID(fiveArr, "delta"); delta == nil ||
			delta["settings"].(map[string]interface{})["k"] != float64(2) {
			t.Fatalf("5m delta lost or mutated: %s", fiveM)
		}
		if cvd := findByID(fiveArr, "cvd"); cvd == nil ||
			cvd["settings"].(map[string]interface{})["color"] != "blue" {
			t.Fatalf("5m cvd not overwritten: %s", fiveM)
		}
	})

	t.Run("e) corrupt existing row -> error, no mutation", func(t *testing.T) {
		db := setupTestDB(t)
		defer db.Close()
		ctx := context.Background()
		uid := makeTestUser(t, db, "prope@test.com")

		// Healthy '*' row and one CORRUPT per-tf row.
		_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*",
			`[{"id":"cvd","settings":{}}]`)
		// Bypass JSON validation by writing directly via UpsertUserIndicator with non-array body.
		_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m", `{"not":"array"}`)

		before5m, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")

		one := json.RawMessage(`{"id":"cvd","settings":{"color":"x"}}`)
		if err := PropagateUserIndicator(ctx, db, uid, "BTCUSDT", "futures", one); err == nil {
			t.Fatalf("expected error for corrupt row")
		}

		after5m, _, _ := GetUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*")
		if before5m != after5m {
			t.Fatalf("'*' row mutated despite error: before=%s after=%s", before5m, after5m)
		}
	})

	t.Run("f) id missing -> error", func(t *testing.T) {
		db := setupTestDB(t)
		defer db.Close()
		ctx := context.Background()
		uid := makeTestUser(t, db, "propf@test.com")

		if err := PropagateUserIndicator(ctx, db, uid, "BTCUSDT", "futures",
			json.RawMessage(`{"settings":{}}`)); err == nil {
			t.Fatalf("expected error for missing id")
		}
		if err := PropagateUserIndicator(ctx, db, uid, "BTCUSDT", "futures",
			json.RawMessage(`not-json`)); err == nil {
			t.Fatalf("expected error for invalid json")
		}
	})
}

func TestAdminIndicatorDefaultCRUD(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()
	adminID := makeTestUser(t, db, "admin@test.com")

	if _, exists, _ := GetAdminIndicatorDefault(ctx, db, "BTCUSDT", "futures", "1m"); exists {
		t.Fatalf("expected no row initially")
	}

	if err := UpsertAdminIndicatorDefault(ctx, db, adminID, "BTCUSDT", "futures", "1m",
		`[{"id":"cvd"}]`); err != nil {
		t.Fatalf("upsert admin default: %v", err)
	}
	if err := UpsertAdminIndicatorDefault(ctx, db, adminID, "BTCUSDT", "futures", "*",
		`[{"id":"delta"}]`); err != nil {
		t.Fatalf("upsert admin default (all-tf): %v", err)
	}

	rows, err := ListAdminIndicatorDefaultsForSymbol(ctx, db, "BTCUSDT")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 admin rows, got %d", len(rows))
	}
	// The '*' row sorts after the explicit timeframe.
	if rows[0].Timeframe != "1m" || rows[1].Timeframe != "*" {
		t.Fatalf("unexpected sort order: %+v", rows)
	}

	if err := DeleteAdminIndicatorDefault(ctx, db, "BTCUSDT", "futures", "1m"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, exists, _ := GetAdminIndicatorDefault(ctx, db, "BTCUSDT", "futures", "1m"); exists {
		t.Fatalf("expected row gone after delete")
	}
}

func TestResolveCascade(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()
	uid := makeTestUser(t, db, "cascade@test.com")
	adminID := makeTestUser(t, db, "cadmin@test.com")

	// Level 5: nothing → system
	jsonStr, src, err := ResolveIndicators(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if err != nil {
		t.Fatalf("resolve empty: %v", err)
	}
	if src != SourceSystem || jsonStr != "[]" {
		t.Fatalf("level 5: got source=%s json=%s", src, jsonStr)
	}

	// Level 4: admin-all-tf only
	_ = UpsertAdminIndicatorDefault(ctx, db, adminID, "BTCUSDT", "futures", "*", `["admin-all-tf"]`)
	_, src, _ = ResolveIndicators(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if src != SourceAdminAllTF {
		t.Fatalf("level 4: got %s", src)
	}

	// Level 3: admin-tf wins over admin-all-tf
	_ = UpsertAdminIndicatorDefault(ctx, db, adminID, "BTCUSDT", "futures", "1m", `["admin-tf"]`)
	_, src, _ = ResolveIndicators(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if src != SourceAdminTF {
		t.Fatalf("level 3: got %s", src)
	}

	// Level 2: user-all-tf wins over both admin layers for the same TF query
	_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "*", `["user-all-tf"]`)
	_, src, _ = ResolveIndicators(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if src != SourceUserAllTF {
		t.Fatalf("level 2: got %s (expected user-all-tf to beat admin-tf)", src)
	}

	// Level 1: user-tf wins over everything
	_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m", `["user-tf"]`)
	_, src, _ = ResolveIndicators(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if src != SourceUserTF {
		t.Fatalf("level 1: got %s", src)
	}

	// Other user (different uid) does NOT see the first user's overrides
	uid2 := makeTestUser(t, db, "other@test.com")
	_, src, _ = ResolveIndicators(ctx, db, uid2, "BTCUSDT", "futures", "1m")
	if src != SourceAdminTF {
		t.Fatalf("other user should hit admin-tf, got %s", src)
	}

	// Empty user record (deliberately cleared) — STILL counts as user-tf with []
	_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m", `[]`)
	gotJSON, src, _ := ResolveIndicators(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if src != SourceUserTF || gotJSON != "[]" {
		t.Fatalf("emptied user row: src=%s json=%s", src, gotJSON)
	}

	// DELETE the user-tf row → cascade falls back to user-all-tf
	_ = DeleteUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m")
	_, src, _ = ResolveIndicators(ctx, db, uid, "BTCUSDT", "futures", "1m")
	if src != SourceUserAllTF {
		t.Fatalf("after delete user-tf: got %s", src)
	}
}

func TestSetUserSettingsFieldMerges(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()
	uid := makeTestUser(t, db, "settings@test.com")

	readSettings := func(userID string) string {
		t.Helper()
		var s string
		if err := db.QueryRowContext(ctx,
			`SELECT settings_json FROM user_settings WHERE user_id = ?`, userID).Scan(&s); err != nil {
			t.Fatalf("read user_settings: %v", err)
		}
		return s
	}

	// Pre-seed an unrelated field directly via the existing upsert.
	if err := UpsertUserSettings(ctx, db, uid, `{"foo":"bar","nested":{"a":1}}`); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Field write must MERGE — not replace the whole blob.
	if err := SetUserSettingsField(ctx, db, uid, "favoriteIndicatorIds", []string{"cvd", "delta"}); err != nil {
		t.Fatalf("set field: %v", err)
	}

	settingsJSON := readSettings(uid)
	var blob map[string]interface{}
	if err := json.Unmarshal([]byte(settingsJSON), &blob); err != nil {
		t.Fatalf("parse settings: %v (json=%s)", err, settingsJSON)
	}
	if blob["foo"] != "bar" {
		t.Fatalf("merge lost 'foo': %s", settingsJSON)
	}
	if nested, ok := blob["nested"].(map[string]interface{}); !ok || nested["a"] != float64(1) {
		t.Fatalf("merge lost 'nested': %s", settingsJSON)
	}
	favs, ok := blob["favoriteIndicatorIds"].([]interface{})
	if !ok || len(favs) != 2 {
		t.Fatalf("favorites not set: %s", settingsJSON)
	}

	// Overwrite favorites again — other fields still survive.
	if err := SetUserSettingsField(ctx, db, uid, "favoriteIndicatorIds", []string{"only-one"}); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	settingsJSON = readSettings(uid)
	_ = json.Unmarshal([]byte(settingsJSON), &blob)
	if blob["foo"] != "bar" {
		t.Fatalf("second write clobbered foo: %s", settingsJSON)
	}
	favs, _ = blob["favoriteIndicatorIds"].([]interface{})
	if len(favs) != 1 || favs[0] != "only-one" {
		t.Fatalf("favorites not replaced: %s", settingsJSON)
	}

	// Works when no row exists yet (insert path).
	uid2 := makeTestUser(t, db, "settings2@test.com")
	if err := SetUserSettingsField(ctx, db, uid2, "favoriteIndicatorIds", []string{"x"}); err != nil {
		t.Fatalf("insert-fresh: %v", err)
	}
	if got := readSettings(uid2); !strings.Contains(got, `"favoriteIndicatorIds":["x"]`) {
		t.Fatalf("insert-fresh payload: %s", got)
	}
}

func TestResolveGuest(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()
	uid := makeTestUser(t, db, "withuser@test.com")
	adminID := makeTestUser(t, db, "guestadmin@test.com")

	// Even with a user_indicators row present, guest (uid="") must NOT see it.
	_ = UpsertUserIndicator(ctx, db, uid, "BTCUSDT", "futures", "1m", `["user-tf"]`)
	_ = UpsertAdminIndicatorDefault(ctx, db, adminID, "BTCUSDT", "futures", "1m", `["admin-tf"]`)

	jsonStr, src, err := ResolveIndicators(ctx, db, "", "BTCUSDT", "futures", "1m")
	if err != nil {
		t.Fatalf("guest resolve: %v", err)
	}
	if src != SourceAdminTF {
		t.Fatalf("guest must see admin-tf, got %s", src)
	}
	if !strings.Contains(jsonStr, "admin-tf") {
		t.Fatalf("guest payload wrong: %s", jsonStr)
	}

	// Guest with no admin row at all → system
	_ = DeleteAdminIndicatorDefault(ctx, db, "BTCUSDT", "futures", "1m")
	jsonStr, src, _ = ResolveIndicators(ctx, db, "", "BTCUSDT", "futures", "1m")
	if src != SourceSystem || jsonStr != "[]" {
		t.Fatalf("guest with no admin: src=%s json=%s", src, jsonStr)
	}
}
