// Package openinterest содержит live-поллер открытого интереса фьючерсов Binance.
// Тянет данные с публичного futures-data эндпоинта openInterestHist на
// 5-минутной сетке и пишет их в ClickHouse через repository-интерфейс.
package openinterest

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/procluster/procluster/internal/config"
	"github.com/procluster/procluster/internal/model"
	"github.com/procluster/procluster/internal/repository"
)

const (
	binanceOIURL = "https://fapi.binance.com/futures/data/openInterestHist"
	pollPeriod   = "5m"
	pollLimit    = 30 // закрывает дыры после рестарта (30 * 5m = 2.5ч истории)
	pollInterval = 5 * time.Minute
	httpTimeout  = 10 * time.Second
)

// binanceOIEntry — один элемент JSON-ответа openInterestHist. Значения приходят
// строками; берём открытый интерес в контрактах и в USD плюс timestamp (ms).
type binanceOIEntry struct {
	Symbol               string `json:"symbol"`
	SumOpenInterest      string `json:"sumOpenInterest"`
	SumOpenInterestValue string `json:"sumOpenInterestValue"`
	Timestamp            int64  `json:"timestamp"`
}

// Poller периодически опрашивает Binance и пишет точки в open_interest.
type Poller struct {
	repo    repository.MarketRepository
	symbols []string
	client  *http.Client
}

// NewPoller собирает список уникальных futures-символов из той же конфигурации,
// что использует snapshotter (НЕ хардкод). HTTP-клиент — с таймаутом и
// прокси из окружения (DefaultTransport).
func NewPoller(repo repository.MarketRepository, configs map[string]config.SymbolConfig) *Poller {
	seen := make(map[string]struct{})
	var symbols []string
	for _, sc := range configs {
		if sc.Market != "futures" {
			continue
		}
		if _, ok := seen[sc.Symbol]; ok {
			continue
		}
		seen[sc.Symbol] = struct{}{}
		symbols = append(symbols, sc.Symbol)
	}
	return &Poller{
		repo:    repo,
		symbols: symbols,
		client:  &http.Client{Timeout: httpTimeout},
	}
}

// Run опрашивает Binance сразу при старте, затем раз в 5 минут до отмены ctx.
// Ошибки сети/HTTP логируются и не прерывают цикл (Binance может быть недоступен
// в dev-окружении).
func (p *Poller) Run(ctx context.Context) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	p.pollAll(ctx) // первичная заливка на старте

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.pollAll(ctx)
		}
	}
}

func (p *Poller) pollAll(ctx context.Context) {
	for _, symbol := range p.symbols {
		if ctx.Err() != nil {
			return
		}
		if err := p.pollSymbol(ctx, symbol); err != nil {
			log.Printf("[openinterest] poll %s error: %v", symbol, err)
		}
	}
}

func (p *Poller) pollSymbol(ctx context.Context, symbol string) error {
	q := url.Values{}
	q.Set("symbol", symbol)
	q.Set("period", pollPeriod)
	q.Set("limit", strconv.Itoa(pollLimit))
	reqURL := binanceOIURL + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("binance status %d", resp.StatusCode)
	}

	var entries []binanceOIEntry
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}

	rows := make([]model.OpenInterest, 0, len(entries))
	for _, e := range entries {
		oi, err := strconv.ParseFloat(e.SumOpenInterest, 64)
		if err != nil {
			log.Printf("[openinterest] bad sumOpenInterest %q for %s: %v", e.SumOpenInterest, symbol, err)
			continue
		}
		oiValue, err := strconv.ParseFloat(e.SumOpenInterestValue, 64)
		if err != nil {
			log.Printf("[openinterest] bad sumOpenInterestValue %q for %s: %v", e.SumOpenInterestValue, symbol, err)
			continue
		}
		rows = append(rows, model.OpenInterest{
			Symbol:               symbol,
			Market:               "futures",
			TS:                   time.UnixMilli(e.Timestamp),
			SumOpenInterest:      oi,
			SumOpenInterestValue: oiValue,
		})
	}

	if len(rows) == 0 {
		return nil
	}

	if err := p.repo.InsertOpenInterestBatch(ctx, rows); err != nil {
		return fmt.Errorf("insert batch: %w", err)
	}
	return nil
}
