package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// setupIndicatorsHandler wires up Handler with a fresh in-memory DB and
// registers ALL routes via RegisterRoutes, so tests exercise the real mux +
// middleware stack instead of calling private methods directly.
func setupIndicatorsHandler(t *testing.T) (http.Handler, *Handler, string, string) {
	t.Helper()
	h, db := setupTestHandler(t)
	// makeTestUser uses context.Background — keep the same convention here.
	uid := makeTestUser(t, db, "indfetcher@test.com")
	adminID := makeTestUser(t, db, "indadmin@test.com")

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	t.Cleanup(func() { db.Close() })
	return mux, h, uid, adminID
}

func mintAccessToken(t *testing.T, h *Handler, userID, role string) string {
	t.Helper()
	tok, err := GenerateAccessToken(h.cfg, userID, role)
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}
	return tok
}

func doRequest(t *testing.T, mux http.Handler, method, path, token string, body string) (*httptest.ResponseRecorder, map[string]interface{}) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	var resp map[string]interface{}
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response (%d): %s", w.Code, w.Body.String())
		}
	}
	return w, resp
}

// putIndicators is a small helper to PUT a user-indicators row.
func putIndicators(t *testing.T, mux http.Handler, token, symbol, market, tf, indicators, mode string) {
	t.Helper()
	body := map[string]interface{}{
		"symbol":     symbol,
		"market":     market,
		"timeframe":  tf,
		"indicators": json.RawMessage(indicators),
	}
	if mode != "" {
		body["mode"] = mode
	}
	b, _ := json.Marshal(body)
	w, resp := doRequest(t, mux, "PUT", "/api/v1/user/indicators", token, string(b))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT %s/%s/%s failed: %d %s", symbol, market, tf, w.Code, w.Body.String())
	}
	if ok, _ := resp["ok"].(bool); !ok {
		t.Fatalf("PUT envelope ok=false: %v", resp)
	}
}

// putAdminDefault seeds an admin row directly (the admin-side HTTP layer is
// tested in the admin package). Cascade behaviour here is the same regardless
// of how the row got there.
func putAdminDefault(t *testing.T, h *Handler, adminID, symbol, market, tf, indicators string) {
	t.Helper()
	if err := UpsertAdminIndicatorDefault(context.Background(), h.db, adminID, symbol, market, tf, indicators); err != nil {
		t.Fatalf("seed admin default: %v", err)
	}
}

// TestIndicators_GET_CascadeViaHTTP exercises the full cascade through the
// real HTTP mux: GET responds with the correct `source` for each layer, both
// for authed and guest callers.
func TestIndicators_GET_CascadeViaHTTP(t *testing.T) {
	mux, h, uid, adminID := setupIndicatorsHandler(t)

	tokAuthed := mintAccessToken(t, h, uid, "Free")
	q := url.Values{}
	q.Set("symbol", "BTCUSDT")
	q.Set("market", "futures")
	q.Set("timeframe", "1m")
	path := "/api/v1/user/indicators?" + q.Encode()

	expectSource := func(token, want string) {
		t.Helper()
		w, resp := doRequest(t, mux, "GET", path, token, "")
		if w.Code != http.StatusOK {
			t.Fatalf("GET: %d %s", w.Code, w.Body.String())
		}
		data, _ := resp["data"].(map[string]interface{})
		if src, _ := data["source"].(string); src != want {
			t.Fatalf("source: got %q want %q (body=%s)", src, want, w.Body.String())
		}
	}

	// 5: system (nothing exists)
	expectSource(tokAuthed, "system")

	// 4: admin-all-tf
	putAdminDefault(t, h, adminID, "BTCUSDT", "futures", "*", `[{"id":"cvd"}]`)
	expectSource(tokAuthed, "admin-all-tf")

	// 3: admin-tf beats admin-all-tf
	putAdminDefault(t, h, adminID, "BTCUSDT", "futures", "1m", `[{"id":"delta"}]`)
	expectSource(tokAuthed, "admin-tf")

	// 2: user-all-tf beats admin-tf
	putIndicators(t, mux, tokAuthed, "BTCUSDT", "futures", "*", `[{"id":"vol"}]`, "")
	expectSource(tokAuthed, "user-all-tf")

	// 1: user-tf beats everything
	putIndicators(t, mux, tokAuthed, "BTCUSDT", "futures", "1m", `[{"id":"si"}]`, "")
	expectSource(tokAuthed, "user-tf")

	// Guest (no Authorization header) — must NOT see user-tier rows, falls to admin-tf.
	expectSource("", "admin-tf")

	// Guest after admin-tf is gone — sees admin-all-tf.
	if err := DeleteAdminIndicatorDefault(context.Background(), h.db, "BTCUSDT", "futures", "1m"); err != nil {
		t.Fatalf("delete admin-tf: %v", err)
	}
	expectSource("", "admin-all-tf")
}

// TestIndicators_PUT_CaseNormalization verifies that a value written with one
// case can be read back with a different case — the server canonicalises both
// inputs, so they hit the same row.
func TestIndicators_PUT_CaseNormalization(t *testing.T) {
	mux, h, uid, _ := setupIndicatorsHandler(t)
	tok := mintAccessToken(t, h, uid, "Free")

	// Write with mixed case
	putIndicators(t, mux, tok, "btcusdt", "FUTURES", "1M", `[{"id":"cvd"}]`, "")

	// SQLite row must use the canonical case (upper symbol, lower market/tf).
	var got string
	err := h.db.QueryRowContext(context.Background(),
		`SELECT indicators_json FROM user_indicators
		 WHERE user_id = ? AND symbol = ? AND market = ? AND timeframe = ?`,
		uid, "BTCUSDT", "futures", "1m").Scan(&got)
	if err != nil {
		t.Fatalf("canonicalised row missing: %v", err)
	}
	if !strings.Contains(got, `"id":"cvd"`) {
		t.Fatalf("row payload: %s", got)
	}

	// Read with yet another casing — same canonical row.
	w, resp := doRequest(t, mux, "GET",
		"/api/v1/user/indicators?symbol=BtcUsdT&market=FuTuReS&timeframe=1M", tok, "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET: %d %s", w.Code, w.Body.String())
	}
	data, _ := resp["data"].(map[string]interface{})
	if src, _ := data["source"].(string); src != "user-tf" {
		t.Fatalf("expected user-tf, got %s", src)
	}
}

// TestIndicators_PUT_MergeAdd_NoDuplicate confirms that PUT mode=merge-add does
// not duplicate an existing id when called twice.
func TestIndicators_PUT_MergeAdd_NoDuplicate(t *testing.T) {
	mux, h, uid, _ := setupIndicatorsHandler(t)
	tok := mintAccessToken(t, h, uid, "Free")

	putIndicators(t, mux, tok, "BTCUSDT", "futures", "*", `[{"id":"cvd"}]`, "merge-add")
	putIndicators(t, mux, tok, "BTCUSDT", "futures", "*", `[{"id":"cvd"},{"id":"delta"}]`, "merge-add")

	var got string
	_ = h.db.QueryRowContext(context.Background(),
		`SELECT indicators_json FROM user_indicators
		 WHERE user_id = ? AND symbol = 'BTCUSDT' AND market = 'futures' AND timeframe = '*'`,
		uid).Scan(&got)
	var arr []map[string]interface{}
	if err := json.Unmarshal([]byte(got), &arr); err != nil {
		t.Fatalf("parse merged: %v / %s", err, got)
	}
	if len(arr) != 2 {
		t.Fatalf("expected 2 unique ids after dup merge, got %d in %s", len(arr), got)
	}
}

// TestIndicators_DELETE_FallsBackThroughCascade — after PUT for user-tf and
// user-all-tf, deleting the user-tf row makes GET return user-all-tf.
func TestIndicators_DELETE_FallsBackThroughCascade(t *testing.T) {
	mux, h, uid, _ := setupIndicatorsHandler(t)
	tok := mintAccessToken(t, h, uid, "Free")

	putIndicators(t, mux, tok, "BTCUSDT", "futures", "*", `[{"id":"all-tf"}]`, "")
	putIndicators(t, mux, tok, "BTCUSDT", "futures", "1m", `[{"id":"per-tf"}]`, "")

	// Sanity: per-tf wins.
	w, resp := doRequest(t, mux, "GET",
		"/api/v1/user/indicators?symbol=BTCUSDT&market=futures&timeframe=1m", tok, "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET: %d %s", w.Code, w.Body.String())
	}
	data, _ := resp["data"].(map[string]interface{})
	if src, _ := data["source"].(string); src != "user-tf" {
		t.Fatalf("pre-delete: %s", src)
	}

	// DELETE the per-tf row.
	w, _ = doRequest(t, mux, "DELETE",
		"/api/v1/user/indicators?symbol=BTCUSDT&market=futures&timeframe=1m", tok, "")
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE: %d %s", w.Code, w.Body.String())
	}

	// Cascade now lands on user-all-tf.
	w, resp = doRequest(t, mux, "GET",
		"/api/v1/user/indicators?symbol=BTCUSDT&market=futures&timeframe=1m", tok, "")
	data, _ = resp["data"].(map[string]interface{})
	if src, _ := data["source"].(string); src != "user-all-tf" {
		t.Fatalf("post-delete: %s", src)
	}

	// DELETE the same row again — 404.
	w, _ = doRequest(t, mux, "DELETE",
		"/api/v1/user/indicators?symbol=BTCUSDT&market=futures&timeframe=1m", tok, "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 on second delete, got %d", w.Code)
	}
}

// TestIndicators_PUT_Propagate covers the propagate mode end-to-end: auth,
// validation, happy path (write affects '*' + existing per-tf rows but does
// not create new per-tf rows), and case normalization.
func TestIndicators_PUT_Propagate(t *testing.T) {
	t.Run("401 without auth", func(t *testing.T) {
		mux, _, _, _ := setupIndicatorsHandler(t)
		body := `{"symbol":"BTCUSDT","market":"futures","mode":"propagate","indicator":{"id":"cvd"}}`
		req := httptest.NewRequest("PUT", "/api/v1/user/indicators", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", w.Code)
		}
	})

	t.Run("400 missing indicator", func(t *testing.T) {
		mux, h, uid, _ := setupIndicatorsHandler(t)
		tok := mintAccessToken(t, h, uid, "Free")
		body := `{"symbol":"BTCUSDT","market":"futures","mode":"propagate"}`
		w, _ := doRequest(t, mux, "PUT", "/api/v1/user/indicators", tok, body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", w.Code, w.Body.String())
		}
	})

	t.Run("400 empty id", func(t *testing.T) {
		mux, h, uid, _ := setupIndicatorsHandler(t)
		tok := mintAccessToken(t, h, uid, "Free")
		body := `{"symbol":"BTCUSDT","market":"futures","mode":"propagate","indicator":{"settings":{}}}`
		w, _ := doRequest(t, mux, "PUT", "/api/v1/user/indicators", tok, body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", w.Code, w.Body.String())
		}
	})

	t.Run("happy path + cascade reads back per tf", func(t *testing.T) {
		mux, h, uid, _ := setupIndicatorsHandler(t)
		tok := mintAccessToken(t, h, uid, "Free")

		// Seed: 1m has its own per-tf row with cluster_search.
		putIndicators(t, mux, tok, "BTCUSDT", "futures", "1m",
			`[{"id":"cluster_search","settings":{"k":1}}]`, "")

		// Propagate CVD across all TFs.
		propBody := `{"symbol":"BTCUSDT","market":"futures","mode":"propagate","indicator":{"id":"cvd","settings":{"color":"blue"}}}`
		w, resp := doRequest(t, mux, "PUT", "/api/v1/user/indicators", tok, propBody)
		if w.Code != http.StatusOK {
			t.Fatalf("propagate: %d body=%s", w.Code, w.Body.String())
		}
		if ok, _ := resp["ok"].(bool); !ok {
			t.Fatalf("envelope ok=false: %v", resp)
		}

		// Direct DB check: '*' row created with [cvd], 1m row got [cs, cvd],
		// no other per-tf rows exist.
		rows, _ := h.db.QueryContext(context.Background(),
			`SELECT timeframe, indicators_json FROM user_indicators
			 WHERE user_id=? AND symbol=? AND market=? ORDER BY timeframe`,
			uid, "BTCUSDT", "futures")
		defer rows.Close()
		seen := map[string]string{}
		for rows.Next() {
			var tf, body string
			_ = rows.Scan(&tf, &body)
			seen[tf] = body
		}
		if len(seen) != 2 {
			t.Fatalf("expected exactly 2 rows ('*' and '1m'), got %d: %v", len(seen), seen)
		}
		if _, ok := seen["*"]; !ok {
			t.Fatalf("'*' row not created")
		}
		if _, ok := seen["1m"]; !ok {
			t.Fatalf("1m row missing")
		}
		// '*' row content
		var starArr []map[string]interface{}
		_ = json.Unmarshal([]byte(seen["*"]), &starArr)
		if len(starArr) != 1 || starArr[0]["id"] != "cvd" {
			t.Fatalf("'*' content wrong: %s", seen["*"])
		}
		// 1m row content: cs + cvd, in that order (cs preserved, cvd appended)
		var oneArr []map[string]interface{}
		_ = json.Unmarshal([]byte(seen["1m"]), &oneArr)
		if len(oneArr) != 2 || oneArr[0]["id"] != "cluster_search" || oneArr[1]["id"] != "cvd" {
			t.Fatalf("1m content wrong: %s", seen["1m"])
		}

		// GET 5m → cascade hits '*' (user-all-tf), CVD with new color.
		w, resp = doRequest(t, mux, "GET",
			"/api/v1/user/indicators?symbol=BTCUSDT&market=futures&timeframe=5m", tok, "")
		if w.Code != http.StatusOK {
			t.Fatalf("GET 5m: %d %s", w.Code, w.Body.String())
		}
		data, _ := resp["data"].(map[string]interface{})
		if src, _ := data["source"].(string); src != "user-all-tf" {
			t.Fatalf("5m source: %s", src)
		}
		inds, _ := data["indicators"].([]interface{})
		if len(inds) != 1 {
			t.Fatalf("5m indicators count: %d", len(inds))
		}
		first := inds[0].(map[string]interface{})
		if first["id"] != "cvd" ||
			first["settings"].(map[string]interface{})["color"] != "blue" {
			t.Fatalf("5m payload: %v", first)
		}

		// GET 1m → its own per-tf row, with cs + cvd.
		w, resp = doRequest(t, mux, "GET",
			"/api/v1/user/indicators?symbol=BTCUSDT&market=futures&timeframe=1m", tok, "")
		data, _ = resp["data"].(map[string]interface{})
		if src, _ := data["source"].(string); src != "user-tf" {
			t.Fatalf("1m source: %s", src)
		}
		inds, _ = data["indicators"].([]interface{})
		if len(inds) != 2 {
			t.Fatalf("1m indicators count: %d (%v)", len(inds), inds)
		}
	})

	t.Run("case normalization (btcusdt / Futures)", func(t *testing.T) {
		mux, h, uid, _ := setupIndicatorsHandler(t)
		tok := mintAccessToken(t, h, uid, "Free")

		body := `{"symbol":"btcusdt","market":"FUTURES","mode":"propagate","indicator":{"id":"delta","settings":{"x":1}}}`
		w, _ := doRequest(t, mux, "PUT", "/api/v1/user/indicators", tok, body)
		if w.Code != http.StatusOK {
			t.Fatalf("propagate: %d body=%s", w.Code, w.Body.String())
		}

		var got string
		err := h.db.QueryRowContext(context.Background(),
			`SELECT indicators_json FROM user_indicators
			 WHERE user_id=? AND symbol='BTCUSDT' AND market='futures' AND timeframe='*'`,
			uid).Scan(&got)
		if err != nil {
			t.Fatalf("canonical '*' row missing: %v", err)
		}
		if !strings.Contains(got, `"id":"delta"`) {
			t.Fatalf("payload: %s", got)
		}
	})
}

// TestIndicators_PUT_Validation covers the bad-input rejections.
func TestIndicators_PUT_Validation(t *testing.T) {
	mux, h, uid, _ := setupIndicatorsHandler(t)
	tok := mintAccessToken(t, h, uid, "Free")

	cases := []struct {
		name   string
		body   string
		status int
	}{
		{"missing symbol", `{"market":"futures","timeframe":"1m","indicators":[{"id":"x"}]}`, http.StatusBadRequest},
		{"bad market", `{"symbol":"BTCUSDT","market":"foo","timeframe":"1m","indicators":[{"id":"x"}]}`, http.StatusBadRequest},
		{"bad tf for spot", `{"symbol":"BTCUSDT","market":"spot","timeframe":"1m","indicators":[{"id":"x"}]}`, http.StatusBadRequest},
		{"indicators not array", `{"symbol":"BTCUSDT","market":"futures","timeframe":"1m","indicators":{"id":"x"}}`, http.StatusBadRequest},
		{"missing id", `{"symbol":"BTCUSDT","market":"futures","timeframe":"1m","indicators":[{"settings":{}}]}`, http.StatusBadRequest},
		{"bad mode", `{"symbol":"BTCUSDT","market":"futures","timeframe":"1m","indicators":[{"id":"x"}],"mode":"weird"}`, http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("PUT", "/api/v1/user/indicators", bytes.NewReader([]byte(tc.body)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+tok)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("expected %d, got %d body=%s", tc.status, w.Code, w.Body.String())
			}
		})
	}

	// Auth required: no Bearer → 401 from RequireAuth.
	req := httptest.NewRequest("PUT", "/api/v1/user/indicators",
		strings.NewReader(`{"symbol":"BTCUSDT","market":"futures","timeframe":"1m","indicators":[{"id":"x"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for guest PUT, got %d", w.Code)
	}
	_ = h // silence unused warning if compiler complains
}
