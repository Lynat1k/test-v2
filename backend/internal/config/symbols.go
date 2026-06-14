package config

import (
	"fmt"
	"time"

	"github.com/procluster/procluster/internal/aggregation"
)

type SymbolConfig struct {
	Symbol       string
	Market       string
	PriceTick    float64
	BaseLevel    float64
	SnapInterval time.Duration
}

func (sc SymbolConfig) CompressionConfig() aggregation.CompressionConfig {
	return aggregation.CompressionConfig{
		Symbol:    sc.Symbol,
		PriceTick: sc.PriceTick,
		BaseLevel: sc.BaseLevel,
		MaxLevels: 10,
	}
}

func (sc SymbolConfig) DOMTable() string {
	if sc.Market == "spot" {
		return "clusters_spot_dom"
	}
	return "clusters_futures_dom"
}

func (sc SymbolConfig) Key() string {
	return fmt.Sprintf("%s:%s", sc.Symbol, sc.Market)
}

var DefaultSymbols = []SymbolConfig{
	{Symbol: "BTCUSDT", Market: "futures", PriceTick: 0.1, BaseLevel: 25, SnapInterval: time.Minute},
	{Symbol: "BTCUSDT", Market: "spot", PriceTick: 0.01, BaseLevel: 500, SnapInterval: 15 * time.Minute},
}

func SymbolMap() map[string]SymbolConfig {
	m := make(map[string]SymbolConfig, len(DefaultSymbols))
	for _, sc := range DefaultSymbols {
		m[sc.Key()] = sc
	}
	return m
}
