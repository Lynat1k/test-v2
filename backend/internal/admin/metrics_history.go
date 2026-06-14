package admin

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
)

const (
	metricsHistoryCap     = 1440 // 24h * 60min
	metricsSampleInterval = 60 * time.Second
)

type MetricsPoint struct {
	Timestamp   string  `json:"timestamp"`
	CPUPercent  float64 `json:"cpuPercent"`
	RAMPercent  float64 `json:"ramPercent"`
	RAMUsedGB   float64 `json:"ramUsedGB"`
	DiskPercent float64 `json:"diskPercent"`
	DiskUsedGB  float64 `json:"diskUsedGB"`
}

type MetricsHistory struct {
	mu     sync.RWMutex
	points []MetricsPoint
	cap    int
}

func NewMetricsHistory() *MetricsHistory {
	return &MetricsHistory{
		points: make([]MetricsPoint, 0, metricsHistoryCap),
		cap:    metricsHistoryCap,
	}
}

func (h *MetricsHistory) Append(p MetricsPoint) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.points) >= h.cap {
		copy(h.points, h.points[1:])
		h.points[len(h.points)-1] = p
	} else {
		h.points = append(h.points, p)
	}
}

func (h *MetricsHistory) GetAll() []MetricsPoint {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]MetricsPoint, len(h.points))
	copy(out, h.points)
	return out
}

func sampleOnce() MetricsPoint {
	p := MetricsPoint{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if percents, err := cpu.Percent(500*time.Millisecond, false); err == nil && len(percents) > 0 {
		p.CPUPercent = percents[0]
	}

	if v, err := mem.VirtualMemory(); err == nil {
		p.RAMPercent = v.UsedPercent
		p.RAMUsedGB = float64(v.Used) / (1024 * 1024 * 1024)
	}

	sqlitePath := os.Getenv("SQLITE_PATH")
	if sqlitePath == "" {
		sqlitePath = "./data/procluster.db"
	}
	dataDir := filepath.Dir(sqlitePath)
	if usage, err := disk.Usage(dataDir); err == nil {
		p.DiskPercent = usage.UsedPercent
		p.DiskUsedGB = float64(usage.Used) / (1024 * 1024 * 1024)
	}

	return p
}

func (h *MetricsHistory) StartSampler(ctx context.Context) {
	go func() {
		log.Println("[admin] metrics history sampler started")
		// Take first sample immediately
		h.Append(sampleOnce())
		ticker := time.NewTicker(metricsSampleInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Println("[admin] metrics history sampler stopped")
				return
			case <-ticker.C:
				h.Append(sampleOnce())
			}
		}
	}()
}

func (h *AdminHandler) handleGetMetricsHistory(w http.ResponseWriter, r *http.Request) {
	if h.metricsHist == nil {
		writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: []MetricsPoint{}})
		return
	}
	points := h.metricsHist.GetAll()
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: points})
}
