package api

import "net/http"

// tickerInfo contains only the fields the frontend needs for DOM compression.
// Do NOT expose internal ids, flags or admin-only fields.
type tickerInfo struct {
	Symbol             string  `json:"symbol"`
	Name               string  `json:"name"`
	FuturePriceTick    float64 `json:"futurePriceTick"`
	SpotPriceTick      float64 `json:"spotPriceTick"`
	CompressionFutures int     `json:"compressionFutures"`
	CompressionSpot    int     `json:"compressionSpot"`
}

// handleGetTickers returns active tickers with their price-tick and base-compression
// parameters. Public endpoint — no auth required.
// GET /api/v1/tickers
func (s *Server) handleGetTickers(w http.ResponseWriter, r *http.Request) {
	s.tickersMu.RLock()
	out := make([]tickerInfo, 0, len(s.activeTickers))
	for _, t := range s.activeTickers {
		if !t.IsActive {
			continue
		}
		out = append(out, tickerInfo{
			Symbol:             t.Symbol,
			Name:               t.Name,
			FuturePriceTick:    t.PriceTickFutures,
			SpotPriceTick:      t.PriceTickSpot,
			CompressionFutures: t.CompressionFutures,
			CompressionSpot:    t.CompressionSpot,
		})
	}
	s.tickersMu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": out})
}
