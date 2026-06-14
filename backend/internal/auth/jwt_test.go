package auth

import (
	"testing"
	"time"
)

func testConfig() AuthConfig {
	return AuthConfig{
		JWTSecret:            []byte("test-secret-key-for-testing"),
		AccessTokenTTL:       15 * time.Minute,
		RefreshTokenTTL:      720 * time.Hour,
		EmailVerificationTTL: 24 * time.Hour,
		CookieDomain:         "localhost",
		CookieSecure:         false,
		RateLimitWindow:      5 * time.Minute,
		RateLimitLoginMax:    1000,
		RateLimitRegisterMax: 1000,
		RateLimitRecoveryMax: 1000,
		LockoutThreshold:     1000,
		LockoutWindow:        15 * time.Minute,
		HistoryMaxGuest:      7 * 24 * time.Hour,
		HistoryMaxFree:       180 * 24 * time.Hour,
		SessionLimits: map[string]int{
			"guest": 1,
			"free":  1,
			"pro":   2,
			"vip":   2,
			"admin": -1,
		},
	}
}

func TestGenerateParseAccessToken(t *testing.T) {
	cfg := testConfig()
	token, err := GenerateAccessToken(cfg, "user123", "Free")
	if err != nil {
		t.Fatalf("GenerateAccessToken error: %v", err)
	}

	claims, err := ParseAccessToken(cfg, token)
	if err != nil {
		t.Fatalf("ParseAccessToken error: %v", err)
	}

	if claims.UserID != "user123" {
		t.Errorf("expected UserID user123, got %s", claims.UserID)
	}
	if claims.Role != "Free" {
		t.Errorf("expected Role Free, got %s", claims.Role)
	}
	if claims.Subject != "user123" {
		t.Errorf("expected Subject user123, got %s", claims.Subject)
	}
}

func TestAccessTokenExpired(t *testing.T) {
	cfg := testConfig()
	cfg.AccessTokenTTL = -1 * time.Second

	token, err := GenerateAccessToken(cfg, "user123", "Free")
	if err != nil {
		t.Fatalf("GenerateAccessToken error: %v", err)
	}

	_, err = ParseAccessToken(cfg, token)
	if err == nil {
		t.Error("ParseAccessToken should fail for expired token")
	}
}

func TestAccessTokenInvalidSignature(t *testing.T) {
	cfg := testConfig()
	token, err := GenerateAccessToken(cfg, "user123", "Free")
	if err != nil {
		t.Fatalf("GenerateAccessToken error: %v", err)
	}

	wrongCfg := testConfig()
	wrongCfg.JWTSecret = []byte("different-secret-key")
	_, err = ParseAccessToken(wrongCfg, token)
	if err == nil {
		t.Error("ParseAccessToken should fail with wrong secret")
	}
}

func TestAccessTokenInvalidFormat(t *testing.T) {
	cfg := testConfig()
	_, err := ParseAccessToken(cfg, "not-a-jwt-token")
	if err == nil {
		t.Error("ParseAccessToken should fail for invalid token format")
	}
}

func TestGenerateRefreshTokenUnique(t *testing.T) {
	t1, _ := GenerateRefreshToken()
	t2, _ := GenerateRefreshToken()
	if t1 == t2 {
		t.Error("refresh tokens should be unique")
	}
}
