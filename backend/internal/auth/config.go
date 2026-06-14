package auth

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type AuthConfig struct {
	JWTSecret            []byte
	AccessTokenTTL       time.Duration
	RefreshTokenTTL      time.Duration
	EmailVerificationTTL time.Duration
	EmailMode            string
	CookieDomain         string
	CookieSecure         bool
	GoogleOAuthEnabled   bool
	GoogleClientID       string
	GoogleClientSecret   string

	RateLimitWindow      time.Duration
	RateLimitLoginMax    int
	RateLimitRegisterMax int
	RateLimitRecoveryMax int
	LockoutThreshold     int
	LockoutWindow        time.Duration
	HistoryMaxGuest      time.Duration
	HistoryMaxFree       time.Duration
	SessionLimits        map[string]int
}

func LoadAuthConfig() AuthConfig {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secretBytes := make([]byte, 32)
		if _, err := rand.Read(secretBytes); err != nil {
			log.Fatalf("[auth] failed to generate JWT_SECRET: %v", err)
		}
		secret = hex.EncodeToString(secretBytes)
		log.Printf("[auth] WARNING: JWT_SECRET not set, generated ephemeral key (sessions will not survive restart)")
	}

	accessTTL := parseDuration(getEnv("ACCESS_TOKEN_TTL", "15m"), 15*time.Minute)
	refreshTTL := parseDuration(getEnv("REFRESH_TOKEN_TTL", "720h"), 720*time.Hour)

	return AuthConfig{
		JWTSecret:            []byte(secret),
		AccessTokenTTL:       accessTTL,
		RefreshTokenTTL:      refreshTTL,
		EmailVerificationTTL: parseDuration("24h", 24*time.Hour),
		EmailMode:            getEnv("EMAIL_MODE", "log"),
		CookieDomain:         getEnv("COOKIE_DOMAIN", "localhost"),
		CookieSecure:         getEnv("COOKIE_SECURE", "false") == "true",
		GoogleOAuthEnabled:   getEnv("GOOGLE_OAUTH_ENABLED", "false") == "true",
		GoogleClientID:       os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:   os.Getenv("GOOGLE_CLIENT_SECRET"),

		RateLimitWindow:      parseDuration("5m", 5*time.Minute),
		RateLimitLoginMax:    parseIntEnv("RATE_LIMIT_LOGIN_MAX", 10),
		RateLimitRegisterMax: parseIntEnv("RATE_LIMIT_REGISTER_MAX", 5),
		RateLimitRecoveryMax: parseIntEnv("RATE_LIMIT_RECOVERY_MAX", 3),
		LockoutThreshold:     parseIntEnv("LOCKOUT_THRESHOLD", 5),
		LockoutWindow:        parseDuration("15m", 15*time.Minute),
		HistoryMaxGuest:      7 * 24 * time.Hour,
		HistoryMaxFree:       180 * 24 * time.Hour,
		SessionLimits: map[string]int{
			"guest": parseIntEnv("SESSION_LIMIT_GUEST", 1),
			"free":  parseIntEnv("SESSION_LIMIT_FREE", 1),
			"pro":   parseIntEnv("SESSION_LIMIT_PRO", 2),
			"vip":   parseIntEnv("SESSION_LIMIT_VIP", 2),
			"admin": -1,
		},
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseIntEnv(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Printf("[auth] invalid int %q for env %s, using default %d", v, key, fallback)
		return fallback
	}
	return n
}

func parseDuration(s string, fallback time.Duration) time.Duration {
	s = strings.TrimSpace(s)
	if s == "" {
		return fallback
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		log.Printf("[auth] invalid duration %q for env, using default %v: %v", s, fallback, err)
		return fallback
	}
	return d
}
