package auth

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type AuthRateLimiter struct {
	rdb *redis.Client
	cfg AuthConfig
}

func NewAuthRateLimiter(rdb *redis.Client, cfg AuthConfig) *AuthRateLimiter {
	return &AuthRateLimiter{rdb: rdb, cfg: cfg}
}

// slidingWindowKey checks the sliding window limit. Returns true if allowed.
func (a *AuthRateLimiter) slidingWindowKey(ctx context.Context, key string, limit int, window time.Duration) bool {
	now := time.Now().UnixMilli()
	windowStart := now - window.Milliseconds()

	a.rdb.ZRemRangeByScore(ctx, key, "0", strconv.FormatInt(windowStart, 10))
	count, err := a.rdb.ZCard(ctx, key).Result()
	if err != nil {
		log.Printf("[auth-ratelimit] zcard error: %v", err)
		return true
	}
	if int(count) >= limit {
		return false
	}
	a.rdb.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: strconv.FormatInt(now, 10)})
	a.rdb.Expire(ctx, key, window)
	return true
}

func (a *AuthRateLimiter) windowTTL(ctx context.Context, key string) time.Duration {
	ttl, err := a.rdb.TTL(ctx, key).Result()
	if err != nil || ttl < 0 {
		return 0
	}
	return ttl
}

func (a *AuthRateLimiter) CheckLogin(ctx context.Context, ip, email string) (allowed bool, retryAfter time.Duration) {
	if !a.slidingWindowKey(ctx, "rl:login:"+ip+":"+email, a.cfg.RateLimitLoginMax, a.cfg.RateLimitWindow) {
		return false, a.windowTTL(ctx, "rl:login:"+ip+":"+email)
	}
	return true, 0
}

func (a *AuthRateLimiter) CheckRegister(ctx context.Context, ip string) (allowed bool, retryAfter time.Duration) {
	if !a.slidingWindowKey(ctx, "rl:register:"+ip, a.cfg.RateLimitRegisterMax, a.cfg.RateLimitWindow) {
		return false, a.windowTTL(ctx, "rl:register:"+ip)
	}
	return true, 0
}

func (a *AuthRateLimiter) CheckRecovery(ctx context.Context, email string) (allowed bool, retryAfter time.Duration) {
	if !a.slidingWindowKey(ctx, "rl:recovery:"+email, a.cfg.RateLimitRecoveryMax, a.cfg.RateLimitWindow) {
		return false, a.windowTTL(ctx, "rl:recovery:"+email)
	}
	return true, 0
}

// CheckResendVerification: same budget as recovery (3/window by default), keyed by user.
func (a *AuthRateLimiter) CheckResendVerification(ctx context.Context, userID string) (allowed bool, retryAfter time.Duration) {
	key := "rl:resend-verify:" + userID
	if !a.slidingWindowKey(ctx, key, a.cfg.RateLimitRecoveryMax, a.cfg.RateLimitWindow) {
		return false, a.windowTTL(ctx, key)
	}
	return true, 0
}

// RecordLoginFailure increments the failure counter for a user.
// Returns (isLocked, remainingDelay).
func (a *AuthRateLimiter) RecordLoginFailure(ctx context.Context, userID string) (isLocked bool, remainingDelay time.Duration) {
	key := "failed:" + userID

	count, err := a.rdb.Incr(ctx, key).Result()
	if err != nil {
		log.Printf("[auth-ratelimit] incr failed counter error: %v", err)
		return false, 0
	}

	a.rdb.Expire(ctx, key, a.cfg.LockoutWindow)

	if int(count) >= a.cfg.LockoutThreshold {
		lockKey := "lockout:" + userID
		a.rdb.Set(ctx, lockKey, "1", a.cfg.LockoutWindow)
		return true, a.cfg.LockoutWindow
	}

	delay := progressiveDelay(int(count))
	return false, delay
}

// CheckLockout returns true if the user is locked out (and the remaining TTL).
func (a *AuthRateLimiter) CheckLockout(ctx context.Context, userID string) (locked bool, remaining time.Duration) {
	lockKey := "lockout:" + userID
	ttl, err := a.rdb.TTL(ctx, lockKey).Result()
	if err != nil || ttl <= 0 {
		return false, 0
	}
	return true, ttl
}

// ClearFailures resets the failed attempts counter on successful login.
func (a *AuthRateLimiter) ClearFailures(ctx context.Context, userID string) {
	a.rdb.Del(ctx, "failed:"+userID)
	a.rdb.Del(ctx, "lockout:"+userID)
}

func progressiveDelay(attempts int) time.Duration {
	switch attempts {
	case 1:
		return 0
	case 2:
		return 1 * time.Second
	case 3:
		return 2 * time.Second
	case 4:
		return 4 * time.Second
	default:
		return 8 * time.Second
	}
}
