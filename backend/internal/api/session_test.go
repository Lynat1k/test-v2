package api

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func setupTestRedis(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	return rdb, mr
}

func TestSessionLimit_NoRaceOverflow(t *testing.T) {
	rdb, _ := setupTestRedis(t)
	limits := map[string]int{"guest": 1, "free": 1, "pro": 2, "vip": 2, "admin": -1}
	sm := NewSessionManager(rdb, limits)

	userId := "test-user-1"
	tier := "free"
	limit := limits[tier]
	if limit != 1 {
		t.Fatalf("expected limit 1 for free tier, got %d", limit)
	}

	const concurrency = 50
	results := make([]RegisterResult, concurrency)
	errors := make([]error, concurrency)

	var wg sync.WaitGroup
	wg.Add(concurrency)

	for i := 0; i < concurrency; i++ {
		go func(idx int) {
			defer wg.Done()
			sessionId := generateTestSessionID(idx)
			res, err := sm.RegisterSession(context.Background(), userId, tier, sessionId)
			results[idx] = res
			errors[idx] = err
		}(i)
	}

	wg.Wait()

	for i, err := range errors {
		if err != nil {
			t.Errorf("goroutine %d: unexpected error: %v", i, err)
		}
	}

	acceptedCount := 0
	for _, res := range results {
		if res.Accepted {
			acceptedCount++
		}
	}

	if acceptedCount == 0 {
		t.Fatal("expected at least 1 accepted session")
	}

	liveCount, err := sm.CountSessions(context.Background(), userId)
	if err != nil {
		t.Fatalf("count sessions: %v", err)
	}

	if int(liveCount) != limit {
		t.Errorf("expected exactly %d live session, got %d", limit, liveCount)
	}
	if int(liveCount) > limit {
		t.Errorf("CRITICAL: live sessions (%d) OVERFLOWS limit (%d)!", liveCount, limit)
	}

	t.Logf("ACCEPTED: %d/%d goroutines, LIVE: %d, LIMIT: %d — %s",
		acceptedCount, concurrency, liveCount, limit,
		func() string {
			if int(liveCount) == limit {
				return "PASS — no overflow"
			}
			return "FAIL"
		}())
}

func TestSessionLimit_LastWins(t *testing.T) {
	rdb, _ := setupTestRedis(t)
	limits := map[string]int{"guest": 1, "free": 1, "pro": 2, "vip": 2, "admin": -1}
	sm := NewSessionManager(rdb, limits)

	userId := "test-user-2"
	tier := "free"

	res1, err := sm.RegisterSession(context.Background(), userId, tier, "session-1")
	if err != nil {
		t.Fatalf("first register: %v", err)
	}
	if !res1.Accepted {
		t.Fatal("first session should be accepted")
	}

	res2, err := sm.RegisterSession(context.Background(), userId, tier, "session-2")
	if err != nil {
		t.Fatalf("second register: %v", err)
	}
	if !res2.Accepted {
		t.Fatal("second session should be accepted (last-wins)")
	}
	if res2.EvictedID != "session-1" {
		t.Errorf("expected evicted session-1, got %q", res2.EvictedID)
	}

	count, err := sm.CountSessions(context.Background(), userId)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 live session, got %d", count)
	}
}

func TestSessionLimit_Heartbeat(t *testing.T) {
	rdb, _ := setupTestRedis(t)
	limits := map[string]int{"guest": 1, "free": 1, "pro": 2, "vip": 2, "admin": -1}
	sm := NewSessionManager(rdb, limits)

	userId := "test-user-3"
	tier := "free"

	_, err := sm.RegisterSession(context.Background(), userId, tier, "session-hb")
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	ok := sm.Heartbeat(context.Background(), userId, "session-hb")
	if !ok {
		t.Fatal("heartbeat should succeed")
	}

	ok = sm.Heartbeat(context.Background(), userId, "nonexistent")
	if ok {
		t.Fatal("heartbeat for nonexistent session should fail")
	}
}

func TestSessionLimit_RemoveSession(t *testing.T) {
	rdb, _ := setupTestRedis(t)
	limits := map[string]int{"guest": 1, "free": 1, "pro": 2, "vip": 2, "admin": -1}
	sm := NewSessionManager(rdb, limits)

	userId := "test-user-4"
	tier := "free"

	_, err := sm.RegisterSession(context.Background(), userId, tier, "session-rm")
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	sm.RemoveSession(context.Background(), userId, "session-rm")

	count, err := sm.CountSessions(context.Background(), userId)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 sessions after remove, got %d", count)
	}
}

func TestSessionLimit_HeartbeatExpiry(t *testing.T) {
	rdb, mr := setupTestRedis(t)
	limits := map[string]int{"guest": 1, "free": 1, "pro": 2, "vip": 2, "admin": -1}
	sm := NewSessionManager(rdb, limits)

	userId := "test-user-5"
	tier := "free"

	_, err := sm.RegisterSession(context.Background(), userId, tier, "session-exp")
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	mr.FastForward(35 * time.Second)

	res, err := sm.RegisterSession(context.Background(), userId, tier, "session-new")
	if err != nil {
		t.Fatalf("register new: %v", err)
	}
	if !res.Accepted {
		t.Fatal("new session should be accepted after old expired")
	}

	count, err := sm.CountSessions(context.Background(), userId)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 session after expiry, got %d", count)
	}
}

func generateTestSessionID(idx int) string {
	return "test-session-" + time.Now().Format("150405.000000000") + "-" + string(rune('A'+idx%26))
}
