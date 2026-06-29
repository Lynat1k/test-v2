package admin

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Имена таблиц ClickHouse для разбивки объёма БД по категориям.
const (
	tblClustersFutures    = "clusters_futures"
	tblClustersSpot       = "clusters_spot"
	tblBookDepthRatio     = "bookdepth_ratio"
	tblClustersFuturesDOM = "clusters_futures_dom"
	tblClustersSpotDOM    = "clusters_spot_dom"
	tblLongShortRatio     = "long_short_ratio"
	tblClusterCache       = "cluster_cache"
)

// DatabaseUsage — разбивка объёма хранилищ. Все размеры в байтах.
type DatabaseUsage struct {
	SQLiteSizeBytes int64 `json:"sqliteSizeBytes"`
	ClickHouseBytes int64 `json:"clickHouseBytes"` // суммарный размер БД ClickHouse
	ClustersBytes   int64 `json:"clustersBytes"`
	BookDepthBytes  int64 `json:"bookDepthBytes"`
	DOMBytes        int64 `json:"domBytes"`
	LongShortBytes  int64 `json:"longShortBytes"`
	CacheBytes      int64 `json:"cacheBytes"`
	OtherBytes      int64 `json:"otherBytes"`
	RedisBytes      int64 `json:"redisBytes"`
}

// handleDatabaseUsage считает разбивку объёма SQLite + ClickHouse + Redis ПО
// ЗАПРОСУ (подсчёт тяжёлый, поэтому это отдельный эндпоинт, а не часть metrics).
// Ошибки отдельных источников логируются и дают нули в своих полях — общий ответ
// не валится.
func (h *AdminHandler) handleDatabaseUsage(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var usage DatabaseUsage

	// SQLite — тот же путь/способ, что и в collectMetrics (metrics.go).
	sqlitePath := os.Getenv("SQLITE_PATH")
	if sqlitePath == "" {
		sqlitePath = "./data/procluster.db"
	}
	if info, err := os.Stat(sqlitePath); err == nil {
		usage.SQLiteSizeBytes = info.Size()
	}

	// ClickHouse — разбивка одним запросом. Ошибка → нули в CH-полях.
	if h.chRepo != nil {
		chDB := os.Getenv("CLICKHOUSE_DB")
		if chDB == "" {
			chDB = "default"
		}
		sizes, err := h.chRepo.GetTableSizes(ctx, chDB)
		if err != nil {
			log.Printf("[admin] database usage: clickhouse table sizes: %v", err)
		} else {
			var total int64
			for _, b := range sizes {
				total += b
			}
			usage.ClickHouseBytes = total
			usage.ClustersBytes = sizes[tblClustersFutures] + sizes[tblClustersSpot]
			usage.BookDepthBytes = sizes[tblBookDepthRatio]
			usage.DOMBytes = sizes[tblClustersFuturesDOM] + sizes[tblClustersSpotDOM]
			usage.LongShortBytes = sizes[tblLongShortRatio]
			usage.CacheBytes = sizes[tblClusterCache]

			other := total - (usage.ClustersBytes + usage.BookDepthBytes + usage.DOMBytes + usage.LongShortBytes + usage.CacheBytes)
			if other < 0 {
				other = 0
			}
			usage.OtherBytes = other
		}
	}

	// Redis — used_memory из INFO memory. nil/ошибка/не найдено → 0.
	usage.RedisBytes = h.getRedisMemory(ctx)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: usage})
}

// getRedisMemory возвращает used_memory (байт) из секции INFO memory. Если
// клиент не задан, запрос упал или поле не найдено — возвращает 0.
func (h *AdminHandler) getRedisMemory(ctx context.Context) int64 {
	if h.rdb == nil {
		return 0
	}
	info, err := h.rdb.Info(ctx, "memory").Result()
	if err != nil {
		log.Printf("[admin] database usage: redis info: %v", err)
		return 0
	}
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "used_memory:") {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, "used_memory:"))
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return 0
		}
		return n
	}
	return 0
}
