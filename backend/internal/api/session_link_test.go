package api

import (
	"context"
	"testing"
)

func TestSessionLimits_FromConfig(t *testing.T) {
	rdb, _ := setupTestRedis(t)
	limits := map[string]int{
		"guest": 1,
		"free":  2,
		"pro":   5,
		"vip":   10,
		"admin": -1,
	}
	sm := NewSessionManager(rdb, limits)

	userId := "config-test-user"

	for tier, expectedLimit := range limits {
		res, err := sm.RegisterSession(context.Background(), userId, tier, "session-"+tier)
		if err != nil {
			t.Errorf("tier %s: unexpected error: %v", tier, err)
			continue
		}
		if expectedLimit == -1 {
			if !res.Accepted {
				t.Errorf("tier %s: should be accepted (unlimited)", tier)
			}
		} else if expectedLimit == 0 {
			if res.Accepted {
				t.Errorf("tier %s: should be rejected (limit 0)", tier)
			}
		}
	}
}

func TestSessionLimits_DefaultFallback(t *testing.T) {
	rdb, _ := setupTestRedis(t)
	sm := NewSessionManager(rdb, nil)

	userId := "fallback-test-user"

	res, err := sm.RegisterSession(context.Background(), userId, "free", "session-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Accepted {
		t.Fatal("should be accepted with default limits")
	}

	count, _ := sm.CountSessions(context.Background(), userId)
	if count != 1 {
		t.Errorf("expected 1 session, got %d", count)
	}
}

func TestSessionLimits_UnknownTier_DefaultsTo1(t *testing.T) {
	rdb, _ := setupTestRedis(t)
	limits := map[string]int{"free": 3}
	sm := NewSessionManager(rdb, limits)

	userId := "unknown-tier-user"

	sm.RegisterSession(context.Background(), userId, "unknown", "s1")
	sm.RegisterSession(context.Background(), userId, "unknown", "s2")

	count, _ := sm.CountSessions(context.Background(), userId)
	if count != 1 {
		t.Errorf("unknown tier should default to limit 1, got %d sessions", count)
	}
}

func TestSessionLimits_ProUnlimited(t *testing.T) {
	rdb, _ := setupTestRedis(t)
	limits := map[string]int{"pro": -1}
	sm := NewSessionManager(rdb, limits)

	userId := "unlimited-user"

	for i := 0; i < 20; i++ {
		res, err := sm.RegisterSession(context.Background(), userId, "pro", "session-pro")
		if err != nil {
			t.Fatalf("unexpected error on iteration %d: %v", i, err)
		}
		if !res.Accepted {
			t.Fatalf("pro tier should accept all sessions (unlimited), failed at %d", i)
		}
	}

	count, _ := sm.CountSessions(context.Background(), userId)
	if count != 1 {
		t.Errorf("pro unlimited should keep 1 live session, got %d", count)
	}
}
