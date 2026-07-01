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

// OpenInterestPoint — одна точка индикатора Open Interest на бакет свечи. OHLC
// собирается из 5-мин точек sum_open_interest (контракты) внутри бакета: o —
// первое значение, h — максимум, l — минимум, c — последнее. OI это уровень, не
// аддитивная величина — значения НЕ суммируются.
type OpenInterestPoint struct {
	T int64   `json:"t"` // candle_open, unix ms
	O float64 `json:"o"`
	H float64 `json:"h"`
	L float64 `json:"l"`
	C float64 `json:"c"`
}

// handleOpenInterest: GET /api/v1/open-interest?symbol&market=futures&timeframe&from&to
// Читает 5-мин точки открытого интереса за период, группирует по бакету
// запрошенного таймфрейма и собирает OHLC по sum_open_interest. from обрезается
// по тарифу пользователя (как в /api/v1/candles и /api/v1/long-short-ratio).
func (s *Server) handleOpenInterest(w http.ResponseWriter, r *http.Request) {
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

	// Лимит истории по тарифу — та же логика, что в handleCandles/handleLongShortRatio.
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
		writeJSON(w, http.StatusOK, []OpenInterestPoint{})
		return
	}

	ctx := r.Context()
	rows, err := s.repo.GetOpenInterest(ctx, symbol, market, time.UnixMilli(from), time.UnixMilli(to))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch open interest")
		return
	}

	// Один бакет свечи может накрывать несколько 5-мин точек. OI это уровень —
	// собираем OHLC по sum_open_interest. Точки приходят отсортированные по ts ASC,
	// поэтому o фиксируем при первой точке бакета, c перезаписываем каждой.
	type ohlc struct {
		o, h, l, c float64
	}
	buckets := make(map[int64]*ohlc)
	for _, row := range rows {
		bucketOpen := aggregation.AlignToTimeframe(row.TS, timeframe).UnixMilli()
		v := row.SumOpenInterest
		b, ok := buckets[bucketOpen]
		if !ok {
			buckets[bucketOpen] = &ohlc{o: v, h: v, l: v, c: v}
			continue
		}
		if v > b.h {
			b.h = v
		}
		if v < b.l {
			b.l = v
		}
		b.c = v
	}

	points := make([]OpenInterestPoint, 0, len(buckets))
	for t, b := range buckets {
		points = append(points, OpenInterestPoint{T: t, O: b.o, H: b.h, L: b.l, C: b.c})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].T < points[j].T })

	writeJSON(w, http.StatusOK, points)
}
