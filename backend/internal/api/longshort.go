package api

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/auth"
)

// LongShortRatioPoint — одна точка индикатора Long/Short Account Ratio на бакет
// свечи. ratio = число аккаунтов в long / число в short. Мгновенная величина
// (не аддитивна): long% = ratio/(ratio+1)*100.
type LongShortRatioPoint struct {
	T     int64   `json:"t"` // candle_open, unix ms
	Ratio float64 `json:"ratio"`
}

// handleLongShortRatio: GET /api/v1/long-short-ratio?symbol&market=futures&timeframe&from&to
// Читает 5-мин точки long/short ratio за период, группирует по бакету
// запрошенного таймфрейма и берёт ПОСЛЕДНЕЕ значение в бакете (по максимальному
// ts) — ratio мгновенный, не суммируется. from обрезается по тарифу пользователя
// (как в /api/v1/candles и /api/v1/bookdepth-ratio).
func (s *Server) handleLongShortRatio(w http.ResponseWriter, r *http.Request) {
	symbol := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if symbol == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "symbol is required")
		return
	}
	if len(symbol) > 20 {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "symbol too long (max 20)")
		return
	}

	market := strings.TrimSpace(r.URL.Query().Get("market"))
	if market == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "market is required")
		return
	}
	if !validMarkets[market] {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "market must be futures or spot")
		return
	}

	timeframe := strings.TrimSpace(r.URL.Query().Get("timeframe"))
	if timeframe == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "timeframe is required")
		return
	}
	if !validTimeframes[timeframe] {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "invalid timeframe")
		return
	}

	from, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("from")), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "from must be unix ms timestamp")
		return
	}
	to, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("to")), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "to must be unix ms timestamp")
		return
	}
	if from >= to {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "from must be before to")
		return
	}

	// Лимит истории по тарифу — та же логика, что в handleCandles/handleBookDepthRatio.
	_, role, _ := auth.ExtractUserFromRequest(s.authCfg, r)
	if role == "" {
		role = "guest"
	}
	depth := s.resolveHistoryDepth(role)
	if depth >= 0 {
		cutoff := time.Now().Add(-depth).UnixMilli()
		if from < cutoff {
			from = cutoff
		}
	}
	if from >= to {
		writeJSON(w, http.StatusOK, []LongShortRatioPoint{})
		return
	}

	ctx := r.Context()
	rows, err := s.repo.GetLongShortRatio(ctx, symbol, market, time.UnixMilli(from), time.UnixMilli(to))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch long/short ratio")
		return
	}

	// Один бакет свечи может накрывать несколько 5-мин точек. ratio мгновенный —
	// берём значение с максимальным ts внутри бакета.
	type lastVal struct {
		ts    time.Time
		ratio float64
	}
	buckets := make(map[int64]lastVal)
	for _, row := range rows {
		bucketOpen := aggregation.AlignToTimeframe(row.TS, timeframe).UnixMilli()
		if cur, ok := buckets[bucketOpen]; !ok || row.TS.After(cur.ts) {
			buckets[bucketOpen] = lastVal{ts: row.TS, ratio: row.Ratio}
		}
	}

	points := make([]LongShortRatioPoint, 0, len(buckets))
	for t, v := range buckets {
		points = append(points, LongShortRatioPoint{T: t, Ratio: v.ratio})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].T < points[j].T })

	writeJSON(w, http.StatusOK, points)
}
