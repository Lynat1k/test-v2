package admin

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestGetMetrics_SQLiteSize(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	// Create a temp sqlite file to measure
	tmpDir := t.TempDir()
	sqlitePath := filepath.Join(tmpDir, "test.db")
	f, err := os.Create(sqlitePath)
	if err != nil {
		t.Fatal(err)
	}
	f.Write([]byte("some data for size test"))
	f.Close()

	t.Setenv("SQLITE_PATH", sqlitePath)

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	m, err := h.collectMetrics(context.Background())
	if err != nil {
		t.Fatalf("collectMetrics: %v", err)
	}
	if m.Database.SQLiteSizeBytes <= 0 {
		t.Errorf("expected sqliteSizeBytes > 0, got %d", m.Database.SQLiteSizeBytes)
	}
}

func TestGetMetrics_UserCount(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	m, err := h.collectMetrics(context.Background())
	if err != nil {
		t.Fatalf("collectMetrics: %v", err)
	}
	if m.Users.RegisteredCount < 0 {
		t.Errorf("expected registeredCount >= 0, got %d", m.Users.RegisteredCount)
	}
}

func TestGetMetrics_ClickHouseBytes(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	// chRepo is nil — should not panic, returns 0
	m, err := h.collectMetrics(context.Background())
	if err != nil {
		t.Fatalf("collectMetrics: %v", err)
	}
	if m.Database.ClickHouseBytes < 0 {
		t.Errorf("expected clickHouseBytes >= 0, got %d", m.Database.ClickHouseBytes)
	}
}

func TestGetMetrics_RAM(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	m, err := h.collectMetrics(context.Background())
	if err != nil {
		t.Fatalf("collectMetrics: %v", err)
	}
	if m.RAM.TotalGB <= 0 {
		t.Errorf("expected RAM totalGB > 0, got %f", m.RAM.TotalGB)
	}
	if m.RAM.UsedGB <= 0 {
		t.Errorf("expected RAM usedGB > 0, got %f", m.RAM.UsedGB)
	}
}

func TestGetMetrics_CPU(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	m, err := h.collectMetrics(context.Background())
	if err != nil {
		t.Fatalf("collectMetrics: %v", err)
	}
	if m.CPU.UsagePercent < 0 {
		t.Errorf("expected CPU usagePercent >= 0, got %f", m.CPU.UsagePercent)
	}
}

func TestGetMetrics_HTTP(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())

	req := httptest.NewRequest("GET", "/api/v1/admin/metrics", nil)
	w := httptest.NewRecorder()

	h.handleGetMetrics(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Error("expected non-empty response body")
	}
}

func TestLogBuffer_RingRetainsLast200(t *testing.T) {
	buf := NewLogBuffer(200)

	for i := 0; i < 250; i++ {
		_, err := buf.Write([]byte(fmt.Sprintf("line %d", i)))
		if err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	logs := buf.GetLogs()
	if len(logs) != 200 {
		t.Errorf("expected 200 lines, got %d", len(logs))
	}
	// First line should be line 50 (oldest retained)
	if logs[0] != "line 50" {
		t.Errorf("expected first line 'line 50', got %q", logs[0])
	}
	// Last line should be line 249
	if logs[199] != "line 249" {
		t.Errorf("expected last line 'line 249', got %q", logs[199])
	}
}

func TestLogBuffer_Concurrent(t *testing.T) {
	buf := NewLogBuffer(200)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				buf.Write([]byte(fmt.Sprintf("goroutine %d line %d", n, j)))
				buf.GetLogs()
			}
		}(i)
	}
	wg.Wait()

	logs := buf.GetLogs()
	if len(logs) > 200 {
		t.Errorf("expected at most 200 lines, got %d", len(logs))
	}
}
