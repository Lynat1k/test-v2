package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiter struct {
	rdb        *redis.Client
	mu         sync.Mutex
	windowSize time.Duration
	maxReqs    int
}

func NewRateLimiter(rdb *redis.Client, windowSize time.Duration, maxReqs int) *RateLimiter {
	return &RateLimiter{
		rdb:        rdb,
		windowSize: windowSize,
		maxReqs:    maxReqs,
	}
}

func (rl *RateLimiter) Allow(ctx context.Context, key string) bool {
	now := time.Now().UnixMilli()
	windowStart := now - rl.windowSize.Milliseconds()

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
	pipe2.Expire(ctx, key, rl.windowSize*2)
	_, _ = pipe2.Exec(ctx)

	return true
}

func formatMs(ms int64) string {
	return time.UnixMilli(ms).Format(time.RFC3339Nano)
}

func IPKey(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.Header.Get("X-Real-IP")
	}
	if ip == "" {
		ip = r.RemoteAddr
	}
	return "rl:" + ip
}

func RateLimitMiddleware(rl *RateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.Allow(r.Context(), IPKey(r)) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"ok":false,"error":{"code":"RATE_LIMITED","message":"too many requests"}}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func WSRateLimitMiddleware(rl *RateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.Allow(r.Context(), "rl:ws:"+IPKey(r)) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"ok":false,"error":{"code":"RATE_LIMITED","message":"too many WS connections"}}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
