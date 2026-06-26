// Package binance provides lightweight Binance public REST helpers used by
// the admin panel. It is NOT a full SDK — only what the panel needs.
package binance

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// TickInfo carries the PRICE_FILTER tickSize for spot and USD-M futures.
// *Found is false when the symbol exists on Binance but not on that market
// (e.g. listed on spot but not on futures, or vice versa). It is also false
// when the whole request succeeded but the symbol was not present at all.
type TickInfo struct {
	SpotTick     float64 `json:"spotTick"`
	SpotFound    bool    `json:"spotFound"`
	FuturesTick  float64 `json:"futuresTick"`
	FuturesFound bool    `json:"futuresFound"`
}

type filterEntry struct {
	FilterType string `json:"filterType"`
	TickSize   string `json:"tickSize"`
}

type symbolEntry struct {
	Symbol  string        `json:"symbol"`
	Filters []filterEntry `json:"filters"`
}

type exchangeInfoResp struct {
	Symbols []symbolEntry `json:"symbols"`
}

func newClient() *http.Client {
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		ResponseHeaderTimeout: 8 * time.Second,
	}
	return &http.Client{
		Transport: tr,
		Timeout:   10 * time.Second,
	}
}

func extractPriceTick(filters []filterEntry) (float64, bool) {
	for _, f := range filters {
		if f.FilterType != "PRICE_FILTER" {
			continue
		}
		v, err := strconv.ParseFloat(strings.TrimSpace(f.TickSize), 64)
		if err != nil || v <= 0 {
			return 0, false
		}
		return v, true
	}
	return 0, false
}

// fetchSpot calls SPOT exchangeInfo with ?symbol= query. Returns (tick, found, err).
// Found=false means the symbol is not listed on spot (HTTP 400 from Binance or
// empty symbols array). err is non-nil only on transport/parse failures.
func fetchSpot(ctx context.Context, client *http.Client, symbol string) (float64, bool, error) {
	u := "https://api.binance.com/api/v3/exchangeInfo?symbol=" + symbol
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, false, fmt.Errorf("spot request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, false, fmt.Errorf("spot do: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, false, fmt.Errorf("spot read: %w", err)
	}

	// Binance returns 400 with {"code":-1121,"msg":"Invalid symbol."} when
	// the symbol does not exist on spot. Treat as "not found", not as error.
	if resp.StatusCode == http.StatusBadRequest {
		return 0, false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return 0, false, fmt.Errorf("spot status %d: %s", resp.StatusCode, string(body))
	}

	var r exchangeInfoResp
	if err := json.Unmarshal(body, &r); err != nil {
		return 0, false, fmt.Errorf("spot decode: %w", err)
	}
	if len(r.Symbols) == 0 {
		return 0, false, nil
	}
	tick, ok := extractPriceTick(r.Symbols[0].Filters)
	if !ok {
		return 0, false, nil
	}
	return tick, true, nil
}

// fetchFutures pulls the full USD-M exchangeInfo (~1-2 MB) and scans for the
// symbol. The futures endpoint ignores ?symbol=, so we filter client-side.
func fetchFutures(ctx context.Context, client *http.Client, symbol string) (float64, bool, error) {
	u := "https://fapi.binance.com/fapi/v1/exchangeInfo"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, false, fmt.Errorf("futures request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, false, fmt.Errorf("futures do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return 0, false, fmt.Errorf("futures status %d: %s", resp.StatusCode, string(body))
	}

	var r exchangeInfoResp
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&r); err != nil {
		return 0, false, fmt.Errorf("futures decode: %w", err)
	}
	for _, s := range r.Symbols {
		if strings.EqualFold(s.Symbol, symbol) {
			tick, ok := extractPriceTick(s.Filters)
			if !ok {
				return 0, false, nil
			}
			return tick, true, nil
		}
	}
	return 0, false, nil
}

// FetchTickSizes queries Binance spot and USD-M futures exchangeInfo for the
// PRICE_FILTER tickSize of symbol. The two requests run sequentially because
// the futures payload is large and we don't want to hold both responses in
// memory at once.
//
// If both requests fail at the network/parse layer, an error is returned. If
// at least one succeeds, the returned TickInfo carries what we managed to
// learn; markets where the symbol is simply absent are reported as
// *Found=false without an error.
func FetchTickSizes(ctx context.Context, symbol string) (TickInfo, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return TickInfo{}, fmt.Errorf("symbol is required")
	}

	client := newClient()
	info := TickInfo{}

	spotTick, spotOK, spotErr := fetchSpot(ctx, client, symbol)
	if spotErr == nil {
		info.SpotTick = spotTick
		info.SpotFound = spotOK
	}

	futTick, futOK, futErr := fetchFutures(ctx, client, symbol)
	if futErr == nil {
		info.FuturesTick = futTick
		info.FuturesFound = futOK
	}

	if spotErr != nil && futErr != nil {
		return TickInfo{}, fmt.Errorf("both binance markets failed: spot=%v futures=%v", spotErr, futErr)
	}
	return info, nil
}
