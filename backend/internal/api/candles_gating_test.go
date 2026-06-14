package api

import (
	"testing"
	"time"

	"github.com/procluster/procluster/internal/auth"
)

func TestMaxDepthForRole_Guest(t *testing.T) {
	cfg := auth.AuthConfig{
		HistoryMaxGuest: 7 * 24 * time.Hour,
		HistoryMaxFree:  180 * 24 * time.Hour,
	}
	got := maxDepthForRole("guest", cfg)
	if got != 7*24*time.Hour {
		t.Errorf("maxDepthForRole(guest) = %v, want %v", got, 7*24*time.Hour)
	}
}

func TestMaxDepthForRole_Free(t *testing.T) {
	cfg := auth.AuthConfig{
		HistoryMaxGuest: 7 * 24 * time.Hour,
		HistoryMaxFree:  180 * 24 * time.Hour,
	}
	got := maxDepthForRole("free", cfg)
	if got != 180*24*time.Hour {
		t.Errorf("maxDepthForRole(free) = %v, want %v", got, 180*24*time.Hour)
	}
}

func TestMaxDepthForRole_Pro(t *testing.T) {
	cfg := auth.AuthConfig{}
	got := maxDepthForRole("pro", cfg)
	if got != -1 {
		t.Errorf("maxDepthForRole(pro) = %v, want -1", got)
	}
}

func TestMaxDepthForRole_VIP(t *testing.T) {
	cfg := auth.AuthConfig{}
	got := maxDepthForRole("vip", cfg)
	if got != -1 {
		t.Errorf("maxDepthForRole(vip) = %v, want -1", got)
	}
}

func TestMaxDepthForRole_Admin(t *testing.T) {
	cfg := auth.AuthConfig{}
	got := maxDepthForRole("admin", cfg)
	if got != -1 {
		t.Errorf("maxDepthForRole(admin) = %v, want -1", got)
	}
}

func TestMaxDepthForRole_Empty(t *testing.T) {
	cfg := auth.AuthConfig{
		HistoryMaxGuest: 7 * 24 * time.Hour,
	}
	got := maxDepthForRole("", cfg)
	if got != -1 {
		t.Errorf("maxDepthForRole(empty) = %v, want -1", got)
	}
}

func TestCutoffCalculation_Guest(t *testing.T) {
	depth := 7 * 24 * time.Hour
	now := time.Now()
	cutoff := now.Add(-depth).UnixMilli()

	sevenDaysAgo := now.Add(-7 * 24 * time.Hour).UnixMilli()
	if cutoff != sevenDaysAgo {
		t.Errorf("cutoff mismatch: got %d, want %d", cutoff, sevenDaysAgo)
	}
}

func TestCutoffCalculation_Free(t *testing.T) {
	depth := 180 * 24 * time.Hour
	now := time.Now()
	cutoff := now.Add(-depth).UnixMilli()

	daysAgo := now.Add(-180 * 24 * time.Hour).UnixMilli()
	if cutoff != daysAgo {
		t.Errorf("cutoff mismatch: got %d, want %d", cutoff, daysAgo)
	}
}
