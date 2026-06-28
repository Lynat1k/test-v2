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

// countActiveOverflow counts active indicators past the tier cap WITHOUT
// mutating arr. Returns the number of items in overflow positions (i.e. items
// whose isActive=true appears at position >= max in the active-filtered order).
// max < 0 disables the count (always 0).
//
// Tier limit semantics (variant B): on downgrade we keep overflow items in
// the stored array with their original isActive=true so the UI can render
// them as "blocked by tier" — the eye toggle is disabled until the user
// frees a slot by removing one of the first N actives. The cap is no longer
// applied as a mutation; FE and BE both compute the blocked set from array
// order against the tier max.
func countActiveOverflow(arr []map[string]interface{}, max int) int {
	if max < 0 {
		return 0
	}
	active := 0
	overflow := 0
	for _, it := range arr {
		isActive, _ := it["isActive"].(bool)
		if !isActive {
			continue
		}
		if active >= max {
			overflow++
		} else {
			active++
		}
	}
	return overflow
}

// countActives returns the number of items with isActive=true.
func countActives(arr []map[string]interface{}) int {
	n := 0
	for _, it := range arr {
		if isActive, _ := it["isActive"].(bool); isActive {
			n++
		}
	}
	return n
}

// getMaxIndicatorsForRole reads tier_policies.max_indicators for the role.
// Returns -1 (no cap) for unknown roles or query failures — the global
// maxIndicatorsPerKey ceiling still applies as a hard DoS guard.
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
	return maxN
}

// getGatedIndicatorsForRole reads tier_policies.gated_indicators for the role
// and returns the set of indicator ids hidden from that tier. Returns nil on
// any error / unknown role / empty column — callers treat nil as "nothing
// gated" so a read failure never hides indicators that should be visible.
func (h *Handler) getGatedIndicatorsForRole(role string) []string {
	if role == "" {
		role = "guest"
	}
	var raw string
	err := h.db.QueryRow(
		`SELECT gated_indicators FROM tier_policies WHERE tier = ?`,
		strings.ToLower(role),
	).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		log.Printf("[auth] gated indicators: query for %s: %v", role, err)
		return nil
	}
	if raw == "" {
		return nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		log.Printf("[auth] gated indicators: corrupt json for %s: %v", role, err)
		return nil
	}
	return ids
}

// filterGatedIndicators returns a new slice with every item whose "id" is in
// the gated set removed. When gated is empty it returns arr unchanged. Items
// without a string id are kept (id validation happens elsewhere).
func filterGatedIndicators(arr []map[string]interface{}, gated []string) []map[string]interface{} {
	if len(gated) == 0 || len(arr) == 0 {
		return arr
	}
	gatedSet := make(map[string]bool, len(gated))
	for _, id := range gated {
		gatedSet[id] = true
	}
	out := make([]map[string]interface{}, 0, len(arr))
	for _, it := range arr {
		if id, ok := it["id"].(string); ok && gatedSet[id] {
			continue
		}
		out = append(out, it)
	}
	return out
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

	// Parse as a typed array of objects. Falls back to an empty array on
	// corrupt rows so the UI keeps working. The persisted array is returned
	// verbatim — variant B keeps tier-overflow items in the stored set with
	// their isActive=true so the UI can render them as "blocked by tier"
	// (eye disabled, position past the tier cap). FE and BE both compute the
	// blocked set from array order against the role's max.
	var arr []map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &arr); err != nil {
		log.Printf("[auth] resolve indicators: corrupt json for %s/%s/%s: %v", symbol, market, timeframe, err)
		arr = nil
	}
	// Per-tier gate: cut indicators hidden for this role from the resolved view
	// so a downgrade makes the gated indicator disappear (e.g. Buy/Sell Zone for
	// non-admin tiers). Done before the overflow count so gated items never
	// occupy a tier slot.
	arr = filterGatedIndicators(arr, h.getGatedIndicatorsForRole(role))
	if overflow := countActiveOverflow(arr, h.getMaxIndicatorsForRole(role)); overflow > 0 {
		log.Printf("[auth] tier overflow on read: user=%s role=%s key=%s/%s/%s overflow=%d",
			userID, role, symbol, market, timeframe, overflow)
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
		// Per-tier gate: a gated indicator (e.g. Buy/Sell Zone for non-admin)
		// must not be persisted via propagate either. Silently no-op — the UI
		// hides it, this is defense-in-depth against hand-crafted requests.
		propRole, _ := r.Context().Value(RoleKey).(string)
		for _, g := range h.getGatedIndicatorsForRole(propRole) {
			if g == id {
				writeJSON(w, http.StatusOK, authResponse{OK: true})
				log.Printf("[auth] propagate gated indicator skipped: user=%s role=%s id=%s", userID, propRole, id)
				return
			}
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

		role, _ := r.Context().Value(RoleKey).(string)

		// Per-tier gate: silently drop indicators hidden for this role from the
		// incoming set so a gated indicator (e.g. Buy/Sell Zone for non-admin)
		// can never be persisted active even via a hand-crafted request. No 403 —
		// the UI already hides these; this is defense-in-depth.
		arr = filterGatedIndicators(arr, h.getGatedIndicatorsForRole(role))

		// Per-tier active cap (variant B): reject only when the request would
		// strictly INCREASE the active count past the tier max. This preserves
		// the "limit on add" rule (a raw API client trying to push more actives
		// than the tier allows is refused) while letting a freshly-downgraded
		// user save settings on the same set of indicators they already had —
		// the overflow stays in the stored row and the UI renders the tail as
		// "blocked by tier". propagate path is unaffected (single-indicator op).
		tierMax := h.getMaxIndicatorsForRole(role)
		if tierMax >= 0 {
			storedJSON, _, gErr := GetUserIndicator(r.Context(), h.db, userID, symbol, market, timeframe)
			if gErr != nil {
				log.Printf("[auth] tier cap: read stored row: %v", gErr)
				writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to read stored indicators")
				return
			}
			var storedArr []map[string]interface{}
			storedIDs := map[string]bool{}
			storedActiveCount := 0
			if storedJSON != "" {
				if err := json.Unmarshal([]byte(storedJSON), &storedArr); err == nil {
					for _, it := range storedArr {
						if id, ok := it["id"].(string); ok && id != "" {
							storedIDs[id] = true
						}
					}
					storedActiveCount = countActives(storedArr)
				}
			}

			var newActiveCount int
			switch mode {
			case "replace":
				newActiveCount = countActives(arr)
			case "merge-add":
				newActiveCount = storedActiveCount
				for _, it := range arr {
					id, _ := it["id"].(string)
					if storedIDs[id] {
						continue
					}
					if isActive, _ := it["isActive"].(bool); isActive {
						newActiveCount++
					}
				}
			}

			if newActiveCount > tierMax && newActiveCount > storedActiveCount {
				writeError(w, http.StatusBadRequest, "TIER_LIMIT_EXCEEDED",
					"indicators exceed tier limit")
				log.Printf("[auth] tier limit exceeded: user=%s role=%s key=%s/%s/%s mode=%s active=%d stored=%d max=%d",
					userID, role, symbol, market, timeframe, mode, newActiveCount, storedActiveCount, tierMax)
				return
			}

			if overflow := countActiveOverflow(arr, tierMax); overflow > 0 {
				log.Printf("[auth] tier overflow on write: user=%s role=%s key=%s/%s/%s mode=%s overflow=%d",
					userID, role, symbol, market, timeframe, mode, overflow)
			}
		}

		// Re-marshal arr to ensure stable serialization of the parsed payload
		// (object key order, whitespace stripped). Falls back to the original
		// body on encoding errors (defensive — Marshal of a map already parsed
		// via Unmarshal should never fail).
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
