package auth

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func setupTestRateLimiter(t *testing.T, cfg AuthConfig) (*AuthRateLimiter, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	return NewAuthRateLimiter(rdb, cfg), mr
}

func TestCheckLogin_Allowed(t *testing.T) {
	cfg := testConfig()
	cfg.RateLimitLoginMax = 3
	rl, _ := setupTestRateLimiter(t, cfg)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		allowed, _ := rl.CheckLogin(ctx, "1.2.3.4", "user@example.com")
		if !allowed {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
}

func TestCheckLogin_Blocked(t *testing.T) {
	cfg := testConfig()
	cfg.RateLimitLoginMax = 2
	rl, _ := setupTestRateLimiter(t, cfg)
	ctx := context.Background()

	rl.CheckLogin(ctx, "1.2.3.4", "user@example.com")
	rl.CheckLogin(ctx, "1.2.3.4", "user@example.com")
	allowed, retryAfter := rl.CheckLogin(ctx, "1.2.3.4", "user@example.com")
	if allowed {
		t.Fatal("should be blocked after 2 requests")
	}
	if retryAfter <= 0 {
		t.Error("retryAfter should be positive")
	}
}

func TestCheckRegister_Allowed(t *testing.T) {
	cfg := testConfig()
	cfg.RateLimitRegisterMax = 3
	rl, _ := setupTestRateLimiter(t, cfg)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		allowed, _ := rl.CheckRegister(ctx, "1.2.3.4")
		if !allowed {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
}

func TestCheckRegister_Blocked(t *testing.T) {
	cfg := testConfig()
	cfg.RateLimitRegisterMax = 2
	rl, _ := setupTestRateLimiter(t, cfg)
	ctx := context.Background()

	rl.CheckRegister(ctx, "1.2.3.4")
	rl.CheckRegister(ctx, "1.2.3.4")
	allowed, _ := rl.CheckRegister(ctx, "1.2.3.4")
	if allowed {
		t.Fatal("should be blocked after 2 requests")
	}
}

func TestRecordLoginFailure_Lockout(t *testing.T) {
	cfg := testConfig()
	cfg.LockoutThreshold = 3
	rl, _ := setupTestRateLimiter(t, cfg)
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		locked, _ := rl.RecordLoginFailure(ctx, "user-1")
		if locked {
			t.Fatalf("should not be locked after %d failures", i+1)
		}
	}

	locked, delay := rl.RecordLoginFailure(ctx, "user-1")
	if !locked {
		t.Fatal("should be locked after 3 failures")
	}
	if delay <= 0 {
		t.Error("delay should be positive")
	}
}

func TestCheckLockout(t *testing.T) {
	cfg := testConfig()
	cfg.LockoutThreshold = 2
	rl, _ := setupTestRateLimiter(t, cfg)
	ctx := context.Background()

	locked, _ := rl.CheckLockout(ctx, "user-2")
	if locked {
		t.Fatal("should not be locked initially")
	}

	rl.RecordLoginFailure(ctx, "user-2")
	rl.RecordLoginFailure(ctx, "user-2")

	locked, remaining := rl.CheckLockout(ctx, "user-2")
	if !locked {
		t.Fatal("should be locked after threshold")
	}
	if remaining <= 0 {
		t.Error("remaining should be positive")
	}
}

func TestClearFailures(t *testing.T) {
	cfg := testConfig()
	cfg.LockoutThreshold = 2
	rl, _ := setupTestRateLimiter(t, cfg)
	ctx := context.Background()

	rl.RecordLoginFailure(ctx, "user-3")
	rl.RecordLoginFailure(ctx, "user-3")

	locked, _ := rl.CheckLockout(ctx, "user-3")
	if !locked {
		t.Fatal("should be locked")
	}

	rl.ClearFailures(ctx, "user-3")

	locked, _ = rl.CheckLockout(ctx, "user-3")
	if locked {
		t.Fatal("should be unlocked after ClearFailures")
	}
}

func TestProgressiveDelay(t *testing.T) {
	cases := []struct {
		attempts int
		expected time.Duration
	}{
		{1, 0},
		{2, 1 * time.Second},
		{3, 2 * time.Second},
		{4, 4 * time.Second},
		{5, 8 * time.Second},
	}
	for _, c := range cases {
		got := progressiveDelay(c.attempts)
		if got != c.expected {
			t.Errorf("progressiveDelay(%d) = %v, want %v", c.attempts, got, c.expected)
		}
	}
}

func TestCheckRecovery_Allowed(t *testing.T) {
	cfg := testConfig()
	cfg.RateLimitRecoveryMax = 2
	rl, _ := setupTestRateLimiter(t, cfg)
	ctx := context.Background()

	allowed, _ := rl.CheckRecovery(ctx, "user@example.com")
	if !allowed {
		t.Fatal("first request should be allowed")
	}
	allowed, _ = rl.CheckRecovery(ctx, "user@example.com")
	if !allowed {
		t.Fatal("second request should be allowed")
	}
	allowed, _ = rl.CheckRecovery(ctx, "user@example.com")
	if allowed {
		t.Fatal("third request should be blocked")
	}
}
