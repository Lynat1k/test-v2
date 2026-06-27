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

// BookDepthRatioPoint — одна точка индикатора Bid & Ask Ratio на бакет свечи.
// r1/r3/r5 = (bid − ask) / (bid + ask) суммарной глубины стакана в ±1/3/5%.
type BookDepthRatioPoint struct {
	T  int64   `json:"t"`  // candle_open, unix ms
	R1 float64 `json:"r1"`
	R3 float64 `json:"r3"`
	R5 float64 `json:"r5"`
}

// ratioBucket копит суммы глубины по диапазонам внутри одного бакета свечи.
type ratioBucket struct {
	bid1, ask1 float64
	bid3, ask3 float64
	bid5, ask5 float64
}

func safeRatio(bid, ask float64) float64 {
	denom := bid + ask
	if denom == 0 {
		return 0
	}
	return (bid - ask) / denom
}

// handleBookDepthRatio: GET /api/v1/bookdepth-ratio?symbol&market=futures&timeframe&from&to
// Читает минутные снапшоты глубины за период, группирует по бакету запрошенного
// таймфрейма, суммирует объёмы по каждому диапазону и считает ratio. from
// обрезается по тарифу пользователя (как в /api/v1/candles).
func (s *Server) handleBookDepthRatio(w http.ResponseWriter, r *http.Request) {
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

	// Лимит истории по тарифу — та же логика, что в handleCandles.
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
		writeJSON(w, http.StatusOK, []BookDepthRatioPoint{})
		return
	}

	ctx := r.Context()
	rows, err := s.repo.GetBookDepthRatio(ctx, symbol, market, time.UnixMilli(from), time.UnixMilli(to))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch bookdepth ratio")
		return
	}

	buckets := make(map[int64]*ratioBucket)
	for _, row := range rows {
		bucketOpen := aggregation.AlignToTimeframe(row.SnapshotTS, timeframe).UnixMilli()
		b, ok := buckets[bucketOpen]
		if !ok {
			b = &ratioBucket{}
			buckets[bucketOpen] = b
		}
		b.bid1 += row.Bid1
		b.ask1 += row.Ask1
		b.bid3 += row.Bid3
		b.ask3 += row.Ask3
		b.bid5 += row.Bid5
		b.ask5 += row.Ask5
	}

	points := make([]BookDepthRatioPoint, 0, len(buckets))
	for t, b := range buckets {
		points = append(points, BookDepthRatioPoint{
			T:  t,
			R1: safeRatio(b.bid1, b.ask1),
			R3: safeRatio(b.bid3, b.ask3),
			R5: safeRatio(b.bid5, b.ask5),
		})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].T < points[j].T })

	writeJSON(w, http.StatusOK, points)
}
