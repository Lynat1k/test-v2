package auth

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
)

const (
	maxPresetNameLen     = 64
	maxPresetSettingsLen = 32 * 1024
	maxPresetRequestLen  = 64 * 1024
)

// indicatorIDPattern enforces a conservative character set so a malformed id
// can't smuggle in path-style strings. Mirrors the frontend MODULAR_INDICATORS
// id convention (camelCase, occasionally snake_case).
func validIndicatorID(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for _, c := range s {
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '_' || c == '-'
		if !ok {
			return false
		}
	}
	return true
}

func validPresetName(s string) bool {
	s = strings.TrimSpace(s)
	return s != "" && len(s) <= maxPresetNameLen
}

type presetView struct {
	ID          string          `json:"id"`
	IndicatorID string          `json:"indicatorId"`
	Name        string          `json:"name"`
	Settings    json.RawMessage `json:"settings"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
	Readonly    bool            `json:"readonly,omitempty"`
}

func toPresetView(p UserIndicatorPreset) presetView {
	var raw json.RawMessage = json.RawMessage(p.SettingsJSON)
	if len(raw) == 0 {
		raw = json.RawMessage("{}")
	}
	return presetView{
		ID:          p.ID,
		IndicatorID: p.IndicatorID,
		Name:        p.Name,
		Settings:    raw,
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
	}
}

// GET /api/v1/user/indicator-presets?indicatorId=cvd
//
// Auth-optional (route registration unchanged): authed users get their own
// per-indicator presets; guests get an empty list.
//
// Response shape:
//
//	{ presets: [...user rows...] }
func (h *Handler) handleListIndicatorPresets(w http.ResponseWriter, r *http.Request) {
	indicatorID := strings.TrimSpace(r.URL.Query().Get("indicatorId"))
	if indicatorID != "" && !validIndicatorID(indicatorID) {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "invalid indicatorId")
		return
	}

	userID, _, _ := ExtractUserFromRequest(h.cfg, r)
	ctx := r.Context()

	presets := make([]presetView, 0)
	if userID != "" {
		rows, err := ListUserIndicatorPresets(ctx, h.db, userID, indicatorID)
		if err != nil {
			log.Printf("[auth] list user_indicator_presets: %v", err)
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to list presets")
			return
		}
		for _, p := range rows {
			presets = append(presets, toPresetView(p))
		}
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true, Data: map[string]interface{}{
		"presets": presets,
	}})
}

// POST /api/v1/user/indicator-presets
// Body: { indicatorId, name, settings: {...} }
func (h *Handler) handleCreateIndicatorPreset(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	if !h.requireCustomIndicatorSettings(w, r) {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxPresetRequestLen)
	defer r.Body.Close()

	var body struct {
		IndicatorID string          `json:"indicatorId"`
		Name        string          `json:"name"`
		Settings    json.RawMessage `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	body.IndicatorID = strings.TrimSpace(body.IndicatorID)
	body.Name = strings.TrimSpace(body.Name)
	if !validIndicatorID(body.IndicatorID) {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "invalid indicatorId")
		return
	}
	if !validPresetName(body.Name) {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "name must be 1-64 chars")
		return
	}
	if len(body.Settings) == 0 || string(body.Settings) == "null" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "settings must be a JSON object")
		return
	}
	if len(body.Settings) > maxPresetSettingsLen {
		writeError(w, http.StatusBadRequest, "PAYLOAD_TOO_LARGE", "settings too large (max 32KB)")
		return
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(body.Settings, &obj); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "settings must be a valid JSON object")
		return
	}

	id, err := CreateUserIndicatorPreset(r.Context(), h.db, userID, body.IndicatorID, body.Name, string(body.Settings))
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "UNIQUE") || strings.Contains(msg, "unique") {
			writeError(w, http.StatusConflict, "NAME_EXISTS", "preset name already used for this indicator")
			return
		}
		log.Printf("[auth] create user_indicator_preset: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to create preset")
		return
	}

	writeJSON(w, http.StatusCreated, authResponse{OK: true, Data: map[string]string{"id": id}})
	log.Printf("[auth] preset created: user=%s indicator=%s name=%s id=%s", userID, body.IndicatorID, body.Name, id)
}

// PUT /api/v1/user/indicator-presets/{id}
// Body: { name?, settings? }
func (h *Handler) handleUpdateIndicatorPreset(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "preset id is required")
		return
	}

	if !h.requireCustomIndicatorSettings(w, r) {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxPresetRequestLen)
	defer r.Body.Close()

	var body struct {
		Name     *string         `json:"name"`
		Settings json.RawMessage `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	name := ""
	if body.Name != nil {
		trimmed := strings.TrimSpace(*body.Name)
		if !validPresetName(trimmed) {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "name must be 1-64 chars")
			return
		}
		name = trimmed
	}

	settingsStr := ""
	if len(body.Settings) > 0 && string(body.Settings) != "null" {
		if len(body.Settings) > maxPresetSettingsLen {
			writeError(w, http.StatusBadRequest, "PAYLOAD_TOO_LARGE", "settings too large (max 32KB)")
			return
		}
		var obj map[string]interface{}
		if err := json.Unmarshal(body.Settings, &obj); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "settings must be a valid JSON object")
			return
		}
		settingsStr = string(body.Settings)
	}

	if name == "" && settingsStr == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "nothing to update")
		return
	}

	err := UpdateUserIndicatorPreset(r.Context(), h.db, userID, id, name, settingsStr)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "preset not found")
		return
	}
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "UNIQUE") || strings.Contains(msg, "unique") {
			writeError(w, http.StatusConflict, "NAME_EXISTS", "preset name already used for this indicator")
			return
		}
		log.Printf("[auth] update user_indicator_preset: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to update preset")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true})
}

// DELETE /api/v1/user/indicator-presets/{id}
func (h *Handler) handleDeleteIndicatorPreset(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "preset id is required")
		return
	}

	if !h.requireCustomIndicatorSettings(w, r) {
		return
	}

	err := DeleteUserIndicatorPreset(r.Context(), h.db, userID, id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "preset not found")
		return
	}
	if err != nil {
		log.Printf("[auth] delete user_indicator_preset: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to delete preset")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true})
}

// POST /api/v1/user/indicator-presets/{id}/apply?symbol&market&timeframe
//
// Reads a user_indicator_presets row by uuid and applies its settings to the
// given (symbol, market, timeframe) without touching sibling indicators.
func (h *Handler) handleApplyIndicatorPreset(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "preset id is required")
		return
	}

	symbol, market, timeframe, errMsg := NormalizeIndicatorKey(
		r.URL.Query().Get("symbol"),
		r.URL.Query().Get("market"),
		r.URL.Query().Get("timeframe"),
	)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", errMsg)
		return
	}
	if timeframe == AllTimeframeMarker {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "apply requires a concrete timeframe")
		return
	}

	p, err := GetUserIndicatorPreset(r.Context(), h.db, userID, id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "preset not found")
		return
	}
	if err != nil {
		log.Printf("[auth] apply preset: get: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to load preset")
		return
	}
	indicatorID := p.IndicatorID
	settings := p.SettingsJSON

	if settings == "" {
		settings = "{}"
	}

	if err := ApplyPresetToKey(r.Context(), h.db, userID, symbol, market, timeframe, indicatorID, json.RawMessage(settings)); err != nil {
		log.Printf("[auth] apply preset: write: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to apply preset")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true, Data: map[string]string{"indicatorId": indicatorID}})
	log.Printf("[auth] preset applied: user=%s preset=%s indicator=%s key=%s/%s/%s", userID, id, indicatorID, symbol, market, timeframe)
}
