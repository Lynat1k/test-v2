package admin

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/procluster/procluster/internal/auth"
	"github.com/redis/go-redis/v9"
)

type AdminRateLimiter struct {
	rdb     *redis.Client
	maxReqs int
	window  time.Duration
}

func NewAdminRateLimiter(rdb *redis.Client) *AdminRateLimiter {
	maxReqs := 30
	if v := os.Getenv("ADMIN_RATE_LIMIT_MAX"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxReqs = n
		}
	}
	return &AdminRateLimiter{
		rdb:     rdb,
		maxReqs: maxReqs,
		window:  time.Minute,
	}
}

func (rl *AdminRateLimiter) Allow(ctx context.Context, key string) bool {
	now := time.Now().UnixMilli()
	windowStart := now - rl.window.Milliseconds()

	pipe := rl.rdb.Pipeline()
	pipe.ZRemRangeByScore(ctx, key, "0", formatMs(windowStart))
	pipe.ZCard(ctx, key)
	results, err := pipe.Exec(ctx)
	if err != nil {
		return true
	}

	count := results[1].(*redis.IntCmd).Val()
	if count >= int64(rl.maxReqs) {
		return false
	}

	pipe2 := rl.rdb.Pipeline()
	pipe2.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: now})
	pipe2.Expire(ctx, key, rl.window*2)
	_, _ = pipe2.Exec(ctx)

	return true
}

func formatMs(ms int64) string {
	return time.UnixMilli(ms).Format(time.RFC3339Nano)
}

func AdminRateLimitMiddleware(rl *AdminRateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, _ := r.Context().Value(auth.UserIDKey).(string)
		if userID == "" {
			userID = "unknown"
		}
		key := "rl:admin:" + userID
		if !rl.Allow(r.Context(), key) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"ok":false,"error":{"code":"RATE_LIMITED","message":"admin rate limit exceeded"}}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
