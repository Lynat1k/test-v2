package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

type Handler struct {
	db                *sql.DB
	cfg               AuthConfig
	emailSender       EmailSender
	oauth             OAuthProvider
	rl                *AuthRateLimiter
	tierCompressionMax map[string]int
}

func (h *Handler) SetTierCompressionMax(m map[string]int) {
	h.tierCompressionMax = m
}

func NewHandler(cfg AuthConfig, db *sql.DB, rl *AuthRateLimiter) *Handler {
	return &Handler{
		db:          db,
		cfg:         cfg,
		emailSender: NewEmailSender(cfg),
		oauth:       NewOAuthProvider(cfg),
		rl:          rl,
	}
}

type authResponse struct {
	OK   bool        `json:"ok"`
	Data interface{} `json:"data,omitempty"`
	Err  *authError  `json:"error,omitempty"`
}

type authError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// userResponseData builds the full user response map used by /me, login, register, and refresh.
// All callers must use this to keep fields consistent.
// Placeholder emails (user_*@placeholder.local) are hidden — show "--" instead.
func (h *Handler) userResponseData(user *User) map[string]interface{} {
	daysLeft := 0
	if user.SubscriptionStatus == "active" && user.SubscriptionExpiresAt != "" {
		if exp, err := time.Parse(time.RFC3339, user.SubscriptionExpiresAt); err == nil {
			d := int(time.Until(exp).Hours() / 24)
			if d > 0 {
				daysLeft = d
			}
		}
	}

	compressionMax := 1
	if h.tierCompressionMax != nil {
		if v, ok := h.tierCompressionMax[strings.ToLower(user.Role)]; ok {
			compressionMax = v
		}
	}

	email := user.Email
	if strings.Contains(email, "@placeholder.local") {
		email = ""
	}

	return map[string]interface{}{
		"id":                    user.ID,
		"email":                 email,
		"nickname":              user.Nickname,
		"role":                  user.Role,
		"emailVerified":         user.EmailVerified,
		"avatar":                user.Avatar,
		"createdAt":             user.CreatedAt.Format(time.RFC3339),
		"subscriptionStatus":    user.SubscriptionStatus,
		"subscriptionPaidAt":    user.SubscriptionPaidAt,
		"subscriptionExpiresAt": user.SubscriptionExpiresAt,
		"daysLeft":              daysLeft,
		"compressionMax":        compressionMax,
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, authResponse{
		OK:  false,
		Err: &authError{Code: code, Message: message},
	})
}

func readBody(r *http.Request, v interface{}) error {
	r.Body = http.MaxBytesReader(w{}, r.Body, 4096)
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// w is a dummy writer for MaxBytesReader
type w struct{}

func (w) Write(b []byte) (int, error) { return len(b), nil }
func (w) WriteHeader(status int)      {}
func (w) Header() http.Header         { return nil }

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/register", h.handleRegister)
	mux.HandleFunc("POST /api/v1/auth/login", h.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/logout", h.handleLogout)
	mux.HandleFunc("POST /api/v1/auth/refresh", h.handleRefresh)
	mux.HandleFunc("GET /api/v1/auth/verify-email", h.handleVerifyEmail)
	mux.HandleFunc("POST /api/v1/auth/recovery", h.handleRecovery)
	mux.HandleFunc("GET /api/v1/user/settings", RequireAuth(h.cfg)(http.HandlerFunc(h.handleGetSettings)).ServeHTTP)
	mux.HandleFunc("PUT /api/v1/user/settings", RequireAuth(h.cfg)(http.HandlerFunc(h.handlePutSettings)).ServeHTTP)
	mux.HandleFunc("GET /api/v1/user/me", RequireAuth(h.cfg)(http.HandlerFunc(h.handleGetMe)).ServeHTTP)
	mux.HandleFunc("GET /api/v1/user/limits", h.handleGetLimits)
	mux.HandleFunc("PUT /api/v1/user/profile", RequireAuth(h.cfg)(http.HandlerFunc(h.handleUpdateProfile)).ServeHTTP)
	mux.HandleFunc("POST /api/v1/user/change-password", RequireAuth(h.cfg)(http.HandlerFunc(h.handleChangePassword)).ServeHTTP)
	mux.HandleFunc("GET /api/v1/user/drawing-defaults", h.handleGetDrawingDefaults)
	mux.HandleFunc("PUT /api/v1/user/drawing-defaults", RequireAuth(h.cfg)(http.HandlerFunc(h.handlePutDrawingDefaults)).ServeHTTP)
	mux.HandleFunc("POST /api/v1/auth/google", h.handleGoogleAuth)
	mux.HandleFunc("GET /api/v1/auth/google/callback", h.handleGoogleCallback)
}

// --- POST /api/v1/auth/register ---

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

func (h *Handler) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := readBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Nickname = strings.TrimSpace(req.Nickname)

	if !emailRegex.MatchString(req.Email) {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "invalid email format")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "password must be at least 8 characters")
		return
	}
	if len(req.Nickname) < 2 || len(req.Nickname) > 30 {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "nickname must be 2-30 characters")
		return
	}

	ip := extractIP(r)
	if allowed, retryAfter := h.rl.CheckRegister(r.Context(), ip); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, try again later")
		return
	}

	existing, _ := GetUserByEmail(r.Context(), h.db, req.Email)
	if existing != nil {
		writeError(w, http.StatusConflict, "EMAIL_TAKEN", "this email is already registered")
		return
	}

	nickExisting, _ := GetUserByNickname(r.Context(), h.db, req.Nickname)
	if nickExisting != nil {
		writeError(w, http.StatusConflict, "NICKNAME_EXISTS", "this nickname is already taken")
		return
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		log.Printf("[auth] hash password error: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	user := &User{
		Email:         req.Email,
		Nickname:      req.Nickname,
		PasswordHash:  hash,
		Role:          "free",
		EmailVerified: false,
	}
	if err := CreateUser(r.Context(), h.db, user); err != nil {
		log.Printf("[auth] create user error: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	h.issueTokens(w, r, user)

	h.sendVerificationEmail(r.Context(), user)

	log.Printf("[auth] registered user %s", user.ID)
}

func (h *Handler) sendVerificationEmail(ctx context.Context, user *User) {
	ev := &EmailVerification{
		UserID:    user.ID,
		Email:     user.Email,
		ExpiresAt: time.Now().UTC().Add(h.cfg.EmailVerificationTTL),
	}
	if err := CreateEmailVerification(ctx, h.db, ev); err != nil {
		log.Printf("[auth] create verification for %s: %v", user.Email, err)
		return
	}

	verifyURL := fmt.Sprintf("/api/v1/auth/verify-email?token=%s", ev.ID)
	h.emailSender.SendVerification(ctx, user.Email, verifyURL)
}

// --- POST /api/v1/auth/login ---

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := readBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	ip := extractIP(r)

	// Determine identifier for rate limiting: use the raw input (email field)
	identifier := req.Email

	if allowed, retryAfter := h.rl.CheckLogin(r.Context(), ip, identifier); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, try again later")
		return
	}

	// Try email first, then nickname
	user, err := GetUserByEmail(r.Context(), h.db, req.Email)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("[auth] get user by email: %v", err)
			writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			return
		}
		// Not found by email — try by nickname (lowercased)
		user, err = GetUserByNickname(r.Context(), h.db, req.Email)
		if err != nil {
			if err == sql.ErrNoRows {
				writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
				return
			}
			log.Printf("[auth] get user by nickname: %v", err)
			writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			return
		}
	}

	if locked, remaining := h.rl.CheckLockout(r.Context(), user.ID); locked {
		w.Header().Set("Retry-After", strconv.Itoa(int(remaining.Seconds())+1))
		writeError(w, http.StatusForbidden, "ACCOUNT_LOCKED", "account temporarily locked, try again later")
		return
	}

	if !CheckPassword(user.PasswordHash, req.Password) {
		isLocked, delay := h.rl.RecordLoginFailure(r.Context(), user.ID)
		if isLocked {
			w.Header().Set("Retry-After", strconv.Itoa(int(delay.Seconds())+1))
			writeError(w, http.StatusForbidden, "ACCOUNT_LOCKED", "account temporarily locked, try again later")
			return
		}
		if delay > 0 {
			time.Sleep(delay)
		}
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
		return
	}

	h.rl.ClearFailures(r.Context(), user.ID)

	if !user.EmailVerified {
		writeError(w, http.StatusForbidden, "EMAIL_NOT_VERIFIED", "please verify your email before logging in")
		return
	}

	h.issueTokens(w, r, user)
	log.Printf("[auth] login user %s", user.ID)
}

// --- POST /api/v1/auth/logout ---

func (h *Handler) handleLogout(w http.ResponseWriter, r *http.Request) {
	refreshToken, err := r.Cookie("pc_refresh_token")
	if err != nil {
		writeJSON(w, http.StatusOK, authResponse{OK: true})
		return
	}

	hash := HashRefreshToken(refreshToken.Value)
	session, err := GetSessionByRefreshHash(r.Context(), h.db, hash)
	if err == nil && session != nil {
		DeleteSession(r.Context(), h.db, session.ID)
	}

	clearRefreshCookie(w, h.cfg)
	writeJSON(w, http.StatusOK, authResponse{OK: true})
	log.Printf("[auth] logout session %s", sessionIDOrDefault(session))
}

func sessionIDOrDefault(s *Session) string {
	if s != nil {
		return s.ID
	}
	return "unknown"
}

// --- POST /api/v1/auth/refresh ---

func (h *Handler) handleRefresh(w http.ResponseWriter, r *http.Request) {
	refreshCookie, err := r.Cookie("pc_refresh_token")
	if err != nil {
		writeError(w, http.StatusUnauthorized, "NO_REFRESH_TOKEN", "no refresh token")
		return
	}

	hash := HashRefreshToken(refreshCookie.Value)
	session, err := GetSessionByRefreshHash(r.Context(), h.db, hash)
	if err != nil {
		if err == sql.ErrNoRows {
			rotatedSession, err2 := GetSessionByRefreshHashAny(r.Context(), h.db, hash)
			if err2 == nil && rotatedSession != nil {
				log.Printf("[auth] refresh reuse detected for user %s, invalidating all sessions", rotatedSession.UserID)
				DeleteAllUserSessions(r.Context(), h.db, rotatedSession.UserID)
				clearRefreshCookie(w, h.cfg)
				writeError(w, http.StatusUnauthorized, "REFRESH_REUSE", "session invalidated")
				return
			}
			log.Printf("[auth] refresh reuse detected (session unknown), rejecting")
			clearRefreshCookie(w, h.cfg)
			writeError(w, http.StatusUnauthorized, "REFRESH_REUSE", "session invalidated")
			return
		}
		log.Printf("[auth] get session: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	if time.Now().After(session.ExpiresAt) {
		DeleteSession(r.Context(), h.db, session.ID)
		clearRefreshCookie(w, h.cfg)
		writeError(w, http.StatusUnauthorized, "SESSION_EXPIRED", "session expired")
		return
	}

	MarkSessionRotated(r.Context(), h.db, session.ID)

	user, err := GetUserByID(r.Context(), h.db, session.UserID)
	if err != nil {
		log.Printf("[auth] get user for refresh: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	h.issueTokens(w, r, user)
	log.Printf("[auth] refresh for user %s", user.ID)
}

// --- GET /api/v1/auth/verify-email ---

func (h *Handler) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "token is required")
		return
	}

	ev, err := GetEmailVerification(r.Context(), h.db, token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_TOKEN", "invalid verification token")
		return
	}

	if ev.Used {
		writeError(w, http.StatusBadRequest, "TOKEN_USED", "verification token already used")
		return
	}

	if time.Now().After(ev.ExpiresAt) {
		writeError(w, http.StatusBadRequest, "TOKEN_EXPIRED", "verification token expired")
		return
	}

	if err := UseEmailVerification(r.Context(), h.db, ev.ID); err != nil {
		log.Printf("[auth] use verification: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	if err := SetEmailVerified(r.Context(), h.db, ev.UserID); err != nil {
		log.Printf("[auth] set email verified: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true})
	log.Printf("[auth] email verified for user %s", ev.UserID)
}

// --- POST /api/v1/auth/recovery ---

type recoveryRequest struct {
	Email string `json:"email"`
}

func (h *Handler) handleRecovery(w http.ResponseWriter, r *http.Request) {
	var req recoveryRequest
	if err := readBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if !emailRegex.MatchString(req.Email) {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "invalid email format")
		return
	}

	if allowed, retryAfter := h.rl.CheckRecovery(r.Context(), req.Email); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, try again later")
		return
	}

	// Always return ok — do not reveal whether the email exists
	writeJSON(w, http.StatusOK, authResponse{OK: true})
	log.Printf("[auth] recovery request")
}

// --- GET /api/v1/user/settings ---

func (h *Handler) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	settings, err := GetUserSettings(r.Context(), h.db, userID)
	if err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusOK, authResponse{OK: true, Data: map[string]string{"settingsJson": "{}"}})
			return
		}
		log.Printf("[auth] get settings: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true, Data: map[string]string{"settingsJson": settings.SettingsJSON}})
}

// --- PUT /api/v1/user/settings ---

func (h *Handler) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	r.Body = http.MaxBytesReader(w, r.Body, 1024*10) // 10KB max
	defer r.Body.Close()

	var body struct {
		SettingsJSON string `json:"settingsJson"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if body.SettingsJSON == "" {
		body.SettingsJSON = "{}"
	}

	if err := UpsertUserSettings(r.Context(), h.db, userID, body.SettingsJSON); err != nil {
		log.Printf("[auth] upsert settings: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true})
}

// --- Drawing Defaults (Phase 14 Step 1) ---

var validDrawingTypes = map[string]bool{
	"volume":    true,
	"position":  true,
	"trend":     true,
	"arrow":     true,
	"channel":   true,
	"horizontal": true,
	"rect":      true,
	"fibonacci": true,
	"ruler":     true,
	"text":      true,
}

// GET /api/v1/user/drawing-defaults
// Public (like /user/limits): guest → {}, auth user → their drawing defaults.
func (h *Handler) handleGetDrawingDefaults(w http.ResponseWriter, r *http.Request) {
	userID, _, err := ExtractUserFromRequest(h.cfg, r)
	if err != nil {
		// Guest — return empty object
		writeJSON(w, http.StatusOK, authResponse{OK: true, Data: map[string]interface{}{}})
		return
	}

	defaults, err := GetDrawingDefaults(r.Context(), h.db, userID)
	if err != nil {
		log.Printf("[auth] get drawing defaults: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to get drawing defaults")
		return
	}

	// Parse JSON strings into objects for clean JSON response
	result := make(map[string]interface{})
	for drawingType, settingsJSON := range defaults {
		var parsed interface{}
		if err := json.Unmarshal([]byte(settingsJSON), &parsed); err != nil {
			parsed = map[string]interface{}{}
		}
		result[drawingType] = parsed
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true, Data: result})
}

// PUT /api/v1/user/drawing-defaults
// Requires auth. Upserts settings for a given drawingType.
func (h *Handler) handlePutDrawingDefaults(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	defer r.Body.Close()

	var body struct {
		DrawingType string          `json:"drawingType"`
		Settings    json.RawMessage `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if !validDrawingTypes[body.DrawingType] {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "unknown drawing type")
		return
	}

	if len(body.Settings) == 0 || string(body.Settings) == "null" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "settings must be a non-null JSON object")
		return
	}

	// Validate that settings is a valid JSON object (not array, not scalar)
	var obj map[string]interface{}
	if err := json.Unmarshal(body.Settings, &obj); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "settings must be a valid JSON object")
		return
	}

	settingsJSON := string(body.Settings)

	if err := UpsertDrawingDefault(r.Context(), h.db, userID, body.DrawingType, settingsJSON); err != nil {
		log.Printf("[auth] upsert drawing default: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to save drawing defaults")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true})
	log.Printf("[auth] drawing default saved: user=%s type=%s", userID, body.DrawingType)
}

// --- Google OAuth stubs ---

func (h *Handler) handleGoogleAuth(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "Google OAuth not enabled")
}

func (h *Handler) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "Google OAuth not enabled")
}

// --- Helpers ---

func (h *Handler) issueTokens(w http.ResponseWriter, r *http.Request, user *User) {
	accessToken, err := GenerateAccessToken(h.cfg, user.ID, user.Role)
	if err != nil {
		log.Printf("[auth] generate access token: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	refreshToken, err := GenerateRefreshToken()
	if err != nil {
		log.Printf("[auth] generate refresh token: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	refreshHash := HashRefreshToken(refreshToken)
	ua := r.UserAgent()
	ip := extractIP(r)

	session := &Session{
		UserID:           user.ID,
		RefreshTokenHash: refreshHash,
		UserAgent:        ua,
		IP:               ip,
		ExpiresAt:        time.Now().UTC().Add(h.cfg.RefreshTokenTTL),
	}
	if err := CreateSession(r.Context(), h.db, session); err != nil {
		log.Printf("[auth] create session: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	setRefreshCookie(w, h.cfg, refreshToken, h.cfg.RefreshTokenTTL)

	writeJSON(w, http.StatusOK, authResponse{
		OK: true,
		Data: map[string]interface{}{
			"accessToken": accessToken,
			"user":        h.userResponseData(user),
		},
	})
}

func setRefreshCookie(w http.ResponseWriter, cfg AuthConfig, token string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     "pc_refresh_token",
		Value:    token,
		Path:     "/api/v1/auth",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   cfg.CookieDomain,
	})
}

func clearRefreshCookie(w http.ResponseWriter, cfg AuthConfig) {
	http.SetCookie(w, &http.Cookie{
		Name:     "pc_refresh_token",
		Value:    "",
		Path:     "/api/v1/auth",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   cfg.CookieDomain,
	})
}

func extractIP(r *http.Request) string {
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return strings.Split(ip, ",")[0]
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

// --- GET /api/v1/user/me ---

func (h *Handler) handleGetMe(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	user, err := GetUserByID(r.Context(), h.db, userID)
	if err != nil {
		log.Printf("[auth] get user for /me: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		OK:   true,
		Data: h.userResponseData(user),
	})
}

// --- PUT /api/v1/user/profile ---

var validAvatarPresets = map[string]bool{
	"avatar-1": true,
	"avatar-2": true,
	"avatar-3": true,
	"avatar-4": true,
	"avatar-5": true,
}

func (h *Handler) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	defer r.Body.Close()

	var body struct {
		Nickname string `json:"nickname"`
		Avatar   string `json:"avatar"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	body.Nickname = strings.TrimSpace(body.Nickname)
	if len(body.Nickname) < 2 || len(body.Nickname) > 30 {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "nickname must be 2-30 characters")
		return
	}

	body.Avatar = strings.TrimSpace(body.Avatar)
	if body.Avatar != "" {
		if validAvatarPresets[body.Avatar] {
			// preset key — ok
		} else if len(body.Avatar) > 500 {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "avatar URL too long (max 500)")
			return
		} else {
			parsed, err := url.Parse(body.Avatar)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
				writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "avatar must be a preset key or valid http/https URL")
				return
			}
		}
	}

	if err := UpdateUserProfile(r.Context(), h.db, userID, body.Nickname, body.Avatar); err != nil {
		log.Printf("[auth] update profile: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true})
	log.Printf("[auth] profile updated for user %s", userID)
}

// --- POST /api/v1/user/change-password ---

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (h *Handler) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	defer r.Body.Close()

	var req changePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "new password must be at least 8 characters")
		return
	}

	user, err := GetUserByID(r.Context(), h.db, userID)
	if err != nil {
		log.Printf("[auth] get user for change-password: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	if !CheckPassword(user.PasswordHash, req.CurrentPassword) {
		writeError(w, http.StatusUnauthorized, "INVALID_PASSWORD", "current password is incorrect")
		return
	}

	newHash, err := HashPassword(req.NewPassword)
	if err != nil {
		log.Printf("[auth] hash new password: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	if err := UpdateUserPasswordHash(r.Context(), h.db, userID, newHash); err != nil {
		log.Printf("[auth] update password hash: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	// Invalidate ALL sessions — forced re-login
	if err := DeleteAllUserSessions(r.Context(), h.db, userID); err != nil {
		log.Printf("[auth] invalidate sessions: %v", err)
	}

	clearRefreshCookie(w, h.cfg)
	writeJSON(w, http.StatusOK, authResponse{OK: true})
	log.Printf("[auth] password changed for user %s, all sessions invalidated", userID)
}

// --- GET /api/v1/user/limits ---
// Reads tier_policies from DB in real-time for the current user's role.
// NOT from cache — always fresh.

func (h *Handler) handleGetLimits(w http.ResponseWriter, r *http.Request) {
	role := "guest"
	if userID, rRole, err := ExtractUserFromRequest(h.cfg, r); err == nil {
		role = rRole
		_ = userID
	}

	var p struct {
		Tier                    string         `json:"tier"`
		SessionLimit            int            `json:"sessionLimit"`
		HistoryMaxDays          int            `json:"historyMaxDays"`
		CompressionMax          int            `json:"compressionMax"`
		MaxIndicators           int            `json:"maxIndicators"`
		CustomIndicatorSettings int            `json:"customIndicatorSettings"`
		TelegramEnabled         int            `json:"telegramEnabled"`
		WorkspacesCount         int            `json:"workspacesCount"`
		AnomaliesEnabled        int            `json:"anomaliesEnabled"`
		HistoryDaysPerTf        map[string]int `json:"historyDaysPerTf"`
	}
	var historyDaysPerTf string

	err := h.db.QueryRow(`SELECT tier, session_limit, history_max_days, compression_max, max_indicators,
		custom_indicator_settings, telegram_enabled, workspaces_count, anomalies_enabled, history_days_per_tf
		FROM tier_policies WHERE tier = ?`, strings.ToLower(role)).Scan(
		&p.Tier, &p.SessionLimit, &p.HistoryMaxDays, &p.CompressionMax, &p.MaxIndicators,
		&p.CustomIndicatorSettings, &p.TelegramEnabled, &p.WorkspacesCount, &p.AnomaliesEnabled, &historyDaysPerTf)

	if err == sql.ErrNoRows {
		// Fallback: guest defaults
		p = struct {
			Tier                    string         `json:"tier"`
			SessionLimit            int            `json:"sessionLimit"`
			HistoryMaxDays          int            `json:"historyMaxDays"`
			CompressionMax          int            `json:"compressionMax"`
			MaxIndicators           int            `json:"maxIndicators"`
			CustomIndicatorSettings int            `json:"customIndicatorSettings"`
			TelegramEnabled         int            `json:"telegramEnabled"`
			WorkspacesCount         int            `json:"workspacesCount"`
			AnomaliesEnabled        int            `json:"anomaliesEnabled"`
			HistoryDaysPerTf        map[string]int `json:"historyDaysPerTf"`
		}{
			Tier: role, SessionLimit: 1, HistoryMaxDays: 7, CompressionMax: 1,
			MaxIndicators: 1, WorkspacesCount: 1,
			HistoryDaysPerTf: map[string]int{"1m": 1, "5m": 1, "15m": 1, "30m": 1, "1h": 1, "4h": 1},
		}
	} else if err != nil {
		log.Printf("[auth] get limits error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to get limits")
		return
	}

	p.HistoryDaysPerTf = make(map[string]int)
	if err := json.Unmarshal([]byte(historyDaysPerTf), &p.HistoryDaysPerTf); err != nil {
		p.HistoryDaysPerTf = map[string]int{"1m": 1, "5m": 1, "15m": 1, "30m": 1, "1h": 1, "4h": 1}
	}

	writeJSON(w, http.StatusOK, authResponse{OK: true, Data: p})
}
