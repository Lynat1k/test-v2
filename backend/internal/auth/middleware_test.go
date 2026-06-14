package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestExtractUserFromRequest_Bearer(t *testing.T) {
	cfg := testConfig()
	userID := "user-123"
	role := "free"
	token, _ := GenerateAccessToken(cfg, userID, role)

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	gotID, gotRole, err := ExtractUserFromRequest(cfg, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotID != userID {
		t.Errorf("userID = %q, want %q", gotID, userID)
	}
	if gotRole != role {
		t.Errorf("role = %q, want %q", gotRole, role)
	}
}

func TestExtractUserFromRequest_QueryToken(t *testing.T) {
	cfg := testConfig()
	userID := "user-456"
	role := "pro"
	token, _ := GenerateAccessToken(cfg, userID, role)

	req := httptest.NewRequest("GET", "/?token="+token, nil)

	gotID, gotRole, err := ExtractUserFromRequest(cfg, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotID != userID {
		t.Errorf("userID = %q, want %q", gotID, userID)
	}
	if gotRole != role {
		t.Errorf("role = %q, want %q", gotRole, role)
	}
}

func TestExtractUserFromRequest_NoToken(t *testing.T) {
	cfg := testConfig()
	req := httptest.NewRequest("GET", "/", nil)

	_, _, err := ExtractUserFromRequest(cfg, req)
	if err == nil {
		t.Fatal("expected error for missing token")
	}
}

func TestExtractUserFromRequest_ExpiredToken(t *testing.T) {
	cfg := testConfig()
	cfg.AccessTokenTTL = -1 * time.Second
	token, _ := GenerateAccessToken(cfg, "user-789", "free")

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	_, _, err := ExtractUserFromRequest(cfg, req)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestRequireAuth_Success(t *testing.T) {
	cfg := testConfig()
	token, _ := GenerateAccessToken(cfg, "user-auth", "free")

	var gotUserID, gotRole string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID, _ = r.Context().Value(UserIDKey).(string)
		gotRole, _ = r.Context().Value(RoleKey).(string)
		w.WriteHeader(http.StatusOK)
	})

	handler := RequireAuth(cfg)(inner)

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotUserID != "user-auth" {
		t.Errorf("userID = %q, want user-auth", gotUserID)
	}
	if gotRole != "free" {
		t.Errorf("role = %q, want free", gotRole)
	}
}

func TestRequireAuth_NoToken(t *testing.T) {
	cfg := testConfig()
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := RequireAuth(cfg)(inner)

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestRequireRole_Success(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := RequireRole("free", "pro")(inner)

	req := httptest.NewRequest("GET", "/", nil)
	ctx := context.WithValue(req.Context(), UserIDKey, "user-1")
	ctx = context.WithValue(ctx, RoleKey, "pro")
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestRequireRole_Forbidden(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := RequireRole("admin")(inner)

	req := httptest.NewRequest("GET", "/", nil)
	ctx := context.WithValue(req.Context(), UserIDKey, "user-1")
	ctx = context.WithValue(ctx, RoleKey, "free")
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestRequireRole_NoRole(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := RequireRole("admin")(inner)

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}
