package api

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/procluster/procluster/internal/admin"
	"github.com/procluster/procluster/internal/aggregator"
	"github.com/procluster/procluster/internal/auth"
	"github.com/procluster/procluster/internal/cache"
	"github.com/procluster/procluster/internal/fng"
	"github.com/procluster/procluster/internal/repository"
	"github.com/redis/go-redis/v9"
)

type Server struct {
	httpServer            *http.Server
	hub                   *Hub
	repo                  repository.MarketRepository
	cache                 *cache.CandleCache
	agg                   *aggregator.Aggregator
	sessionManager        *SessionManager
	fngFetcher            *fng.FNGFetcher
	cfg                   ServerConfig
	authCfg               auth.AuthConfig
	mux                   *http.ServeMux
	rdb                   *redis.Client
	tierHistoryLimits     map[string]time.Duration
	tierCompressionLocked map[string]bool
	tickersMu             sync.RWMutex // guards activeTickers (set at startup AND at runtime via admin)
	activeTickers         []admin.Ticker
	comprMu               sync.RWMutex
	activeCompressions    map[string][]admin.DefaultCompression // key: symbol — guarded by comprMu
	betaEnabled           func() bool
}

func (s *Server) SetTierHistoryLimits(m map[string]time.Duration) {
	s.tierHistoryLimits = m
}

func (s *Server) SetTierCompressionLocked(m map[string]bool) {
	s.tierCompressionLocked = m
}

func (s *Server) SetActiveTickers(tickers []admin.Ticker) {
	s.tickersMu.Lock()
	s.activeTickers = tickers
	s.tickersMu.Unlock()
}

func (s *Server) SetDefaultCompressions(compressions []admin.DefaultCompression) {
	m := make(map[string][]admin.DefaultCompression, len(compressions))
	for _, c := range compressions {
		m[c.Symbol] = append(m[c.Symbol], c)
	}
	s.comprMu.Lock()
	s.activeCompressions = m
	s.comprMu.Unlock()
}

func (s *Server) SetBetaEnabled(fn func() bool) {
	s.betaEnabled = fn
}

type ServerConfig struct {
	Addr         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

func DefaultServerConfig() ServerConfig {
	return ServerConfig{
		Addr:         ":8080",
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
}

func NewServer(
	repo repository.MarketRepository,
	c *cache.CandleCache,
	agg *aggregator.Aggregator,
	sm *SessionManager,
	cfg ServerConfig,
	restLimiter *RateLimiter,
	wsLimiter *RateLimiter,
	fngFetcher *fng.FNGFetcher,
	authCfg auth.AuthConfig,
	rdb *redis.Client,
) *Server {
	hub := NewHub()
	mux := http.NewServeMux()

	s := &Server{
		repo:           repo,
		cache:          c,
		agg:            agg,
		sessionManager: sm,
		hub:            hub,
		fngFetcher:     fngFetcher,
		cfg:            cfg,
		authCfg:        authCfg,
		mux:            mux,
		rdb:            rdb,
	}

	candlesHandler := http.HandlerFunc(s.handleCandles)
	clusterHandler := http.HandlerFunc(s.handleClusters)
	clustersBatchHandler := http.HandlerFunc(s.handleClustersBatch)
	wsHandler := http.HandlerFunc(s.handleWebSocket)

	betaEnabledFn := func() bool {
		if s.betaEnabled != nil {
			return s.betaEnabled()
		}
		return false
	}
	betaGate := auth.BetaGate(authCfg, betaEnabledFn)

	bookDepthRatioHandler := http.HandlerFunc(s.handleBookDepthRatio)
	longShortRatioHandler := http.HandlerFunc(s.handleLongShortRatio)

	mux.Handle("GET /api/v1/candles", RateLimitMiddleware(restLimiter, betaGate(withMiddleware(rdb, authCfg, candlesHandler))))
	mux.Handle("GET /api/v1/bookdepth-ratio", RateLimitMiddleware(restLimiter, betaGate(withMiddleware(rdb, authCfg, bookDepthRatioHandler))))
	mux.Handle("GET /api/v1/long-short-ratio", RateLimitMiddleware(restLimiter, betaGate(withMiddleware(rdb, authCfg, longShortRatioHandler))))
	mux.Handle("GET /api/v1/candles/{symbol}/clusters/{candleOpen}", RateLimitMiddleware(restLimiter, betaGate(withMiddleware(rdb, authCfg, clusterHandler))))
	mux.Handle("GET /api/v1/candles/{symbol}/clusters-batch", RateLimitMiddleware(restLimiter, betaGate(withMiddleware(rdb, authCfg, clustersBatchHandler))))
	mux.Handle("GET /api/v1/fng", RateLimitMiddleware(restLimiter, betaGate(withMiddleware(rdb, authCfg, http.HandlerFunc(s.handleFNG)))))
	mux.Handle("GET /api/v1/tickers", betaGate(withMiddleware(rdb, authCfg, http.HandlerFunc(s.handleGetTickers))))
	mux.Handle("GET /api/v1/compressions", betaGate(withMiddleware(rdb, authCfg, http.HandlerFunc(s.handleGetPublicCompressions))))
	mux.Handle("GET /ws", WSRateLimitMiddleware(wsLimiter, betaGate(withMiddleware(rdb, authCfg, wsHandler))))

	mux.Handle("GET /api/v1/site-settings", withMiddleware(rdb, authCfg, http.HandlerFunc(s.handleGetSiteSettings)))

	s.httpServer = &http.Server{
		Addr:         cfg.Addr,
		Handler:      gzipMiddleware(mux),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
	}

	return s
}

func (s *Server) ListenAndServe() error {
	log.Printf("[api] listening on %s", s.cfg.Addr)
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.hub.Shutdown()
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) Hub() *Hub {
	return s.hub
}

func (s *Server) Mux() *http.ServeMux {
	return s.mux
}

// gzipWriterPool reuses gzip.Writer instances across requests (hot-path: no extra allocs).
var gzipWriterPool = sync.Pool{
	New: func() interface{} { return gzip.NewWriter(nil) },
}

// gzipResponseWriter оборачивает http.ResponseWriter и пишет тело через gzip.
// gzip.Writer создаётся лениво — на первый Write. Если тела нет (например 204 на
// OPTIONS), сжатие не стартует и лишних байт в ответ не попадает.
type gzipResponseWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	if w.gz == nil {
		w.gz = gzipWriterPool.Get().(*gzip.Writer)
		w.gz.Reset(w.ResponseWriter)
	}
	return w.gz.Write(b)
}

// close завершает gzip-поток (flush+close) и возвращает writer в пул.
// Безопасен, если сжатие так и не стартовало.
func (w *gzipResponseWriter) close() {
	if w.gz != nil {
		w.gz.Close()
		gzipWriterPool.Put(w.gz)
		w.gz = nil
	}
}

// gzipMiddleware сжимает gzip-ом все ответы /api (тяжёлые JSON: clusters-batch до ~2.9МБ).
// Только транспорт, на данные не влияет (lossless).
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// WebSocket НЕ сжимаем: gzip ломает upgrade-хендшейк (соединение хайджекается).
		if r.URL.Path == "/ws" || strings.HasPrefix(r.URL.Path, "/ws/") {
			next.ServeHTTP(w, r)
			return
		}
		// Клиент не умеет gzip — отдаём как есть (passthrough, ничего не меняем).
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")
		// Content-Length до сжатия неверен — убираем (chunked transfer).
		w.Header().Del("Content-Length")

		gzw := &gzipResponseWriter{ResponseWriter: w}
		defer gzw.close()
		next.ServeHTTP(gzw, r)
	})
}

func withMiddleware(rdb *redis.Client, authCfg auth.AuthConfig, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		origin := r.Header.Get("Origin")
		if origin == "https://chart.procluster.online" || origin == "https://procluster.online" || origin == "http://localhost:5173" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if rdb != nil {
			trackGuest(rdb, authCfg, w, r)
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleGetSiteSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]bool{
		"betaMode": admin.BetaModeEnabled(),
	})
}
