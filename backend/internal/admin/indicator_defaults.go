package admin

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/procluster/procluster/internal/auth"
)

const (
	maxAdminIndicatorsPerKey  = 50
	maxAdminIndicatorsBodyLen = 32 * 1024 // 32 KB JSON limit per indicators_json
	maxAdminIndicatorsRequest = 64 * 1024 // 64 KB hard ceiling on the whole request body
)

// GET /api/v1/admin/indicator-defaults?symbol=X
// Lists every (market, timeframe) admin default for the given symbol.
// Admin-only (RequireRole "admin").
func (h *AdminHandler) handleGetIndicatorDefaults(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "symbol is required")
		return
	}
	// Canonical: symbol upper.
	symbol = canonSymbol(symbol)

	rows, err := auth.ListAdminIndicatorDefaultsForSymbol(r.Context(), h.db, symbol)
	if err != nil {
		log.Printf("[admin] list indicator defaults: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to list indicator defaults")
		return
	}

	type respItem struct {
		Symbol     string      `json:"symbol"`
		Market     string      `json:"market"`
		Timeframe  string      `json:"timeframe"`
		Indicators interface{} `json:"indicators"`
		UpdatedBy  string      `json:"updatedBy"`
		UpdatedAt  string      `json:"updatedAt"`
	}

	result := make([]respItem, 0, len(rows))
	for _, row := range rows {
		var parsed interface{}
		if err := json.Unmarshal([]byte(row.IndicatorsJSON), &parsed); err != nil {
			parsed = []interface{}{}
		}
		result = append(result, respItem{
			Symbol:     row.Symbol,
			Market:     row.Market,
			Timeframe:  row.Timeframe,
			Indicators: parsed,
			UpdatedBy:  row.UpdatedBy,
			UpdatedAt:  row.UpdatedAt,
		})
	}

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: result})
}

// PUT /api/v1/admin/indicator-defaults
// Body: { symbol, market, timeframe, indicators: [...] }
// Always replace semantics (no merge-add for admin).
func (h *AdminHandler) handlePutIndicatorDefaults(w http.ResponseWriter, r *http.Request) {
	adminUserID, _ := r.Context().Value(auth.UserIDKey).(string)
	if adminUserID == "" {
		// Middleware should have rejected this, but guard anyway.
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing admin user")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAdminIndicatorsRequest)
	defer r.Body.Close()

	var body struct {
		Symbol     string          `json:"symbol"`
		Market     string          `json:"market"`
		Timeframe  string          `json:"timeframe"`
		Indicators json.RawMessage `json:"indicators"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	symbol, market, timeframe, errMsg := auth.NormalizeIndicatorKey(body.Symbol, body.Market, body.Timeframe)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", errMsg)
		return
	}

	if len(body.Indicators) == 0 || string(body.Indicators) == "null" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicators must be a JSON array")
		return
	}
	if len(body.Indicators) > maxAdminIndicatorsBodyLen {
		writeError(w, http.StatusBadRequest, "PAYLOAD_TOO_LARGE", "indicators payload too large (max 32KB)")
		return
	}

	var arr []map[string]interface{}
	if err := json.Unmarshal(body.Indicators, &arr); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicators must be a JSON array of objects")
		return
	}
	if len(arr) > maxAdminIndicatorsPerKey {
		writeError(w, http.StatusBadRequest, "TOO_MANY_INDICATORS", "too many indicators (max 50)")
		return
	}
	for _, it := range arr {
		id, ok := it["id"].(string)
		if !ok || id == "" {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "each indicator must have a non-empty string id")
			return
		}
	}

	if err := auth.UpsertAdminIndicatorDefault(r.Context(), h.db, adminUserID, symbol, market, timeframe, string(body.Indicators)); err != nil {
		log.Printf("[admin] upsert indicator defaults: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to save indicator defaults")
		return
	}

	writeJSON(w, http.StatusOK, adminResponse{OK: true})
	log.Printf("[admin] indicator default saved: by=%s symbol=%s market=%s tf=%s count=%d",
		adminUserID, symbol, market, timeframe, len(arr))
}

// DELETE /api/v1/admin/indicator-defaults?symbol=X&market=Y&timeframe=Z
func (h *AdminHandler) handleDeleteIndicatorDefaults(w http.ResponseWriter, r *http.Request) {
	symbol, market, timeframe, errMsg := auth.NormalizeIndicatorKey(
		r.URL.Query().Get("symbol"),
		r.URL.Query().Get("market"),
		r.URL.Query().Get("timeframe"),
	)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", errMsg)
		return
	}

	err := auth.DeleteAdminIndicatorDefault(r.Context(), h.db, symbol, market, timeframe)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "no admin indicator default for the given key")
		return
	}
	if err != nil {
		log.Printf("[admin] delete indicator defaults: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to delete indicator defaults")
		return
	}

	writeJSON(w, http.StatusOK, adminResponse{OK: true})
	log.Printf("[admin] indicator default deleted: symbol=%s market=%s tf=%s", symbol, market, timeframe)
}

// PATCH /api/v1/admin/indicator-defaults/indicator
// Body: { symbol, market, timeframe, indicator: {...} }
// Merge-upsert by indicator id. Existing array preserved bit-for-bit, the
// provided indicator replaces or appends its own id. Use this instead of PUT
// when adjusting a single indicator so sibling indicators on the same key are
// not wiped.
func (h *AdminHandler) handlePatchIndicatorDefaultIndicator(w http.ResponseWriter, r *http.Request) {
	adminUserID, _ := r.Context().Value(auth.UserIDKey).(string)
	if adminUserID == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing admin user")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAdminIndicatorsRequest)
	defer r.Body.Close()

	var body struct {
		Symbol    string          `json:"symbol"`
		Market    string          `json:"market"`
		Timeframe string          `json:"timeframe"`
		Indicator json.RawMessage `json:"indicator"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	symbol, market, timeframe, errMsg := auth.NormalizeIndicatorKey(body.Symbol, body.Market, body.Timeframe)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", errMsg)
		return
	}

	if len(body.Indicator) == 0 || string(body.Indicator) == "null" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicator must be a JSON object")
		return
	}
	if len(body.Indicator) > maxAdminIndicatorsBodyLen {
		writeError(w, http.StatusBadRequest, "PAYLOAD_TOO_LARGE", "indicator payload too large (max 32KB)")
		return
	}
	var probe map[string]interface{}
	if err := json.Unmarshal(body.Indicator, &probe); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicator must be a JSON object")
		return
	}
	id, _ := probe["id"].(string)
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicator must have a non-empty string id")
		return
	}

	if err := auth.UpsertSingleAdminIndicatorDefault(r.Context(), h.db, adminUserID, symbol, market, timeframe, body.Indicator); err != nil {
		log.Printf("[admin] upsert-single indicator default: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to save indicator default")
		return
	}

	writeJSON(w, http.StatusOK, adminResponse{OK: true})
	log.Printf("[admin] indicator default merged: by=%s symbol=%s market=%s tf=%s id=%s",
		adminUserID, symbol, market, timeframe, id)
}

// DELETE /api/v1/admin/indicator-defaults/indicator?symbol&market&timeframe&indicatorId
// Removes a single indicator from the admin defaults row for the key. If the
// row becomes empty the whole row is dropped.
func (h *AdminHandler) handleDeleteIndicatorDefaultIndicator(w http.ResponseWriter, r *http.Request) {
	symbol, market, timeframe, errMsg := auth.NormalizeIndicatorKey(
		r.URL.Query().Get("symbol"),
		r.URL.Query().Get("market"),
		r.URL.Query().Get("timeframe"),
	)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", errMsg)
		return
	}
	indicatorID := r.URL.Query().Get("indicatorId")
	if indicatorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicatorId is required")
		return
	}

	err := auth.DeleteSingleAdminIndicatorDefault(r.Context(), h.db, symbol, market, timeframe, indicatorID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "no admin default for the given indicator")
		return
	}
	if err != nil {
		log.Printf("[admin] delete-single indicator default: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to delete indicator default")
		return
	}

	writeJSON(w, http.StatusOK, adminResponse{OK: true})
	log.Printf("[admin] indicator default removed: symbol=%s market=%s tf=%s id=%s",
		symbol, market, timeframe, indicatorID)
}

// canonSymbol uppercases and trims whitespace. The full canonicalization is
// performed by auth.NormalizeIndicatorKey, but the GET endpoint only takes a
// symbol so we need a minimal helper here.
func canonSymbol(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == ' ' || c == '\t' {
			continue
		}
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		out = append(out, c)
	}
	return string(out)
}
