package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/procluster/procluster/internal/auth"
	"github.com/procluster/procluster/internal/model"
)

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

// TODO(phase12-billing): enforce chart compression gating on backend once frontend
// passes a `compression` query param. Currently compression is client-side only
// (DataStore.compressLevels), so gating is enforced on the frontend via
// chartCompressionLocked flag from tier_policies. See ADR phase12 step 2.3.

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

	role, _, _ := auth.ExtractUserFromRequest(s.authCfg, r)
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

	ctx := r.Context()

	clustersMap, err := s.repo.GetClustersBatch(ctx, symbol, timeframe, candleOpens)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch clusters batch")
		return
	}

	writeJSON(w, http.StatusOK, APIResponse{
		OK:   true,
		Data: map[string]interface{}{"clusters": clustersMap},
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
