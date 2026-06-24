package api

import (
	"net/http"
	"strings"
)

type publicCompressionEntry struct {
	Market     string `json:"market"`
	Timeframe  string `json:"timeframe"`
	Multiplier int    `json:"multiplier"`
}

// handleGetPublicCompressions returns admin-configured default chart compressions for a symbol.
// Public endpoint — no auth required.
// GET /api/v1/compressions?symbol=BTCUSDT
func (s *Server) handleGetPublicCompressions(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		writeError(w, http.StatusBadRequest, "MISSING_SYMBOL", "symbol query parameter is required")
		return
	}

	entries := s.activeCompressions[symbol]
	out := make([]publicCompressionEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, publicCompressionEntry{
			Market:     e.Market,
			Timeframe:  e.Timeframe,
			Multiplier: e.Multiplier,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": out})
}
