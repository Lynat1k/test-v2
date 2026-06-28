package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/auth"
	"github.com/procluster/procluster/internal/binance"
	"github.com/procluster/procluster/internal/repository/clickhouse"
	"github.com/redis/go-redis/v9"
)

type AdminHandler struct {
	db          *sql.DB
	authCfg     auth.AuthConfig
	chRepo      *clickhouse.ClickhouseRepository
	rdb         *redis.Client
	rl          *AdminRateLimiter
	logBuf      *LogBuffer
	metricsHist *MetricsHistory
	jobRegistry *JobRegistry

	// RefreshCompressions, если задан, вызывается после успешного
	// UpsertDefaultCompressionsBatch — обновляет in-memory кэш
	// activeCompressions у api.Server, чтобы публичный
	// /api/v1/compressions сразу отдавал свежие данные.
	RefreshCompressions func()

	// RefreshTickers, если задан, вызывается после успешного add/update/delete
	// тикера — перечитывает тикеры из БД и обновляет in-memory кэш activeTickers
	// у api.Server, чтобы публичный /api/v1/tickers сразу отдавал свежий список.
	RefreshTickers func()

	chSizeErrMu    sync.Mutex
	chSizeLastErr  string
	chSizeLastTime time.Time
}

func NewAdminHandler(db *sql.DB, authCfg auth.AuthConfig, chRepo *clickhouse.ClickhouseRepository, rdb *redis.Client, logBuf *LogBuffer, metricsHist *MetricsHistory) *AdminHandler {
	return &AdminHandler{
		db:          db,
		authCfg:     authCfg,
		chRepo:      chRepo,
		rdb:         rdb,
		rl:          NewAdminRateLimiter(rdb),
		logBuf:      logBuf,
		metricsHist: metricsHist,
		jobRegistry: NewJobRegistry(db),
	}
}

type adminResponse struct {
	OK   bool        `json:"ok"`
	Data interface{} `json:"data,omitempty"`
	Err  *adminError `json:"error,omitempty"`
}

type adminError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, adminResponse{
		OK:  false,
		Err: &adminError{Code: code, Message: message},
	})
}

func withAdminMiddleware(rl *AdminRateLimiter, authCfg auth.AuthConfig, next http.Handler) http.Handler {
	return auth.RequireAuth(authCfg)(
		auth.RequireRole("admin")(
			AdminRateLimitMiddleware(rl, next),
		),
	)
}

func (h *AdminHandler) RegisterAdminRoutes(mux *http.ServeMux) {
	wrap := func(handler http.HandlerFunc) http.Handler {
		return withAdminMiddleware(h.rl, h.authCfg, handler)
	}

	// Metrics
	mux.Handle("GET /api/v1/admin/metrics", wrap(h.handleGetMetrics))
	mux.Handle("GET /api/v1/admin/metrics/history", wrap(h.handleGetMetricsHistory))

	// Users
	mux.Handle("GET /api/v1/admin/users/stats", wrap(h.handleGetUsersStats))
	mux.Handle("GET /api/v1/admin/users", wrap(h.handleGetUsers))
	mux.Handle("POST /api/v1/admin/users", wrap(h.handleCreateUser))
	mux.Handle("GET /api/v1/admin/users/{id}", wrap(h.handleGetUser))
	mux.Handle("PATCH /api/v1/admin/users/{id}", wrap(h.handleUpdateUser))
	mux.Handle("DELETE /api/v1/admin/users/{id}", wrap(h.handleDeleteUser))

	// Policies
	mux.Handle("GET /api/v1/admin/policies", wrap(h.handleGetPolicies))
	mux.Handle("PUT /api/v1/admin/policies", wrap(h.handleUpdatePolicies))

	// Tickers
	mux.Handle("POST /api/v1/admin/tickers", wrap(h.handleAddTicker))
	mux.Handle("GET /api/v1/admin/tickers", wrap(h.handleGetTickers))
	mux.Handle("PUT /api/v1/admin/tickers/{id}", wrap(h.handleUpdateTicker))
	mux.Handle("DELETE /api/v1/admin/tickers/{id}", wrap(h.handleDeleteTicker))
	mux.Handle("GET /api/v1/admin/tickers/binance-info", wrap(h.handleBinanceTickerInfo))

	// Compressions
	mux.Handle("GET /api/v1/admin/compressions", wrap(h.handleGetCompressions))
	mux.Handle("PUT /api/v1/admin/compressions", wrap(h.handleUpsertCompressions))

	// Indicator defaults (Phase 15)
	mux.Handle("GET /api/v1/admin/indicator-defaults", wrap(h.handleGetIndicatorDefaults))
	mux.Handle("PUT /api/v1/admin/indicator-defaults", wrap(h.handlePutIndicatorDefaults))
	mux.Handle("DELETE /api/v1/admin/indicator-defaults", wrap(h.handleDeleteIndicatorDefaults))
	// Per-indicator merge/delete on the same admin-defaults table.
	mux.Handle("PATCH /api/v1/admin/indicator-defaults/indicator", wrap(h.handlePatchIndicatorDefaultIndicator))
	mux.Handle("DELETE /api/v1/admin/indicator-defaults/indicator", wrap(h.handleDeleteIndicatorDefaultIndicator))

	// History download
	mux.Handle("POST /api/v1/admin/history/download", wrap(h.handleStartDownload))
	mux.Handle("GET /api/v1/admin/history/jobs", wrap(h.handleGetJobs))
	mux.Handle("GET /api/v1/admin/history/jobs/{id}", wrap(h.handleGetJobStatus))
	mux.Handle("POST /api/v1/admin/history/clear-jobs", wrap(h.handleClearJobs))

	// Billing
	mux.Handle("GET /api/v1/admin/billing", wrap(h.handleGetBilling))
	mux.Handle("POST /api/v1/admin/billing", wrap(h.handleCreatePayment))
	mux.Handle("PUT /api/v1/admin/billing/{id}", wrap(h.handleUpdatePayment))
	mux.Handle("DELETE /api/v1/admin/billing/{id}", wrap(h.handleDeletePayment))

	// Site settings
	mux.Handle("PUT /api/v1/admin/site-settings", wrap(h.handleUpdateSiteSettings))
}

// RegisterPublicRoutes registers endpoints that are accessible without admin
// auth (used for plan-comparison cards visible to guests).
func (h *AdminHandler) RegisterPublicRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/tiers", h.handleGetPublicPolicies)
}

func (h *AdminHandler) handleGetPublicPolicies(w http.ResponseWriter, r *http.Request) {
	policies, err := GetPublicPolicies(h.db)
	if err != nil {
		log.Printf("[admin] get public policies error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to get tier policies")
		return
	}
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: policies})
}

// --- Tickers ---

func (h *AdminHandler) handleAddTicker(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Symbol             string  `json:"symbol"`
		Name               string  `json:"name"`
		PriceTickSpot      float64 `json:"priceTickSpot"`
		PriceTickFutures   float64 `json:"priceTickFutures"`
		CompressionSpot    int     `json:"compressionSpot"`
		CompressionFutures int     `json:"compressionFutures"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	t := &Ticker{
		Symbol:             strings.ToUpper(strings.TrimSpace(req.Symbol)),
		Name:               req.Name,
		PriceTickSpot:      req.PriceTickSpot,
		PriceTickFutures:   req.PriceTickFutures,
		CompressionSpot:    req.CompressionSpot,
		CompressionFutures: req.CompressionFutures,
		IsActive:           true,
	}

	if err := AddTicker(r.Context(), h.db, t); err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "already exists") {
			writeError(w, http.StatusConflict, "TICKER_EXISTS", errMsg)
		} else {
			writeError(w, http.StatusBadRequest, "INVALID_TICKER", errMsg)
		}
		return
	}

	if h.RefreshTickers != nil {
		h.RefreshTickers()
	}

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	LogAdminAction(r.Context(), h.db, userID, "add_ticker", t.Symbol, "", r.RemoteAddr)

	writeJSON(w, http.StatusCreated, adminResponse{OK: true, Data: t})
}

func (h *AdminHandler) handleGetTickers(w http.ResponseWriter, r *http.Request) {
	tickers, err := ListTickers(r.Context(), h.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to list tickers")
		return
	}
	if tickers == nil {
		tickers = []Ticker{}
	}
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: tickers})
}

func (h *AdminHandler) handleUpdateTicker(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ID", "ticker id is required")
		return
	}

	existing, err := GetTickerByID(r.Context(), h.db, id)
	if err != nil || existing == nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "ticker not found")
		return
	}

	var req struct {
		Symbol             *string  `json:"symbol"`
		Name               *string  `json:"name"`
		PriceTickSpot      *float64 `json:"priceTickSpot"`
		PriceTickFutures   *float64 `json:"priceTickFutures"`
		CompressionSpot    *int     `json:"compressionSpot"`
		CompressionFutures *int     `json:"compressionFutures"`
		IsActive           *bool    `json:"isActive"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	t := *existing
	if req.Symbol != nil {
		t.Symbol = strings.ToUpper(strings.TrimSpace(*req.Symbol))
	}
	if req.Name != nil {
		t.Name = *req.Name
	}
	if req.PriceTickSpot != nil {
		t.PriceTickSpot = *req.PriceTickSpot
	}
	if req.PriceTickFutures != nil {
		t.PriceTickFutures = *req.PriceTickFutures
	}
	if req.CompressionSpot != nil {
		t.CompressionSpot = *req.CompressionSpot
	}
	if req.CompressionFutures != nil {
		t.CompressionFutures = *req.CompressionFutures
	}
	if req.IsActive != nil {
		t.IsActive = *req.IsActive
	}

	if err := UpdateTicker(r.Context(), h.db, &t); err != nil {
		writeError(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
		return
	}

	if h.RefreshTickers != nil {
		h.RefreshTickers()
	}

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	LogAdminAction(r.Context(), h.db, userID, "update_ticker", t.Symbol, "", r.RemoteAddr)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: t})
}

func (h *AdminHandler) handleDeleteTicker(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ID", "ticker id is required")
		return
	}

	existing, err := GetTickerByID(r.Context(), h.db, id)
	if err != nil || existing == nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "ticker not found")
		return
	}

	if err := DeleteTicker(r.Context(), h.db, id); err != nil {
		writeError(w, http.StatusInternalServerError, "DELETE_FAILED", err.Error())
		return
	}

	if h.RefreshTickers != nil {
		h.RefreshTickers()
	}

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	LogAdminAction(r.Context(), h.db, userID, "delete_ticker", existing.Symbol, "", r.RemoteAddr)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"deleted": id}})
}

// handleBinanceTickerInfo fetches PRICE_FILTER tickSize for spot+futures from
// Binance public exchangeInfo APIs. Used by the admin "Подтянуть" button to
// auto-fill the tick fields in the Add-Ticker form; user can still override.
func (h *AdminHandler) handleBinanceTickerInfo(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("symbol")
	symbol := strings.ToUpper(strings.TrimSpace(raw))
	if symbol == "" {
		writeError(w, http.StatusBadRequest, "MISSING_SYMBOL", "symbol query parameter is required")
		return
	}
	if !symbolRe.MatchString(symbol) {
		writeError(w, http.StatusBadRequest, "INVALID_SYMBOL", "symbol must match ^[A-Z0-9]{2,10}$")
		return
	}

	info, err := binance.FetchTickSizes(r.Context(), symbol)
	if err != nil {
		log.Printf("[admin] binance ticker info %s: %v", symbol, err)
		writeError(w, http.StatusBadGateway, "BINANCE_UNAVAILABLE", "Binance API unreachable: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: info})
}

// --- Compressions ---

func (h *AdminHandler) handleGetCompressions(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeError(w, http.StatusBadRequest, "MISSING_SYMBOL", "symbol query parameter is required")
		return
	}

	symbol = strings.ToUpper(symbol)

	compressions, err := GetDefaultCompressions(r.Context(), h.db, symbol)
	if err != nil {
		log.Printf("[admin] get compressions error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to get compressions")
		return
	}

	if len(compressions) == 0 {
		ticker, err := GetTickerByID(r.Context(), h.db, symbol)
		if err != nil || ticker == nil {
			log.Printf("[admin] seed compressions: ticker %s not found (err=%v)", symbol, err)
			if compressions == nil {
				compressions = []DefaultCompression{}
			}
			writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: compressions})
			return
		}
		if err := SeedDefaultCompressionsForSymbol(r.Context(), h.db, symbol, ticker); err != nil {
			log.Printf("[admin] seed compressions for %s: %v", symbol, err)
		}
		compressions, err = GetDefaultCompressions(r.Context(), h.db, symbol)
		if err != nil {
			log.Printf("[admin] re-fetch compressions after seed: %v", err)
		}
	}

	if compressions == nil {
		compressions = []DefaultCompression{}
	}
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: compressions})
}

type upsertCompressionsRequest struct {
	Symbol       string               `json:"symbol"`
	Compressions []DefaultCompression `json:"compressions"`
}

func (h *AdminHandler) handleUpsertCompressions(w http.ResponseWriter, r *http.Request) {
	var req upsertCompressionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.Symbol == "" {
		writeError(w, http.StatusBadRequest, "MISSING_SYMBOL", "symbol is required")
		return
	}
	symbol := strings.ToUpper(req.Symbol)

	log.Printf("[admin] upsert compressions: symbol=%s count=%d", symbol, len(req.Compressions))
	for _, c := range req.Compressions {
		log.Printf("[admin]   %s/%s = %d", c.Market, c.Timeframe, c.Multiplier)
	}

	for _, c := range req.Compressions {
		if err := ValidateCompressionMultiplier(r.Context(), h.db, symbol, c.Market, c.Multiplier); err != nil {
			log.Printf("[admin] upsert compressions validation failed: %v", err)
			writeError(w, http.StatusBadRequest, "INVALID_MULTIPLIER", err.Error())
			return
		}
	}

	if err := UpsertDefaultCompressionsBatch(r.Context(), h.db, symbol, req.Compressions); err != nil {
		log.Printf("[admin] upsert compressions batch error: %v", err)
		writeError(w, http.StatusInternalServerError, "UPSERT_FAILED", err.Error())
		return
	}

	log.Printf("[admin] upsert compressions OK: %s, %d rows written", symbol, len(req.Compressions))

	if h.RefreshCompressions != nil {
		h.RefreshCompressions()
	}

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	LogAdminAction(r.Context(), h.db, userID, "upsert_compressions", symbol, "", r.RemoteAddr)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"symbol": symbol}})
}

// --- History Download ---

func (h *AdminHandler) handleStartDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Symbol    string `json:"symbol"`
		Market    string `json:"market"`
		StartDate string `json:"startDate"`
		EndDate   string `json:"endDate"`
		DataType  string `json:"dataType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.Symbol == "" || req.Market == "" || req.StartDate == "" || req.EndDate == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELDS", "symbol, market, startDate, endDate are required")
		return
	}

	if req.Market != "futures" && req.Market != "spot" {
		writeError(w, http.StatusBadRequest, "INVALID_MARKET", "market must be 'futures' or 'spot'")
		return
	}

	dataType := req.DataType
	if dataType == "" {
		dataType = "clusters"
	}
	if dataType != "clusters" && dataType != "bookDepth" && dataType != "longShortRatio" {
		writeError(w, http.StatusBadRequest, "INVALID_DATATYPE", "dataType must be 'clusters', 'bookDepth' or 'longShortRatio'")
		return
	}
	if dataType == "bookDepth" && req.Market != "futures" {
		writeError(w, http.StatusBadRequest, "INVALID_MARKET", "bookDepth доступен только для futures")
		return
	}
	if dataType == "longShortRatio" && req.Market != "futures" {
		writeError(w, http.StatusBadRequest, "INVALID_MARKET", "longShortRatio доступен только для futures")
		return
	}

	startDate, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", "startDate must be YYYY-MM-DD")
		return
	}
	endDate, err := time.Parse("2006-01-02", req.EndDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", "endDate must be YYYY-MM-DD")
		return
	}
	if endDate.Before(startDate) {
		writeError(w, http.StatusBadRequest, "INVALID_RANGE", "endDate must be >= startDate")
		return
	}

	// Get ticker config for compression
	ticker, err := GetTickerByID(r.Context(), h.db, req.Symbol)
	if err != nil || ticker == nil {
		// Try by symbol name
		tickers, _ := ListTickers(r.Context(), h.db)
		for _, t := range tickers {
			if strings.EqualFold(t.Symbol, req.Symbol) {
				ticker = &t
				break
			}
		}
	}
	if ticker == nil {
		writeError(w, http.StatusBadRequest, "TICKER_NOT_FOUND", "ticker not found: "+req.Symbol)
		return
	}

	var compConfig aggregation.CompressionConfig
	if req.Market == "futures" {
		compConfig = aggregation.CompressionConfig{
			Symbol:    ticker.Symbol,
			PriceTick: ticker.PriceTickFutures,
			BaseLevel: float64(ticker.CompressionFutures),
			MaxLevels: 10,
		}
	} else {
		compConfig = aggregation.CompressionConfig{
			Symbol:    ticker.Symbol,
			PriceTick: ticker.PriceTickSpot,
			BaseLevel: float64(ticker.CompressionSpot),
			MaxLevels: 10,
		}
	}

	job := h.jobRegistry.CreateJob(strings.ToUpper(req.Symbol), req.Market, req.StartDate, req.EndDate, dataType)

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	LogAdminAction(r.Context(), h.db, userID, "start_download", req.Symbol, dataType+" "+req.Market+" "+req.StartDate+"→"+req.EndDate, r.RemoteAddr)

	h.jobRegistry.StartDownload(h.chRepo, ticker.Symbol, compConfig, job)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"jobId": job.ID}})
}

func (h *AdminHandler) handleGetJobs(w http.ResponseWriter, r *http.Request) {
	jobs := h.jobRegistry.ListJobs()
	if jobs == nil {
		jobs = []*DownloadJob{}
	}
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: jobs})
}

func (h *AdminHandler) handleGetJobStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ID", "job id is required")
		return
	}

	job, ok := h.jobRegistry.GetJob(id)
	if !ok {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "job not found")
		return
	}

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: job})
}

func (h *AdminHandler) handleClearJobs(w http.ResponseWriter, r *http.Request) {
	h.jobRegistry.ClearJobs()
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: "cleared"})
}

// --- Users ---

func (h *AdminHandler) handleGetUsersStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	registered, err := h.getRegisteredCount(ctx)
	if err != nil {
		log.Printf("[admin] users stats: registered count error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to get registered count")
		return
	}

	onlineAuth, err := h.getOnlineCount(ctx)
	if err != nil {
		log.Printf("[admin] users stats: online auth error: %v", err)
		writeError(w, http.StatusInternalServerError, "REDIS_ERROR", "failed to get online auth count")
		return
	}

	uniqueGuests := h.getUniqueGuests(ctx)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]int64{
		"registered": registered,
		"onlineAuth": onlineAuth,
		"hosts":      uniqueGuests + onlineAuth,
	}})
}

func (h *AdminHandler) getUniqueGuests(ctx context.Context) int64 {
	if h.rdb == nil {
		return 0
	}
	var count int64
	var cursor uint64
	for {
		keys, nextCursor, err := h.rdb.Scan(ctx, cursor, "guest:online:*", 100).Result()
		if err != nil {
			log.Printf("[admin] scan guest:online error: %v", err)
			return count
		}
		count += int64(len(keys))
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	return count
}

func (h *AdminHandler) handleGetUsers(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		parsed, err := strconv.Atoi(l)
		if err != nil || parsed < 1 || parsed > 200 {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "limit must be 1-200")
			return
		}
		limit = parsed
	}

	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		parsed, err := strconv.Atoi(o)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "offset must be >= 0")
			return
		}
		offset = parsed
	}

	users, err := ListUsers(r.Context(), h.db, limit, offset)
	if err != nil {
		log.Printf("[admin] list users error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to list users")
		return
	}

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]interface{}{
		"users":  users,
		"limit":  limit,
		"offset": offset,
	}})
}

func (h *AdminHandler) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Login    string `json:"login"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	req.Login = strings.TrimSpace(req.Login)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Role = strings.TrimSpace(strings.ToLower(req.Role))

	if req.Login == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "login is required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "password must be at least 8 characters")
		return
	}
	if req.Role == "guest" {
		writeError(w, http.StatusBadRequest, "INVALID_ROLE", "guest role cannot be assigned")
		return
	}
	if !validRoles[req.Role] {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", fmt.Sprintf("role must be one of: free, pro, vip, admin"))
		return
	}

	// Check nickname uniqueness
	existingNick, _ := auth.GetUserByNickname(r.Context(), h.db, req.Login)
	if existingNick != nil {
		writeError(w, http.StatusConflict, "LOGIN_EXISTS", "user with this nickname already exists")
		return
	}

	// Check email uniqueness if provided (and not a placeholder)
	if req.Email != "" && !strings.Contains(req.Email, "@placeholder.local") {
		existingEmail, _ := auth.GetUserByEmail(r.Context(), h.db, req.Email)
		if existingEmail != nil {
			writeError(w, http.StatusConflict, "USER_EXISTS", "user with this email already exists")
			return
		}
	}

	user, err := CreateUserByAdmin(r.Context(), h.db, req.Login, req.Password, req.Role, req.Email)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "UNIQUE") || strings.Contains(errMsg, "unique") {
			if strings.Contains(errMsg, "nickname") || strings.Contains(errMsg, "idx_users_nickname") {
				writeError(w, http.StatusConflict, "LOGIN_EXISTS", "user with this nickname already exists")
			} else {
				writeError(w, http.StatusConflict, "USER_EXISTS", "user with this email already exists")
			}
			return
		}
		log.Printf("[admin] create user error: %v", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create user")
		return
	}

	adminID, _ := r.Context().Value(auth.UserIDKey).(string)
	target := req.Login
	if req.Email != "" {
		target = req.Login + " <" + req.Email + ">"
	}
	LogAdminAction(r.Context(), h.db, adminID, "user.create", target, "", r.RemoteAddr)

	writeJSON(w, http.StatusCreated, adminResponse{OK: true, Data: map[string]string{
		"id":    user.ID,
		"login": user.Nickname,
		"email": user.Email,
		"role":  user.Role,
	}})
}

func (h *AdminHandler) handleGetUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ID", "user id is required")
		return
	}

	user, err := auth.GetUserByID(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]interface{}{
		"id":        user.ID,
		"login":     user.Nickname,
		"email":     user.Email,
		"role":      user.Role,
		"createdAt": user.CreatedAt.Format(time.RFC3339),
	}})
}

func (h *AdminHandler) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ID", "user id is required")
		return
	}

	var req struct {
		Role *string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.Role == nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "role is required")
		return
	}

	newRole := strings.TrimSpace(strings.ToLower(*req.Role))
	if newRole == "guest" {
		writeError(w, http.StatusBadRequest, "INVALID_ROLE", "guest role cannot be assigned")
		return
	}
	if !validRoles[newRole] {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", fmt.Sprintf("role must be one of: free, pro, vip, admin"))
		return
	}

	existing, err := auth.GetUserByID(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}

	oldRole := existing.Role
	if oldRole == newRole {
		writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{
			"id":      id,
			"email":   existing.Email,
			"oldRole": oldRole,
			"newRole": newRole,
		}})
		return
	}

	if err := UpdateUserRole(r.Context(), h.db, id, newRole); err != nil {
		log.Printf("[admin] update user role error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to update user role")
		return
	}

	adminID, _ := r.Context().Value(auth.UserIDKey).(string)
	detail := fmt.Sprintf("%s->%s", oldRole, newRole)
	LogAdminAction(r.Context(), h.db, adminID, "user.update_role", existing.Email, detail, r.RemoteAddr)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{
		"id":      id,
		"email":   existing.Email,
		"oldRole": oldRole,
		"newRole": newRole,
	}})
}

func (h *AdminHandler) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ID", "user id is required")
		return
	}

	adminID, _ := r.Context().Value(auth.UserIDKey).(string)
	if adminID == id {
		writeError(w, http.StatusBadRequest, "SELF_DELETE", "cannot delete your own account")
		return
	}

	email, err := GetUserEmailByID(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}

	if err := DeleteUserByID(r.Context(), h.db, id); err != nil {
		log.Printf("[admin] delete user error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to delete user")
		return
	}

	if h.rdb != nil {
		if err := h.rdb.Del(r.Context(), "chart_sessions:"+id).Err(); err != nil {
			log.Printf("[admin] delete user sessions from redis: %v", err)
		}
	}

	LogAdminAction(r.Context(), h.db, adminID, "user.delete", email, "", r.RemoteAddr)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"deleted": id}})
}

func (h *AdminHandler) handleGetPolicies(w http.ResponseWriter, r *http.Request) {
	policies, err := GetPolicies(h.db)
	if err != nil {
		log.Printf("[admin] get policies error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to get tier policies")
		return
	}
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: policies})
}

func (h *AdminHandler) handleUpdatePolicies(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Policies map[string]TierPolicy `json:"policies"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	validTiers := map[string]bool{"guest": true, "free": true, "pro": true, "vip": true, "admin": true}
	validTFs := map[string]bool{"1m": true, "5m": true, "15m": true, "30m": true, "1h": true, "4h": true}

	for tier, p := range req.Policies {
		if !validTiers[tier] {
			writeError(w, http.StatusBadRequest, "INVALID_TIER", fmt.Sprintf("invalid tier: %s", tier))
			return
		}
		if p.Tier != tier {
			p.Tier = tier
			req.Policies[tier] = p
		}
		if p.CompressionMax < 1 || p.CompressionMax > 10 {
			writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("compression_max must be 1..10 for tier %s", tier))
			return
		}
		if p.SessionLimit < -1 {
			writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("session_limit must be >= -1 for tier %s", tier))
			return
		}
		if p.MaxIndicators < 0 {
			writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("max_indicators must be >= 0 for tier %s", tier))
			return
		}
		if p.CustomIndicatorSettings != 0 && p.CustomIndicatorSettings != 1 {
			writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("custom_indicator_settings must be 0 or 1 for tier %s", tier))
			return
		}
		if p.TelegramEnabled != 0 && p.TelegramEnabled != 1 {
			writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("telegram_enabled must be 0 or 1 for tier %s", tier))
			return
		}
		if p.WorkspacesCount < 1 || p.WorkspacesCount > 2 {
			writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("workspaces_count must be 1 or 2 for tier %s", tier))
			return
		}
		if p.AnomaliesEnabled != 0 && p.AnomaliesEnabled != 1 {
			writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("anomalies_enabled must be 0 or 1 for tier %s", tier))
			return
		}
		if p.HistoryDaysPerTf == nil {
			p.HistoryDaysPerTf = map[string]int{"1m": 1, "5m": 1, "15m": 1, "30m": 1, "1h": 1, "4h": 1}
			req.Policies[tier] = p
		}
		for tf, days := range p.HistoryDaysPerTf {
			if !validTFs[tf] {
				writeError(w, http.StatusBadRequest, "INVALID_TF", fmt.Sprintf("invalid timeframe %s for tier %s", tf, tier))
				return
			}
			if days < -1 {
				writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("history_days_per_tf[%s] must be >= -1 for tier %s (-1 = unlimited)", tf, tier))
				return
			}
		}
		if p.HistoryMaxDays < -1 {
			writeError(w, http.StatusBadRequest, "INVALID_RANGE", fmt.Sprintf("history_max_days must be >= -1 for tier %s", tier))
			return
		}
	}

	if err := UpsertPolicies(h.db, req.Policies); err != nil {
		log.Printf("[admin] upsert policies error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to save tier policies")
		return
	}

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	LogAdminAction(r.Context(), h.db, userID, "update_policies", "", "", r.RemoteAddr)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "saved"}})
}

func (h *AdminHandler) handleGetBilling(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_billing_phase4"}})
}

func (h *AdminHandler) handleCreatePayment(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_create_payment_phase4"}})
}

func (h *AdminHandler) handleUpdatePayment(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_update_payment_phase4"}})
}

func (h *AdminHandler) handleDeletePayment(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_delete_payment_phase4"}})
}

func (h *AdminHandler) handleUpdateSiteSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BetaMode *bool `json:"betaMode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if req.BetaMode == nil {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "betaMode is required")
		return
	}

	if err := SetBetaMode(h.db, *req.BetaMode); err != nil {
		log.Printf("[admin] set beta_mode error: %v", err)
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "failed to update beta_mode")
		return
	}

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	detail := "beta_mode=false"
	if *req.BetaMode {
		detail = "beta_mode=true"
	}
	LogAdminAction(r.Context(), h.db, userID, "site_settings.beta_mode", "beta_mode", detail, r.RemoteAddr)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]bool{"betaMode": *req.BetaMode}})
}
