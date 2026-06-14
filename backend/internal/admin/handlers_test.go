package admin

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/procluster/procluster/internal/auth"
	"github.com/redis/go-redis/v9"

	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	if err := auth.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func setupTestRedis(t *testing.T) (*redis.Client, func()) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return rdb, func() {
		rdb.Close()
		mr.Close()
	}
}

func setupTestConfig() auth.AuthConfig {
	return auth.AuthConfig{
		JWTSecret:      []byte("test-secret-key-for-admin-tests"),
		AccessTokenTTL: 15 * time.Minute,
		SessionLimits:  map[string]int{"guest": 1, "free": 1, "pro": 2, "vip": 2, "admin": -1},
	}
}

func createAdminToken(t *testing.T, cfg auth.AuthConfig, userID, role string) string {
	t.Helper()
	token, err := auth.GenerateAccessToken(cfg, userID, role)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	return token
}

func TestAdminRoute_RequireAuth_NoToken(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb)

	req := httptest.NewRequest("GET", "/api/v1/admin/metrics", nil)
	w := httptest.NewRecorder()

	handler := auth.RequireAuth(cfg)(http.HandlerFunc(h.handleGetMetrics))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestAdminRoute_RequireRole_NonAdmin(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb)

	token := createAdminToken(t, cfg, "user-123", "free")

	req := httptest.NewRequest("GET", "/api/v1/admin/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler := auth.RequireAuth(cfg)(
		auth.RequireRole("admin")(
			http.HandlerFunc(h.handleGetMetrics),
		),
	)
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestAdminRoute_RequireRole_Admin(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb)

	token := createAdminToken(t, cfg, "admin-456", "admin")

	req := httptest.NewRequest("GET", "/api/v1/admin/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler := auth.RequireAuth(cfg)(
		auth.RequireRole("admin")(
			http.HandlerFunc(h.handleGetMetrics),
		),
	)
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestAuditLog_WrittenOnMutation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	LogAdminAction(context.Background(), db, "admin-789", "test_action", "test:target", `{"key":"value"}`, "127.0.0.1")

	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM admin_actions WHERE user_id = 'admin-789' AND action = 'test_action'`).Scan(&count)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 audit log entry, got %d", count)
	}
}
