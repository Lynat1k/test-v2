package auth

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
)

// Canonical timeframe sets per market — must mirror frontend
// TIMEFRAMES_BY_MARKET in ChartControlsContext.tsx so the two ends of the wire
// validate identically.
var validTimeframesByMarket = map[string]map[string]bool{
	"futures": {"1m": true, "5m": true, "15m": true, "30m": true, "1h": true, "4h": true},
	"spot":    {"15m": true, "30m": true, "1h": true, "4h": true},
}

const (
	maxIndicatorsPerKey  = 50
	maxIndicatorsBodyLen = 32 * 1024 // 32 KB JSON limit per indicators_json
	maxIndicatorsRequest = 64 * 1024 // 64 KB hard ceiling on the whole request body
)

// applyVisibleCap walks arr in order and forces isVisible=false on every
// active indicator past the tier's per-user max. Mutates arr in place.
// Returns the number of items trimmed. max < 0 disables the cap.
//
// "Visibility" semantics mirror the frontend (storage.ts computeActiveIndicators):
// chart renders an indicator iff isActive && isVisible !== false. We only
// touch isVisible — isActive is left alone so users keep their list intact
// and can delete the hidden ones manually after a downgrade.
func applyVisibleCap(arr []map[string]interface{}, max int) int {
	if max < 0 {
		return 0
	}
	visible := 0
	trimmed := 0
	for _, it := range arr {
		active, _ := it["isActive"].(bool)
		if !active {
			continue
		}
		isVisible := true
		if v, ok := it["isVisible"].(bool); ok {
			isVisible = v
		}
		if !isVisible {
			continue
		}
		if visible >= max {
			it["isVisible"] = false
			trimmed++
		} else {
			visible++
		}
	}
	return trimmed
}

// getMaxIndicatorsForRole reads tier_policies.max_indicators for the role.
// Returns -1 (no cap) for unknown roles or query failures — the global
// maxIndicatorsPerKey ceiling still applies as a hard DoS guard. Values >= 100
// are treated as unlimited, matching the frontend convention.
func (h *Handler) getMaxIndicatorsForRole(role string) int {
	if role == "" {
		role = "guest"
	}
	var maxN int
	err := h.db.QueryRow(
		`SELECT max_indicators FROM tier_policies WHERE tier = ?`,
		strings.ToLower(role),
	).Scan(&maxN)
	if err == sql.ErrNoRows {
		return -1
	}
	if err != nil {
		log.Printf("[auth] visible cap: query for %s: %v", role, err)
		return -1
	}
	if maxN >= 100 {
		return -1
	}
	return maxN
}

// NormalizeIndicatorKey enforces the canonical case (symbol upper, market/tf
// lower) and validates against the allow-list. timeframe='*' is accepted as
// the all-tf marker. Returns the normalized triple and an error string
// suitable for the INVALID_PARAMS response (empty string on success).
//
// Exported so the admin package can reuse the same validation logic for
// admin_indicator_defaults endpoints.
func NormalizeIndicatorKey(symbol, market, timeframe string) (string, string, string, string) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	market = strings.ToLower(strings.TrimSpace(market))
	timeframe = strings.ToLower(strings.TrimSpace(timeframe))

	if symbol == "" {
		return "", "", "", "symbol is required"
	}
	allowedTfs, ok := validTimeframesByMarket[market]
	if !ok {
		return "", "", "", "market must be 'spot' or 'futures'"
	}
	if timeframe != AllTimeframeMarker && !allowedTfs[timeframe] {
		return "", "", "", "invalid timeframe for the given market"
	}
	return symbol, market, timeframe, ""
}

// GET /api/v1/user/indicators?symbol=X&market=Y&timeframe=Z
// Auth-optional. Guest sees only admin-* / system tiers; authed user gets the
// full cascade (user-tf → user-all-tf → admin-tf → admin-all-tf → system).
func (h *Handler) handleGetUserIndicators(w http.ResponseWriter, r *http.Request) {
	symbol, market, timeframe, errMsg := NormalizeIndicatorKey(
		r.URL.Query().Get("symbol"),
		r.URL.Query().Get("market"),
		r.URL.Query().Get("timeframe"),
	)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", errMsg)
		return
	}

	userID, role, _ := ExtractUserFromRequest(h.cfg, r)
	// userID is "" for guest — ResolveIndicators handles that explicitly.

	jsonStr, source, err := ResolveIndicators(r.Context(), h.db, userID, symbol, market, timeframe)
	if err != nil {
		log.Printf("[auth] resolve indicators: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to resolve indicators")
		return
	}

	// Parse as a typed array of objects so we can apply the per-tier visible
	// cap. Falls back to an empty array on corrupt rows so the UI keeps
	// working. The cap is enforced on read to repair any dirty state saved
	// before the cap landed (e.g. a freshly downgraded user whose previous-tier
	// state still has too many visible indicators).
	var arr []map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &arr); err != nil {
		log.Printf("[auth] resolve indicators: corrupt json for %s/%s/%s: %v", symbol, market, timeframe, err)
		arr = nil
	}
	if trimmed := applyVisibleCap(arr, h.getMaxIndicatorsForRole(role)); trimmed > 0 {
		log.Printf("[auth] visible cap on read: user=%s role=%s key=%s/%s/%s trimmed=%d",
			userID, role, symbol, market, timeframe, trimmed)
	}
	var parsed interface{} = arr
	if arr == nil {
		parsed = []interface{}{}
	}

	// Surface the admin-default rows for this key alongside the resolved view.
	// adminDefaultsTf and adminDefaultsAllTf let the modal show a virtual "admin
	// default" preset row + drive the admin-only "Дефолт" toggle without an
	// extra round-trip. Failures here MUST NOT break the main response — empty
	// arrays are a fine degraded state.
	adminTfJSON, _, errTf := GetAdminIndicatorDefault(r.Context(), h.db, symbol, market, timeframe)
	if errTf != nil {
		log.Printf("[auth] resolve indicators: read admin-tf default %s/%s/%s: %v", symbol, market, timeframe, errTf)
	}
	adminAllTfJSON, _, errAll := GetAdminIndicatorDefault(r.Context(), h.db, symbol, market, AllTimeframeMarker)
	if errAll != nil {
		log.Printf("[auth] resolve indicators: read admin-all-tf default %s/%s: %v", symbol, market, errAll)
	}

	var adminTf interface{} = []interface{}{}
	if adminTfJSON != "" {
		if err := json.Unmarshal([]byte(adminTfJSON), &adminTf); err != nil {
			log.Printf("[auth] resolve indicators: corrupt admin-tf json for %s/%s/%s: %v", symbol, market, timeframe, err)
			adminTf = []interface{}{}
		}
	}
	var adminAllTf interface{} = []interface{}{}
	if adminAllTfJSON != "" {
		if err := json.Unmarshal([]byte(adminAllTfJSON), &adminAllTf); err != nil {
			log.Printf("[auth] resolve indicators: corrupt admin-all-tf json for %s/%s: %v", symbol, market, err)
			adminAllTf = []interface{}{}
		}
	}

	writeJSON(w, http.StatusOK, authResponse{
		OK: true,
		Data: map[string]interface{}{
			"indicators":         parsed,
			"source":             string(source),
			"adminDefaultsTf":    adminTf,
			"adminDefaultsAllTf": adminAllTf,
		},
	})
}

// PUT /api/v1/user/indicators
// Body (mode=replace|merge-add): { symbol, market, timeframe, indicators: [...], mode? }
// Body (mode=propagate):         { symbol, market, mode:"propagate", indicator: {...} }
// Requires auth. For replace/merge-add, timeframe may be a concrete value or
// "*" for the scope=all-tf row. For propagate, timeframe is implied — the
// operation rewrites the '*' row and every existing per-tf row at once.
func (h *Handler) handlePutUserIndicators(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	r.Body = http.MaxBytesReader(w, r.Body, maxIndicatorsRequest)
	defer r.Body.Close()

	var body struct {
		Symbol     string          `json:"symbol"`
		Market     string          `json:"market"`
		Timeframe  string          `json:"timeframe"`
		Indicators json.RawMessage `json:"indicators"`
		Indicator  json.RawMessage `json:"indicator"`
		Mode       string          `json:"mode"`
		Intent     string          `json:"intent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	mode := body.Mode
	if mode == "" {
		mode = "replace"
	}

	// Intent is orthogonal to mode: explicit signal whether the request modifies
	// per-indicator settings ("settings_changed") or only the add/remove/visibility
	// shape of the list ("add_only"). Missing intent defaults to settings_changed
	// (safer fallback for legacy clients). propagate always implies settings change.
	intent := strings.ToLower(strings.TrimSpace(body.Intent))
	if intent == "" {
		intent = "settings_changed"
	}
	if mode == "propagate" {
		intent = "settings_changed"
	}
	if intent != "add_only" && intent != "settings_changed" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "intent must be 'add_only' or 'settings_changed'")
		return
	}
	if intent == "settings_changed" && !h.requireCustomIndicatorSettings(w, r) {
		return
	}

	// For propagate the timeframe is not part of the wire — operation is
	// cross-tf by definition. Pass '*' to NormalizeIndicatorKey so the
	// symbol/market path stays identical.
	tfForNormalize := body.Timeframe
	if mode == "propagate" {
		tfForNormalize = AllTimeframeMarker
	}

	symbol, market, timeframe, errMsg := NormalizeIndicatorKey(body.Symbol, body.Market, tfForNormalize)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", errMsg)
		return
	}

	switch mode {
	case "propagate":
		if len(body.Indicator) == 0 || string(body.Indicator) == "null" {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicator must be a JSON object")
			return
		}
		if len(body.Indicator) > maxIndicatorsBodyLen {
			writeError(w, http.StatusBadRequest, "PAYLOAD_TOO_LARGE", "indicator payload too large (max 32KB)")
			return
		}
		var one map[string]interface{}
		if err := json.Unmarshal(body.Indicator, &one); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicator must be a JSON object")
			return
		}
		id, _ := one["id"].(string)
		if id == "" {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicator must have a non-empty string id")
			return
		}
		if err := PropagateUserIndicator(r.Context(), h.db, userID, symbol, market, body.Indicator); err != nil {
			log.Printf("[auth] propagate user_indicators: %v", err)
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to propagate indicator")
			return
		}
		writeJSON(w, http.StatusOK, authResponse{OK: true})
		log.Printf("[auth] user_indicators propagated: user=%s symbol=%s market=%s id=%s",
			userID, symbol, market, id)
		return

	case "replace", "merge-add":
		if len(body.Indicators) == 0 || string(body.Indicators) == "null" {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicators must be a JSON array")
			return
		}
		if len(body.Indicators) > maxIndicatorsBodyLen {
			writeError(w, http.StatusBadRequest, "PAYLOAD_TOO_LARGE", "indicators payload too large (max 32KB)")
			return
		}
		var arr []map[string]interface{}
		if err := json.Unmarshal(body.Indicators, &arr); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "indicators must be a JSON array of objects")
			return
		}
		if len(arr) > maxIndicatorsPerKey {
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

		// Enforce per-tier visible cap silently: items past the cap get
		// isVisible=false (active flag preserved so user can still delete
		// them). Logged but never returned as an error — matches the plan's
		// "молча обрезать" decision.
		role, _ := r.Context().Value(RoleKey).(string)
		if trimmed := applyVisibleCap(arr, h.getMaxIndicatorsForRole(role)); trimmed > 0 {
			log.Printf("[auth] visible cap on write: user=%s role=%s key=%s/%s/%s mode=%s trimmed=%d",
				userID, role, symbol, market, timeframe, mode, trimmed)
		}

		// Re-marshal arr after cap application so the persisted JSON reflects
		// any isVisible mutations. Falls back to the original body on encoding
		// errors (defensive — Marshal of a map already parsed via Unmarshal
		// should never fail).
		indicatorsJSON := string(body.Indicators)
		if reEncoded, err := json.Marshal(arr); err == nil {
			indicatorsJSON = string(reEncoded)
		}
		if mode == "replace" {
			if err := UpsertUserIndicator(r.Context(), h.db, userID, symbol, market, timeframe, indicatorsJSON); err != nil {
				log.Printf("[auth] upsert user_indicators: %v", err)
				writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to save indicators")
				return
			}
		} else {
			if err := MergeAddUserIndicator(r.Context(), h.db, userID, symbol, market, timeframe, indicatorsJSON); err != nil {
				log.Printf("[auth] merge-add user_indicators: %v", err)
				writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to merge-add indicators")
				return
			}
		}

		writeJSON(w, http.StatusOK, authResponse{OK: true})
		log.Printf("[auth] user_indicators saved: user=%s symbol=%s market=%s tf=%s mode=%s count=%d",
			userID, symbol, market, timeframe, mode, len(arr))
		return

	default:
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "mode must be 'replace', 'merge-add' or 'propagate'")
		return
	}
}

// PUT /api/v1/user/settings/favorite-indicators
// Body: { ids: ["cvd", "delta", ...] }
// Atomically replaces the `favoriteIndicatorIds` field inside the user_settings
// JSON blob without touching other fields. Read-modify-write happens inside a
// SQLite transaction so other partial writers cannot race.
func (h *Handler) handlePutFavoriteIndicators(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	defer r.Body.Close()

	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	const maxFavorites = 200
	if len(body.IDs) > maxFavorites {
		writeError(w, http.StatusBadRequest, "TOO_MANY_FAVORITES", "too many favorites (max 200)")
		return
	}
	// Dedup + validate ids non-empty short strings.
	seen := make(map[string]bool, len(body.IDs))
	cleaned := make([]string, 0, len(body.IDs))
	for _, id := range body.IDs {
		id = strings.TrimSpace(id)
		if id == "" {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "favorite id must be non-empty")
			return
		}
		if len(id) > 64 {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "favorite id too long (max 64)")
			return
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		cleaned = append(cleaned, id)
	}

	if err := SetUserSettingsField(r.Context(), h.db, userID, "favoriteIndicatorIds", cleaned); err != nil {
		log.Printf("[auth] set favoriteIndicatorIds: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to save favorites")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true})
}

// DELETE /api/v1/user/indicators?symbol=X&market=Y&timeframe=Z
// Removes the per-(user,symbol,market,timeframe) row so the cascade falls
// through. timeframe may be "*" to drop the scope=all-tf row.
func (h *Handler) handleDeleteUserIndicators(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	symbol, market, timeframe, errMsg := NormalizeIndicatorKey(
		r.URL.Query().Get("symbol"),
		r.URL.Query().Get("market"),
		r.URL.Query().Get("timeframe"),
	)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", errMsg)
		return
	}

	err := DeleteUserIndicator(r.Context(), h.db, userID, symbol, market, timeframe)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "no indicators row for the given key")
		return
	}
	if err != nil {
		log.Printf("[auth] delete user_indicators: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to delete indicators")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true})
	log.Printf("[auth] user_indicators deleted: user=%s symbol=%s market=%s tf=%s", userID, symbol, market, timeframe)
}
