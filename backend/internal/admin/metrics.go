package admin

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
)

type MetricsResponse struct {
	CPU struct {
		UsagePercent float64 `json:"usagePercent"`
	} `json:"cpu"`
	RAM struct {
		UsedGB  float64 `json:"usedGB"`
		TotalGB float64 `json:"totalGB"`
		Percent float64 `json:"percent"`
	} `json:"ram"`
	Disk struct {
		UsagePercent float64 `json:"usagePercent"`
		UsedGB       float64 `json:"usedGB"`
		TotalGB      float64 `json:"totalGB"`
	} `json:"disk"`
	Database struct {
		SQLiteSizeBytes int64 `json:"sqliteSizeBytes"`
		ClickHouseBytes int64 `json:"clickHouseBytes"`
	} `json:"database"`
	Users struct {
		RegisteredCount int64 `json:"registeredCount"`
		OnlineCount     int64 `json:"onlineCount"`
	} `json:"users"`
	Logs      []string `json:"logs"`
	Timestamp string   `json:"timestamp"`
}

func (h *AdminHandler) handleGetMetrics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	m, err := h.collectMetrics(ctx)
	if err != nil {
		log.Printf("[admin] metrics error: %v", err)
		writeError(w, http.StatusInternalServerError, "METRICS_ERROR", "failed to collect metrics")
		return
	}
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: m})
}

func (h *AdminHandler) collectMetrics(ctx context.Context) (*MetricsResponse, error) {
	m := &MetricsResponse{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	// CPU
	if percents, err := cpu.Percent(500*time.Millisecond, false); err == nil && len(percents) > 0 {
		m.CPU.UsagePercent = percents[0]
	}

	// RAM
	if v, err := mem.VirtualMemory(); err == nil {
		m.RAM.UsedGB = float64(v.Used) / (1024 * 1024 * 1024)
		m.RAM.TotalGB = float64(v.Total) / (1024 * 1024 * 1024)
		m.RAM.Percent = v.UsedPercent
	}

	// Disk (based on SQLite data dir)
	sqlitePath := os.Getenv("SQLITE_PATH")
	if sqlitePath == "" {
		sqlitePath = "./data/procluster.db"
	}
	dataDir := filepath.Dir(sqlitePath)
	if usage, err := disk.Usage(dataDir); err == nil {
		m.Disk.UsagePercent = usage.UsedPercent
		m.Disk.UsedGB = float64(usage.Used) / (1024 * 1024 * 1024)
		m.Disk.TotalGB = float64(usage.Total) / (1024 * 1024 * 1024)
	}

	// SQLite size
	if info, err := os.Stat(sqlitePath); err == nil {
		m.Database.SQLiteSizeBytes = info.Size()
	}

	// ClickHouse size
	if chSize, err := h.getClickHouseSize(ctx); err == nil {
		m.Database.ClickHouseBytes = chSize
	} else {
		h.chSizeErrMu.Lock()
		now := time.Now()
		if err.Error() != h.chSizeLastErr || now.Sub(h.chSizeLastTime) > time.Minute {
			log.Printf("[admin] clickhouse size error: %v", err)
			h.chSizeLastErr = err.Error()
			h.chSizeLastTime = now
		}
		h.chSizeErrMu.Unlock()
	}

	// Registered users
	if count, err := h.getRegisteredCount(ctx); err == nil {
		m.Users.RegisteredCount = count
	} else {
		log.Printf("[admin] user count error: %v", err)
	}

	// Online users via SCAN
	if count, err := h.getOnlineCount(ctx); err == nil {
		m.Users.OnlineCount = count
	} else {
		log.Printf("[admin] online count error: %v", err)
	}

	// Logs from ring buffer
	if h.logBuf != nil {
		m.Logs = h.logBuf.GetLogs()
	}

	return m, nil
}

func (h *AdminHandler) getClickHouseSize(ctx context.Context) (int64, error) {
	if h.chRepo == nil {
		return 0, nil
	}
	chDB := os.Getenv("CLICKHOUSE_DB")
	if chDB == "" {
		chDB = "default"
	}
	query := "SELECT COALESCE(sum(bytes_on_disk), 0) FROM system.parts WHERE database = ?"
	var size uint64
	err := h.chRepo.QueryRow(ctx, query, chDB).Scan(&size)
	if err != nil {
		return 0, fmt.Errorf("clickhouse size: %w", err)
	}
	return int64(size), nil
}

func (h *AdminHandler) getRegisteredCount(ctx context.Context) (int64, error) {
	var count int64
	err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("user count: %w", err)
	}
	return count, nil
}

func (h *AdminHandler) getOnlineCount(ctx context.Context) (int64, error) {
	if h.rdb == nil {
		return 0, nil
	}
	var count int64
	var cursor uint64
	for {
		keys, nextCursor, err := h.rdb.Scan(ctx, cursor, "chart_sessions:*", 100).Result()
		if err != nil {
			return 0, fmt.Errorf("scan sessions: %w", err)
		}
		count += int64(len(keys))
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	return count, nil
}
