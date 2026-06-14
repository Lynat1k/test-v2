package admin

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/auth"
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
	mux.Handle("GET /api/v1/admin/users", wrap(h.handleGetUsers))
	mux.Handle("GET /api/v1/admin/users/{id}", wrap(h.handleGetUser))
	mux.Handle("PUT /api/v1/admin/users/{id}", wrap(h.handleUpdateUser))
	mux.Handle("DELETE /api/v1/admin/users/{id}", wrap(h.handleDeleteUser))

	// Policies
	mux.Handle("GET /api/v1/admin/policies", wrap(h.handleGetPolicies))
	mux.Handle("PUT /api/v1/admin/policies", wrap(h.handleUpdatePolicies))

	// Tickers
	mux.Handle("POST /api/v1/admin/tickers", wrap(h.handleAddTicker))
	mux.Handle("GET /api/v1/admin/tickers", wrap(h.handleGetTickers))
	mux.Handle("PUT /api/v1/admin/tickers/{id}", wrap(h.handleUpdateTicker))
	mux.Handle("DELETE /api/v1/admin/tickers/{id}", wrap(h.handleDeleteTicker))

	// Compressions
	mux.Handle("GET /api/v1/admin/compressions", wrap(h.handleGetCompressions))
	mux.Handle("PUT /api/v1/admin/compressions", wrap(h.handleUpsertCompressions))

	// History download
	mux.Handle("POST /api/v1/admin/history/download", wrap(h.handleStartDownload))
	mux.Handle("GET /api/v1/admin/history/jobs", wrap(h.handleGetJobs))
	mux.Handle("GET /api/v1/admin/history/jobs/{id}", wrap(h.handleGetJobStatus))

	// Billing
	mux.Handle("GET /api/v1/admin/billing", wrap(h.handleGetBilling))
	mux.Handle("POST /api/v1/admin/billing", wrap(h.handleCreatePayment))
	mux.Handle("PUT /api/v1/admin/billing/{id}", wrap(h.handleUpdatePayment))
	mux.Handle("DELETE /api/v1/admin/billing/{id}", wrap(h.handleDeletePayment))
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

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	LogAdminAction(r.Context(), h.db, userID, "delete_ticker", existing.Symbol, "", r.RemoteAddr)

	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"deleted": id}})
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

	job := h.jobRegistry.CreateJob(strings.ToUpper(req.Symbol), req.Market, req.StartDate, req.EndDate)

	userID, _ := r.Context().Value(auth.UserIDKey).(string)
	LogAdminAction(r.Context(), h.db, userID, "start_download", req.Symbol, req.Market+" "+req.StartDate+"→"+req.EndDate, r.RemoteAddr)

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

// --- Stubs (to be implemented in subsequent phases) ---

func (h *AdminHandler) handleGetUsers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_users_phase2"}})
}

func (h *AdminHandler) handleGetUser(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_user_phase2"}})
}

func (h *AdminHandler) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_update_user_phase2"}})
}

func (h *AdminHandler) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_delete_user_phase2"}})
}

func (h *AdminHandler) handleGetPolicies(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_policies_phase2"}})
}

func (h *AdminHandler) handleUpdatePolicies(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_update_policies_phase2"}})
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
