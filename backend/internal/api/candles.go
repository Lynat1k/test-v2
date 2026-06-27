package api

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/procluster/procluster/internal/auth"
	"github.com/procluster/procluster/internal/model"
)

// tfDurations maps a timeframe to its bucket length — used to decide whether a
// candle is already closed (and therefore safe to cache).
var tfDurations = map[string]time.Duration{
	"1m":  time.Minute,
	"5m":  5 * time.Minute,
	"15m": 15 * time.Minute,
	"30m": 30 * time.Minute,
	"1h":  time.Hour,
	"4h":  4 * time.Hour,
	"1d":  24 * time.Hour,
}

// candleClosed reports whether the candle opened at candleOpenMs has fully closed
// by now (candle_open + timeframe <= now). The current forming candle is never cached.
func candleClosed(timeframe string, candleOpenMs int64, now time.Time) bool {
	d, ok := tfDurations[timeframe]
	if !ok {
		return false
	}
	return !time.UnixMilli(candleOpenMs).Add(d).After(now)
}

type APIResponse struct {
	OK        bool        `json:"ok"`
	Data      interface{} `json:"data,omitempty"`
	*APIError `json:"error,omitempty"`
}

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type CandlesData struct {
	Candles []model.Candle `json:"candles"`
	HasMore bool           `json:"hasMore"`
}

var validTimeframes = map[string]bool{
	"1m":  true,
	"5m":  true,
	"15m": true,
	"30m": true,
	"1h":  true,
	"4h":  true,
	"1d":  true,
}

var validMarkets = map[string]bool{
	"futures": true,
	"spot":    true,
}

func (s *Server) handleCandles(w http.ResponseWriter, r *http.Request) {
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

	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		parsed, err := strconv.Atoi(l)
		if err != nil || parsed < 1 || parsed > 500 {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "limit must be 1-500")
			return
		}
		limit = parsed
	}

	var before *int64
	if b := r.URL.Query().Get("before"); b != "" {
		parsed, err := strconv.ParseInt(b, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "before must be unix毫秒 timestamp")
			return
		}
		before = &parsed
	}

	_, role, _ := auth.ExtractUserFromRequest(s.authCfg, r)
	if role == "" {
		role = "guest"
	}
	depth := s.resolveHistoryDepth(role)
	if depth >= 0 && before != nil {
		cutoff := time.Now().Add(-depth).UnixMilli()
		if *before < cutoff {
			*before = cutoff
		}
	}

	ctx := r.Context()

	var candles []model.Candle
	var hasMore bool

	if before == nil {
		cached, err := s.cache.GetCandles(ctx, symbol, timeframe, market, limit+1)
		if err == nil && len(cached) > 0 {
			if len(cached) > limit {
				candles = cached[:limit]
				hasMore = true
			} else {
				candles = cached
			}
		}

		if len(candles) < limit {
			needed := limit - len(candles)
			dbCandles, err := s.repo.GetLatestCandles(ctx, symbol, timeframe, market, needed, nil)
			if err == nil {
				for _, dc := range dbCandles {
					if len(candles) >= limit {
						hasMore = true
						break
					}
					duplicate := false
					for _, c := range candles {
						if c.CandleOpen.Equal(dc.CandleOpen) {
							duplicate = true
							break
						}
					}
					if !duplicate {
						candles = append(candles, dc)
					}
				}
			}
		}
	} else {
		dbCandles, err := s.repo.GetLatestCandles(ctx, symbol, timeframe, market, limit+1, before)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch candles")
			return
		}
		if len(dbCandles) > limit {
			hasMore = true
		}
		candles = dbCandles
		if len(candles) > limit {
			candles = candles[:limit]
		}
	}

	writeJSON(w, http.StatusOK, APIResponse{
		OK:   true,
		Data: CandlesData{Candles: candles, HasMore: hasMore},
	})
}

func (s *Server) handleClusters(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	if symbol == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "symbol is required")
		return
	}

	candleOpenStr := r.PathValue("candleOpen")
	candleOpen, err := strconv.ParseInt(candleOpenStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "candleOpen must be unix毫秒 timestamp")
		return
	}

	timeframe := strings.TrimSpace(r.URL.Query().Get("timeframe"))
	if timeframe == "" {
		timeframe = "1m"
	}
	if !validTimeframes[timeframe] {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "invalid timeframe")
		return
	}

	ctx := r.Context()

	clusters, err := s.repo.GetClusters(ctx, symbol, timeframe, candleOpen)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch clusters")
		return
	}

	writeJSON(w, http.StatusOK, APIResponse{
		OK:   true,
		Data: map[string]interface{}{"clusters": clusters},
	})
}

func (s *Server) handleClustersBatch(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
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
		market = "futures"
	}
	if !validMarkets[market] {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "market must be futures or spot")
		return
	}

	timeframe := strings.TrimSpace(r.URL.Query().Get("timeframe"))
	if timeframe == "" {
		timeframe = "1m"
	}
	if !validTimeframes[timeframe] {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "invalid timeframe")
		return
	}

	candleOpensStr := r.URL.Query().Get("candleOpens")
	if candleOpensStr == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "candleOpens is required (comma-separated unix毫秒 timestamps)")
		return
	}

	parts := strings.Split(candleOpensStr, ",")
	if len(parts) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "max 100 candleOpens per request")
		return
	}

	var candleOpens []int64
	for _, p := range parts {
		ts, err := strconv.ParseInt(strings.TrimSpace(p), 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "invalid candleOpen timestamp: "+p)
			return
		}
		candleOpens = append(candleOpens, ts)
	}

	// Parse priceStep for cluster aggregation (optional, 0 = no aggregation)
	priceStep := 0.0
	if psStr := r.URL.Query().Get("priceStep"); psStr != "" {
		if ps, err := strconv.ParseFloat(psStr, 64); err == nil && ps > 0 {
			priceStep = ps
		}
	}

	ctx := r.Context()

	// Cache is only valid for the admin-default priceStep of this symbol/market/tf.
	// Any other priceStep (or unknown ticker) bypasses the cache entirely — same
	// behaviour as before.
	defaultStep := s.defaultPriceStep(symbol, market, timeframe)
	cacheEligible := priceStep > 0 && defaultStep > 0 && math.Abs(priceStep-defaultStep) <= defaultStep*1e-6

	if !cacheEligible {
		clustersMap, err := s.repo.GetClustersBatch(ctx, symbol, timeframe, market, candleOpens, priceStep)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch clusters batch")
			return
		}
		writeJSON(w, http.StatusOK, APIResponse{
			OK:   true,
			Data: map[string]interface{}{"clusters": clustersMap},
		})
		return
	}

	// Read-through cache: serve closed candles from cluster_cache, compute the rest
	// from clusters_* and write the freshly-computed CLOSED candles back.
	result, err := s.repo.GetClustersBatchFromCache(ctx, symbol, market, timeframe, candleOpens, priceStep)
	if err != nil {
		log.Printf("[api] clusters-batch cache read failed (symbol=%s tf=%s): %v", symbol, timeframe, err)
		result = make(map[int64][]model.ClusterRow)
	}

	var missing []int64
	for _, ts := range candleOpens {
		if _, ok := result[ts]; !ok {
			missing = append(missing, ts)
		}
	}

	if len(missing) > 0 {
		fresh, err := s.repo.GetClustersBatch(ctx, symbol, timeframe, market, missing, priceStep)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch clusters batch")
			return
		}

		now := time.Now()
		toCache := make(map[int64][]model.ClusterRow)
		for _, ts := range missing {
			rows := fresh[ts]
			if len(rows) == 0 {
				continue // empty candles are never stored (cheap to recompute)
			}
			result[ts] = rows
			if candleClosed(timeframe, ts, now) {
				toCache[ts] = rows
			}
		}

		if len(toCache) > 0 {
			if err := s.repo.PutClustersBatchToCache(ctx, symbol, market, timeframe, priceStep, toCache); err != nil {
				log.Printf("[api] clusters-batch cache write failed (symbol=%s tf=%s): %v", symbol, timeframe, err)
			}
		}
	}

	writeJSON(w, http.StatusOK, APIResponse{
		OK:   true,
		Data: map[string]interface{}{"clusters": result},
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, APIResponse{
		OK: false,
		APIError: &APIError{
			Code:    code,
			Message: message,
		},
	})
}

// defaultPriceStep returns the admin-configured default priceStep for a
// symbol/market/timeframe: priceTick (from the active ticker) * default
// compression multiplier (from default_compressions). This equals the priceStep
// the frontend sends when the user sits at the admin-default compression level.
// Returns 0 when the ticker or the default compression is unknown — callers treat
// 0 as "not cache-eligible" and fall back to on-the-fly aggregation.
func (s *Server) defaultPriceStep(symbol, market, timeframe string) float64 {
	sym := strings.ToUpper(symbol)

	var tick float64
	s.tickersMu.RLock()
	for _, t := range s.activeTickers {
		if strings.ToUpper(t.Symbol) != sym {
			continue
		}
		if market == "spot" {
			tick = t.PriceTickSpot
		} else {
			tick = t.PriceTickFutures
		}
		break
	}
	s.tickersMu.RUnlock()
	if tick <= 0 {
		return 0
	}

	var mult int
	s.comprMu.RLock()
	for _, c := range s.activeCompressions[sym] {
		if c.Market == market && c.Timeframe == timeframe {
			mult = c.Multiplier
			break
		}
	}
	s.comprMu.RUnlock()
	if mult <= 0 {
		return 0
	}

	return tick * float64(mult)
}

func (s *Server) resolveHistoryDepth(role string) time.Duration {
	if s.tierHistoryLimits != nil {
		if d, ok := s.tierHistoryLimits[role]; ok {
			return d
		}
	}
	return maxDepthForRole(role, s.authCfg)
}

func maxDepthForRole(role string, cfg auth.AuthConfig) time.Duration {
	switch role {
	case "guest":
		return cfg.HistoryMaxGuest
	case "free":
		return cfg.HistoryMaxFree
	default:
		return -1
	}
}
