package api

import (
	"context"
	"log"
	"net/http"
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
	activeTickers         []admin.Ticker
}

func (s *Server) SetTierHistoryLimits(m map[string]time.Duration) {
	s.tierHistoryLimits = m
}

func (s *Server) SetTierCompressionLocked(m map[string]bool) {
	s.tierCompressionLocked = m
}

func (s *Server) SetActiveTickers(tickers []admin.Ticker) {
	s.activeTickers = tickers
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

	mux.Handle("GET /api/v1/candles", RateLimitMiddleware(restLimiter, withMiddleware(rdb, authCfg, candlesHandler)))
	mux.Handle("GET /api/v1/candles/{symbol}/clusters/{candleOpen}", RateLimitMiddleware(restLimiter, withMiddleware(rdb, authCfg, clusterHandler)))
	mux.Handle("GET /api/v1/candles/{symbol}/clusters-batch", RateLimitMiddleware(restLimiter, withMiddleware(rdb, authCfg, clustersBatchHandler)))
	mux.Handle("GET /api/v1/fng", RateLimitMiddleware(restLimiter, withMiddleware(rdb, authCfg, http.HandlerFunc(s.handleFNG))))
	mux.Handle("GET /api/v1/tickers", withMiddleware(rdb, authCfg, http.HandlerFunc(s.handleGetTickers)))
	mux.Handle("GET /ws", WSRateLimitMiddleware(wsLimiter, withMiddleware(rdb, authCfg, wsHandler)))

	s.httpServer = &http.Server{
		Addr:         cfg.Addr,
		Handler:      mux,
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
