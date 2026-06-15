package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/procluster/procluster/internal/auth"
)

func setupTestConfig() auth.AuthConfig {
	return auth.AuthConfig{
		JWTSecret:       []byte("test-secret-key-for-guest-tests"),
		AccessTokenTTL:  15 * time.Minute,
		HistoryMaxGuest: 7 * 24 * time.Hour,
		HistoryMaxFree:  180 * 24 * time.Hour,
	}
}

func TestGuestMiddleware_TracksNonAuth(t *testing.T) {
	rdb, mr := setupTestRedis(t)
	cfg := setupTestConfig()

	handler := withMiddleware(rdb, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/candles", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	setCookie := w.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, "anon_id") {
		t.Error("expected anon_id cookie to be set")
	}

	keys := mr.Keys()
	var anonKeys int
	for _, key := range keys {
		if strings.HasPrefix(key, "guest:online:") {
			anonKeys++
		}
	}
	if anonKeys == 0 {
		t.Error("expected guest:online:* key in redis")
	}
}

func TestGuestMiddleware_SkipsAuthUser(t *testing.T) {
	rdb, mr := setupTestRedis(t)
	cfg := setupTestConfig()
	token, err := auth.GenerateAccessToken(cfg, "auth-user", "free")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	handler := withMiddleware(rdb, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/candles", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	keys := mr.Keys()
	var anonKeys int
	for _, key := range keys {
		if strings.HasPrefix(key, "guest:online:") {
			anonKeys++
		}
	}
	if anonKeys != 0 {
		t.Errorf("expected 0 guest keys for auth user, got %d", anonKeys)
	}
}

func TestGuestMiddleware_SameAnonID_OneGuest(t *testing.T) {
	rdb, mr := setupTestRedis(t)
	cfg := setupTestConfig()

	handler := withMiddleware(rdb, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", "/api/v1/candles", nil)
		if i > 0 {
			req.AddCookie(&http.Cookie{Name: "anon_id", Value: "fixed-anon-id"})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}

	keys := mr.Keys()
	var anonKeys int
	for _, key := range keys {
		if strings.HasPrefix(key, "guest:online:") {
			anonKeys++
		}
	}
	if anonKeys != 2 {
		t.Errorf("expected 2 guest keys (1 random + 1 fixed), got %d", anonKeys)
	}
}
