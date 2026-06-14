package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"sync"
	"time"

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

func (h *AdminHandler) handleAddTicker(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_add_ticker_phase3"}})
}

func (h *AdminHandler) handleGetTickers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_tickers_phase3"}})
}

func (h *AdminHandler) handleUpdateTicker(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_update_ticker_phase3"}})
}

func (h *AdminHandler) handleDeleteTicker(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_delete_ticker_phase3"}})
}

func (h *AdminHandler) handleStartDownload(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_download_phase3"}})
}

func (h *AdminHandler) handleGetJobs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_jobs_phase3"}})
}

func (h *AdminHandler) handleGetJobStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminResponse{OK: true, Data: map[string]string{"status": "stub_job_status_phase3"}})
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
