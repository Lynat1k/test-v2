package auth

import (
	"database/sql"
	"log"
	"net/http"
	"strings"
)

// requireCustomIndicatorSettings gates handlers that mutate per-user indicator
// settings or presets behind the tier_policies.custom_indicator_settings flag.
// Returns true if the request may proceed; false if a response has already
// been written.
//
// Reads role from request context (set by RequireAuth middleware) and queries
// tier_policies in real-time — no cache, mirrors handleGetLimits semantics.
func (h *Handler) requireCustomIndicatorSettings(w http.ResponseWriter, r *http.Request) bool {
	role, _ := r.Context().Value(RoleKey).(string)
	if role == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return false
	}

	var allowed int
	err := h.db.QueryRow(
		`SELECT custom_indicator_settings FROM tier_policies WHERE tier = ?`,
		strings.ToLower(role),
	).Scan(&allowed)
	if err == sql.ErrNoRows {
		// Unknown tier → safe default: forbid custom settings.
		allowed = 0
	} else if err != nil {
		log.Printf("[auth] policy gate query: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to check policy")
		return false
	}

	if allowed == 0 {
		writeError(w, http.StatusForbidden, "CUSTOM_SETTINGS_FORBIDDEN", "Изменение настроек индикаторов недоступно на вашем тарифе")
		return false
	}
	return true
}
