package auth

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func setupTestHandler(t *testing.T) (*Handler, *sql.DB) {
	t.Helper()
	db := setupTestDB(t)
	cfg := testConfig()
	cfg.EmailMode = "log"
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	rl := NewAuthRateLimiter(rdb, cfg)
	handler := NewHandler(cfg, db, rl)
	return handler, db
}

func TestRegister(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	body := `{"email":"test@example.com","password":"password123","nickname":"TestUser"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.handleRegister(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.OK {
		t.Fatalf("expected OK=true: %s", w.Body.String())
	}

	data := resp.Data.(map[string]interface{})
	if data["accessToken"] == nil {
		t.Error("expected accessToken in response")
	}
	user := data["user"].(map[string]interface{})
	if user["email"] != "test@example.com" {
		t.Errorf("expected email test@example.com, got %s", user["email"])
	}

	var count int
	db.QueryRow(`SELECT COUNT(*) FROM users WHERE email = ?`, "test@example.com").Scan(&count)
	if count != 1 {
		t.Error("user should be created in database")
	}

	var sessionCount int
	db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&sessionCount)
	if sessionCount != 1 {
		t.Error("session should be created")
	}

	var evCount int
	db.QueryRow(`SELECT COUNT(*) FROM email_verifications WHERE email = ?`, "test@example.com").Scan(&evCount)
	if evCount != 1 {
		t.Error("email verification should be created")
	}
}

func TestRegisterDuplicateEmail(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	body := `{"email":"dup@example.com","password":"password123","nickname":"User1"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleRegister(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first register failed: %s", w.Body.String())
	}

	body2 := `{"email":"dup@example.com","password":"password456","nickname":"User2"}`
	req2 := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	handler.handleRegister(w2, req2)

	if w2.Code != http.StatusConflict {
		t.Errorf("expected 409 for duplicate email, got %d", w2.Code)
	}
}

func TestRegisterInvalidEmail(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	body := `{"email":"not-an-email","password":"password123","nickname":"Test"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleRegister(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestRegisterShortPassword(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	body := `{"email":"test@example.com","password":"short","nickname":"Test"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleRegister(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestRegisterInvalidNickname(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	body := `{"email":"test@example.com","password":"password123","nickname":"X"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleRegister(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestLogin(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	hash, _ := HashPassword("mypassword")
	user := &User{
		Email:         "login@example.com",
		Nickname:      "LoginUser",
		PasswordHash:  hash,
		Role:          "Free",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	body := `{"email":"login@example.com","password":"mypassword"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleLogin(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp.Data.(map[string]interface{})
	if data["accessToken"] == nil {
		t.Error("expected accessToken")
	}
}

func TestLoginWrongPassword(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	hash, _ := HashPassword("correctpassword")
	user := &User{
		Email:         "wrong@example.com",
		Nickname:      "WrongUser",
		PasswordHash:  hash,
		Role:          "Free",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	body := `{"email":"wrong@example.com","password":"wrongpassword"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleLogin(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestLoginUnverifiedEmail(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	hash, _ := HashPassword("mypassword")
	user := &User{
		Email:         "unverified@example.com",
		Nickname:      "UnverifiedUser",
		PasswordHash:  hash,
		Role:          "Free",
		EmailVerified: false,
	}
	CreateUser(ctx, db, user)

	body := `{"email":"unverified@example.com","password":"mypassword"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleLogin(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestLoginNonexistentEmail(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	body := `{"email":"nonexistent@example.com","password":"password123"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleLogin(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for nonexistent email (same as wrong password), got %d", w.Code)
	}
}

func TestRefreshTokenRotation(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	hash, _ := HashPassword("mypassword")
	user := &User{
		Email:         "refresh@example.com",
		Nickname:      "RefreshUser",
		PasswordHash:  hash,
		Role:          "Free",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	refreshToken, _ := GenerateRefreshToken()
	refreshHash := HashRefreshToken(refreshToken)
	session := &Session{
		UserID:           user.ID,
		RefreshTokenHash: refreshHash,
		ExpiresAt:        time.Now().Add(24 * time.Hour),
	}
	CreateSession(ctx, db, session)

	req := httptest.NewRequest("POST", "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "pc_refresh_token", Value: refreshToken})
	w := httptest.NewRecorder()
	handler.handleRefresh(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp.Data.(map[string]interface{})
	if data["accessToken"] == nil {
		t.Error("expected new accessToken")
	}

	var sessionCount int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ? AND rotated = 0`, user.ID).Scan(&sessionCount)
	if sessionCount != 1 {
		t.Errorf("expected 1 active session after rotation, got %d", sessionCount)
	}

	var rotatedCount int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ? AND rotated = 1`, user.ID).Scan(&rotatedCount)
	if rotatedCount != 1 {
		t.Errorf("expected 1 rotated session kept for reuse detection, got %d", rotatedCount)
	}

	newRefreshCookie := w.Header().Get("Set-Cookie")
	if !strings.Contains(newRefreshCookie, "pc_refresh_token") {
		t.Error("expected new refresh cookie")
	}
}

func TestRefreshReuseDetection(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	hash, _ := HashPassword("mypassword")
	user := &User{
		Email:         "reuse@example.com",
		Nickname:      "ReuseUser",
		PasswordHash:  hash,
		Role:          "Free",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	refreshToken, _ := GenerateRefreshToken()
	refreshHash := HashRefreshToken(refreshToken)
	session := &Session{
		UserID:           user.ID,
		RefreshTokenHash: refreshHash,
		ExpiresAt:        time.Now().Add(24 * time.Hour),
	}
	CreateSession(ctx, db, session)

	req := httptest.NewRequest("POST", "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "pc_refresh_token", Value: refreshToken})
	w := httptest.NewRecorder()
	handler.handleRefresh(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("first refresh should succeed: %d %s", w.Code, w.Body.String())
	}

	req2 := httptest.NewRequest("POST", "/api/v1/auth/refresh", nil)
	req2.AddCookie(&http.Cookie{Name: "pc_refresh_token", Value: refreshToken})
	w2 := httptest.NewRecorder()
	handler.handleRefresh(w2, req2)

	if w2.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 on reuse, got %d", w2.Code)
	}

	var sessionCount int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, user.ID).Scan(&sessionCount)
	if sessionCount != 0 {
		t.Errorf("all sessions should be invalidated on reuse, got %d", sessionCount)
	}
}

func TestRefreshExpiredSession(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	hash, _ := HashPassword("mypassword")
	user := &User{
		Email:         "expired@example.com",
		Nickname:      "ExpiredUser",
		PasswordHash:  hash,
		Role:          "Free",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	refreshToken, _ := GenerateRefreshToken()
	refreshHash := HashRefreshToken(refreshToken)
	session := &Session{
		UserID:           user.ID,
		RefreshTokenHash: refreshHash,
		ExpiresAt:        time.Now().Add(-1 * time.Hour),
	}
	CreateSession(ctx, db, session)

	req := httptest.NewRequest("POST", "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "pc_refresh_token", Value: refreshToken})
	w := httptest.NewRecorder()
	handler.handleRefresh(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for expired session, got %d", w.Code)
	}
}

func TestRefreshNoCookie(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	req := httptest.NewRequest("POST", "/api/v1/auth/refresh", nil)
	w := httptest.NewRecorder()
	handler.handleRefresh(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without cookie, got %d", w.Code)
	}
}

func TestLogout(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	hash, _ := HashPassword("mypassword")
	user := &User{
		Email:         "logout@example.com",
		Nickname:      "LogoutUser",
		PasswordHash:  hash,
		Role:          "Free",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	refreshToken, _ := GenerateRefreshToken()
	refreshHash := HashRefreshToken(refreshToken)
	session := &Session{
		UserID:           user.ID,
		RefreshTokenHash: refreshHash,
		ExpiresAt:        time.Now().Add(24 * time.Hour),
	}
	CreateSession(ctx, db, session)

	req := httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: "pc_refresh_token", Value: refreshToken})
	w := httptest.NewRecorder()
	handler.handleLogout(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var count int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = ?`, session.ID).Scan(&count)
	if count != 0 {
		t.Error("session should be deleted after logout")
	}
}

func TestVerifyEmail(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	user := &User{
		Email:        "verify@example.com",
		Nickname:     "VerifyUser",
		PasswordHash: "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:         "Free",
	}
	CreateUser(ctx, db, user)

	ev := &EmailVerification{
		UserID:    user.ID,
		Email:     user.Email,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	CreateEmailVerification(ctx, db, ev)

	req := httptest.NewRequest("GET", "/api/v1/auth/verify-email?token="+ev.ID, nil)
	w := httptest.NewRecorder()
	handler.handleVerifyEmail(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	fetched, _ := GetUserByID(ctx, db, user.ID)
	if !fetched.EmailVerified {
		t.Error("email should be verified")
	}
}

func TestVerifyEmailExpired(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	user := &User{
		Email:        "expired@example.com",
		Nickname:     "ExpiredUser",
		PasswordHash: "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:         "Free",
	}
	CreateUser(ctx, db, user)

	ev := &EmailVerification{
		UserID:    user.ID,
		Email:     user.Email,
		ExpiresAt: time.Now().Add(-1 * time.Hour),
	}
	CreateEmailVerification(ctx, db, ev)

	req := httptest.NewRequest("GET", "/api/v1/auth/verify-email?token="+ev.ID, nil)
	w := httptest.NewRecorder()
	handler.handleVerifyEmail(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for expired token, got %d", w.Code)
	}
}

func TestVerifyEmailUsed(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	user := &User{
		Email:        "used@example.com",
		Nickname:     "UsedUser",
		PasswordHash: "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:         "Free",
	}
	CreateUser(ctx, db, user)

	ev := &EmailVerification{
		UserID:    user.ID,
		Email:     user.Email,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	CreateEmailVerification(ctx, db, ev)
	UseEmailVerification(ctx, db, ev.ID)

	req := httptest.NewRequest("GET", "/api/v1/auth/verify-email?token="+ev.ID, nil)
	w := httptest.NewRecorder()
	handler.handleVerifyEmail(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for used token, got %d", w.Code)
	}
}

func TestVerifyEmailInvalidToken(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	req := httptest.NewRequest("GET", "/api/v1/auth/verify-email?token=invalid-token-id", nil)
	w := httptest.NewRecorder()
	handler.handleVerifyEmail(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid token, got %d", w.Code)
	}
}

func TestGoogleAuthNotEnabled(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	req := httptest.NewRequest("POST", "/api/v1/auth/google", nil)
	w := httptest.NewRecorder()
	handler.handleGoogleAuth(w, req)

	if w.Code != http.StatusNotImplemented {
		t.Errorf("expected 501, got %d", w.Code)
	}
}

func TestRegisterBodyTooLarge(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	largeBody := `{"email":"test@example.com","password":"` + strings.Repeat("a", 5000) + `","nickname":"Test"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(largeBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleRegister(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for body too large, got %d", w.Code)
	}
}

func TestRegisterEmptyBody(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	req := httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader([]byte{}))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleRegister(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty body, got %d", w.Code)
	}
}
