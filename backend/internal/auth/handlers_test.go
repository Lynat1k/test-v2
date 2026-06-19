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

func TestLogin_ReturnsCompressionMax(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()
	handler.SetTierCompressionMax(map[string]int{"guest": 1, "free": 1, "pro": 3, "vip": 6, "admin": 10})

	hash, _ := HashPassword("adminpass")
	user := &User{
		Email:         "adminlogin@example.com",
		Nickname:      "AdminUser",
		PasswordHash:  hash,
		Role:          "admin",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	body := `{"email":"adminlogin@example.com","password":"adminpass"}`
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

	userResp, ok := data["user"].(map[string]interface{})
	if !ok {
		t.Fatal("expected user object in login response")
	}

	// compressionMax must be present and 10 for admin
	compMax, ok := userResp["compressionMax"]
	if !ok {
		t.Fatal("compressionMax field missing from login user response")
	}
	if compMax != float64(10) {
		t.Errorf("admin compressionMax: got %v, want 10", compMax)
	}

	// daysLeft should also be present
	if _, ok := userResp["daysLeft"]; !ok {
		t.Error("daysLeft field missing from login user response")
	}
}

func TestLoginByNickname(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	hash, _ := HashPassword("mypassword")
	user := &User{
		Email:         "loginby@example.com",
		Nickname:      "LoginByNick",
		PasswordHash:  hash,
		Role:          "Free",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	// Login by nickname (not email)
	body := `{"email":"LoginByNick","password":"mypassword"}`
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
		t.Error("expected accessToken when logging in by nickname")
	}
}

func TestRegisterNicknameExists(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	ctx := context.Background()

	// Create first user
	hash, _ := HashPassword("password123")
	user := &User{
		Email:         "first@example.com",
		Nickname:      "TakenNick",
		PasswordHash:  hash,
		Role:          "free",
		EmailVerified: true,
	}
	CreateUser(ctx, db, user)

	// Try to register with same nickname but different email
	body := `{"email":"second@example.com","password":"password123","nickname":"TakenNick"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.handleRegister(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for duplicate nickname, got %d: %s", w.Code, w.Body.String())
	}

	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Err == nil || resp.Err.Code != "NICKNAME_EXISTS" {
		t.Errorf("expected NICKNAME_EXISTS error, got %+v", resp.Err)
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

// --- Phase 10: Profile endpoint tests ---

func createVerifiedUser(t *testing.T, db *sql.DB, email, password, nickname string) *User {
	t.Helper()
	ctx := context.Background()
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user := &User{
		Email:         email,
		Nickname:      nickname,
		PasswordHash:  hash,
		Role:          "free",
		EmailVerified: true,
	}
	if err := CreateUser(ctx, db, user); err != nil {
		t.Fatalf("create user: %v", err)
	}
	SetEmailVerified(ctx, db, user.ID)
	return user
}

func authRequest(handler *Handler, method, path, body string, user *User) (*httptest.ResponseRecorder, *http.Request) {
	var reqBody *strings.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	} else {
		reqBody = strings.NewReader("{}")
	}
	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	token, _ := GenerateAccessToken(handler.cfg, user.ID, user.Role)
	req.Header.Set("Authorization", "Bearer "+token)
	// Simulate RequireAuth middleware by setting context values
	ctx := context.WithValue(req.Context(), UserIDKey, user.ID)
	ctx = context.WithValue(ctx, RoleKey, user.Role)
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	return w, req
}

func TestGetMeSuccess(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "me@example.com", "password123", "MeUser")

	w, req := authRequest(handler, "GET", "/api/v1/user/me", "", user)
	handler.handleGetMe(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp.Data.(map[string]interface{})
	if data["email"] != "me@example.com" {
		t.Errorf("expected email me@example.com, got %v", data["email"])
	}
	if data["nickname"] != "MeUser" {
		t.Errorf("expected nickname MeUser, got %v", data["nickname"])
	}
	if data["role"] != "free" {
		t.Errorf("expected role free, got %v", data["role"])
	}
	if data["subscriptionStatus"] != "none" {
		t.Errorf("expected subscriptionStatus none, got %v", data["subscriptionStatus"])
	}
}

func TestGetMe_CompressionMax_FreeUser(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	handler.SetTierCompressionMax(map[string]int{"guest": 1, "free": 1, "pro": 3, "vip": 6, "admin": 10})
	user := createVerifiedUser(t, db, "freeuser@example.com", "password123", "FreeUser")

	w, req := authRequest(handler, "GET", "/api/v1/user/me", "", user)
	handler.handleGetMe(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp.Data.(map[string]interface{})
	if data["compressionMax"] != float64(1) {
		t.Errorf("free user compressionMax: got %v, want 1", data["compressionMax"])
	}
}

func TestGetMe_CompressionMax_ProUser(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	handler.SetTierCompressionMax(map[string]int{"guest": 1, "free": 1, "pro": 3, "vip": 6, "admin": 10})
	user := createVerifiedUser(t, db, "prouser@example.com", "password123", "ProUser")
	if _, err := db.Exec("UPDATE users SET role = 'pro' WHERE id = ?", user.ID); err != nil {
		t.Fatalf("update role: %v", err)
	}
	user.Role = "pro"

	w, req := authRequest(handler, "GET", "/api/v1/user/me", "", user)
	handler.handleGetMe(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp.Data.(map[string]interface{})
	if data["compressionMax"] != float64(3) {
		t.Errorf("pro user compressionMax: got %v, want 3", data["compressionMax"])
	}
}

func TestGetMe_CompressionMax_NoMap_FallbackOne(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	// deliberately NOT calling SetTierCompressionMax — nil map
	user := createVerifiedUser(t, db, "fallback@example.com", "password123", "FallbackUser")

	w, req := authRequest(handler, "GET", "/api/v1/user/me", "", user)
	handler.handleGetMe(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp.Data.(map[string]interface{})
	if data["compressionMax"] != float64(1) {
		t.Errorf("with nil map compressionMax: got %v, want 1 (fallback)", data["compressionMax"])
	}
}

func TestGetMeUnauthorized(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	// Route through RequireAuth middleware — should reject before reaching handler
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/api/v1/user/me", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestChangePasswordSuccess(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "chpw@example.com", "oldpassword123", "ChpwUser")

	// Create a session to verify it gets deleted
	ctx := context.Background()
	session := &Session{
		UserID:           user.ID,
		RefreshTokenHash: "somehash",
		UserAgent:        "test",
		IP:               "127.0.0.1",
		ExpiresAt:        time.Now().Add(24 * time.Hour),
	}
	CreateSession(ctx, db, session)

	body := `{"currentPassword":"oldpassword123","newPassword":"newpassword456"}`
	w, req := authRequest(handler, "POST", "/api/v1/user/change-password", body, user)
	handler.handleChangePassword(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify old password no longer works
	if CheckPassword(GetUserByIDMust(t, db, user.ID).PasswordHash, "oldpassword123") {
		t.Error("old password should no longer be valid")
	}

	// Verify new password works
	if !CheckPassword(GetUserByIDMust(t, db, user.ID).PasswordHash, "newpassword456") {
		t.Error("new password should be valid")
	}

	// Verify all sessions deleted
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, user.ID).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 sessions, got %d", count)
	}
}

func TestChangePasswordWrongCurrent(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "wrong@example.com", "password123", "WrongUser")

	body := `{"currentPassword":"wrongpassword","newPassword":"newpassword456"}`
	w, req := authRequest(handler, "POST", "/api/v1/user/change-password", body, user)
	handler.handleChangePassword(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestChangePasswordShortNew(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "short@example.com", "password123", "ShortUser")

	body := `{"currentPassword":"password123","newPassword":"short"}`
	w, req := authRequest(handler, "POST", "/api/v1/user/change-password", body, user)
	handler.handleChangePassword(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestChangePasswordSessionsInvalidated(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "sess@example.com", "password123", "SessUser")

	ctx := context.Background()
	session := &Session{
		UserID:           user.ID,
		RefreshTokenHash: "oldhash",
		UserAgent:        "test",
		IP:               "127.0.0.1",
		ExpiresAt:        time.Now().Add(24 * time.Hour),
	}
	CreateSession(ctx, db, session)

	body := `{"currentPassword":"password123","newPassword":"newpassword456"}`
	w, req := authRequest(handler, "POST", "/api/v1/user/change-password", body, user)
	handler.handleChangePassword(w, req)

	// Verify old refresh token no longer works
	_, err := GetSessionByRefreshHash(ctx, db, "oldhash")
	if err != sql.ErrNoRows {
		t.Error("old session should be deleted after password change")
	}
}

func TestUpdateProfileSuccess(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "upd@example.com", "password123", "OldNick")

	body := `{"nickname":"NewNick","avatar":"avatar-2"}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/profile", body, user)
	handler.handleUpdateProfile(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	updated := GetUserByIDMust(t, db, user.ID)
	if updated.Nickname != "NewNick" {
		t.Errorf("expected nickname NewNick, got %s", updated.Nickname)
	}
	if updated.Avatar != "avatar-2" {
		t.Errorf("expected avatar avatar-2, got %s", updated.Avatar)
	}
}

func TestUpdateProfileInvalidNickname(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "invnick@example.com", "password123", "ValidNick")

	body := `{"nickname":"X","avatar":""}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/profile", body, user)
	handler.handleUpdateProfile(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestUpdateProfileInvalidAvatar(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "invav@example.com", "password123", "ValidUser")

	body := `{"nickname":"ValidNick","avatar":"not-a-valid-url-or-preset"}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/profile", body, user)
	handler.handleUpdateProfile(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestUpdateProfileEmptyAvatar(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "emptyav@example.com", "password123", "EmptyAvUser")

	body := `{"nickname":"EmptyAvUser","avatar":""}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/profile", body, user)
	handler.handleUpdateProfile(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestUpdateProfileAvatarURL(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "urlav@example.com", "password123", "UrlAvUser")

	body := `{"nickname":"UrlAvUser","avatar":"https://example.com/avatar.png"}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/profile", body, user)
	handler.handleUpdateProfile(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	updated := GetUserByIDMust(t, db, user.ID)
	if updated.Avatar != "https://example.com/avatar.png" {
		t.Errorf("expected avatar URL, got %s", updated.Avatar)
	}
}

func TestGetMe_CompressionMax_CaseInsensitiveRole(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	handler.SetTierCompressionMax(map[string]int{"free": 1, "pro": 3})
	user := createVerifiedUser(t, db, "casefree@example.com", "password123", "CaseFree")
	// Override role to "Free" (capital F) — should still resolve via strings.ToLower
	if _, err := db.Exec("UPDATE users SET role = 'Free' WHERE id = ?", user.ID); err != nil {
		t.Fatalf("update role: %v", err)
	}
	user.Role = "Free"

	w, req := authRequest(handler, "GET", "/api/v1/user/me", "", user)
	handler.handleGetMe(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp.Data.(map[string]interface{})
	if data["compressionMax"] != float64(1) {
		t.Errorf("'Free' (capital) user compressionMax: got %v, want 1", data["compressionMax"])
	}
}

func TestGetMe_CompressionMax_UnknownRole_FallbackOne(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	// Map has only known tiers; "unknown" role is NOT in the map
	handler.SetTierCompressionMax(map[string]int{"free": 1, "pro": 3, "vip": 6, "admin": 10})
	user := createVerifiedUser(t, db, "unknown@example.com", "password123", "UnknownRole")
	if _, err := db.Exec("UPDATE users SET role = 'unknown' WHERE id = ?", user.ID); err != nil {
		t.Fatalf("update role: %v", err)
	}
	user.Role = "unknown"

	w, req := authRequest(handler, "GET", "/api/v1/user/me", "", user)
	handler.handleGetMe(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp authResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp.Data.(map[string]interface{})
	if data["compressionMax"] != float64(1) {
		t.Errorf("unknown role compressionMax: got %v, want 1 (safe default)", data["compressionMax"])
	}
}

func GetUserByIDMust(t *testing.T, db *sql.DB, id string) *User {
	t.Helper()
	user, err := GetUserByID(context.Background(), db, id)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	return user
}

// --- Drawing Defaults tests ---

func TestGetDrawingDefaults_Guest_ReturnsEmpty(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()

	req := httptest.NewRequest("GET", "/api/v1/user/drawing-defaults", nil)
	w := httptest.NewRecorder()
	handler.handleGetDrawingDefaults(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK   bool                   `json:"ok"`
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.OK {
		t.Fatalf("expected ok=true")
	}
	if len(resp.Data) != 0 {
		t.Fatalf("guest drawing-defaults should be empty, got %v", resp.Data)
	}
}

func TestGetDrawingDefaults_AuthUser_Success(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "draw@example.com", "pass1234", "DrawUser")

	// Insert a default
	ctx := context.Background()
	if err := UpsertDrawingDefault(ctx, db, user.ID, "volume", `{"opacity":0.5,"volColor":"#ff0000","pocColor":"#00ff00","extendPoc":true}`); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := UpsertDrawingDefault(ctx, db, user.ID, "position", `{"deposit":5000,"risk":2}`); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	w, req := authRequest(handler, "GET", "/api/v1/user/drawing-defaults", "", user)
	handler.handleGetDrawingDefaults(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK   bool                   `json:"ok"`
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.OK {
		t.Fatalf("expected ok=true")
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 drawing types, got %d", len(resp.Data))
	}

	volume, ok := resp.Data["volume"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected volume key in data")
	}
	if volume["opacity"] != 0.5 {
		t.Fatalf("expected opacity=0.5, got %v", volume["opacity"])
	}
	if volume["volColor"] != "#ff0000" {
		t.Fatalf("expected volColor=#ff0000, got %v", volume["volColor"])
	}
	if volume["extendPoc"] != true {
		t.Fatalf("expected extendPoc=true, got %v", volume["extendPoc"])
	}

	position, ok := resp.Data["position"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected position key in data")
	}
	if position["deposit"] != float64(5000) {
		t.Fatalf("expected deposit=5000, got %v", position["deposit"])
	}
}

func TestPutDrawingDefaults_Success(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "putdraw@example.com", "pass1234", "PutDrawUser")

	body := `{"drawingType":"volume","settings":{"opacity":0.75,"volColor":"#ff0000","pocColor":"#00ff00","extendPoc":true}}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/drawing-defaults", body, user)
	handler.handlePutDrawingDefaults(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify via GET
	ctx := context.Background()
	defaults, err := GetDrawingDefaults(ctx, db, user.ID)
	if err != nil {
		t.Fatalf("get drawing defaults: %v", err)
	}
	if len(defaults) != 1 {
		t.Fatalf("expected 1 drawing default, got %d", len(defaults))
	}
	if defaults["volume"] != `{"opacity":0.75,"volColor":"#ff0000","pocColor":"#00ff00","extendPoc":true}` {
		t.Fatalf("unexpected volume settings: %s", defaults["volume"])
	}
}

func TestPutDrawingDefaults_OverwritesExisting(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "overwrite@example.com", "pass1234", "OverwriteUser")

	ctx := context.Background()
	UpsertDrawingDefault(ctx, db, user.ID, "volume", `{"opacity":0.3,"volColor":"#0000ff"}`)

	body := `{"drawingType":"volume","settings":{"opacity":0.9,"volColor":"#ff0000","pocColor":"#00ff00","extendPoc":true}}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/drawing-defaults", body, user)
	handler.handlePutDrawingDefaults(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	defaults, err := GetDrawingDefaults(ctx, db, user.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if defaults["volume"] != `{"opacity":0.9,"volColor":"#ff0000","pocColor":"#00ff00","extendPoc":true}` {
		t.Fatalf("expected overwritten settings, got: %s", defaults["volume"])
	}
}

func TestPutDrawingDefaults_InvalidType(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "invalidtype@example.com", "pass1234", "InvalidType")

	body := `{"drawingType":"nonexistent","settings":{"opacity":0.5}}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/drawing-defaults", body, user)
	handler.handlePutDrawingDefaults(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPutDrawingDefaults_InvalidSettings(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "invalidjson@example.com", "pass1234", "InvalidJSON")

	body := `{"drawingType":"volume","settings":"notanobject"}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/drawing-defaults", body, user)
	handler.handlePutDrawingDefaults(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPutDrawingDefaults_NullSettings(t *testing.T) {
	handler, db := setupTestHandler(t)
	defer db.Close()
	user := createVerifiedUser(t, db, "nullsettings@example.com", "pass1234", "NullSettings")

	body := `{"drawingType":"volume","settings":null}`
	w, req := authRequest(handler, "PUT", "/api/v1/user/drawing-defaults", body, user)
	handler.handlePutDrawingDefaults(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetDrawingDefaults_OnlyOwnUser(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	user1 := createVerifiedUser(t, db, "user1@example.com", "pass1234", "UserOne")
	user2 := createVerifiedUser(t, db, "user2@example.com", "pass1234", "UserTwo")

	ctx := context.Background()
	UpsertDrawingDefault(ctx, db, user1.ID, "volume", `{"opacity":0.5}`)
	UpsertDrawingDefault(ctx, db, user2.ID, "position", `{"deposit":100}`)

	// User1 sees only their volume default
	defaults1, err := GetDrawingDefaults(ctx, db, user1.ID)
	if err != nil {
		t.Fatalf("get user1: %v", err)
	}
	if len(defaults1) != 1 || defaults1["volume"] == "" {
		t.Fatalf("user1 should have 1 default (volume), got %v", defaults1)
	}

	// User2 sees only their position default
	defaults2, err := GetDrawingDefaults(ctx, db, user2.ID)
	if err != nil {
		t.Fatalf("get user2: %v", err)
	}
	if len(defaults2) != 1 || defaults2["position"] == "" {
		t.Fatalf("user2 should have 1 default (position), got %v", defaults2)
	}
}
