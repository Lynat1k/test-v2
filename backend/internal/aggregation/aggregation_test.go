package aggregation

import (
	"testing"

	"github.com/procluster/procluster/internal/model"
)

func TestTruncateVolume(t *testing.T) {
	tests := []struct {
		input    float64
		expected float64
	}{
		{0.0125, 0.0},
		{0.85, 0.8},
		{5.625, 5.6},
		{5.1256, 5.1},
		{1.0, 1.0},
		{0.0, 0.0},
		{-0.85, -0.8},
		{-5.625, -5.6},
	}

	for _, tt := range tests {
		result := TruncateVolume(tt.input)
		if result != tt.expected {
			t.Errorf("TruncateVolume(%v) = %v, want %v", tt.input, result, tt.expected)
		}
	}
}

func TestCompressPrice(t *testing.T) {
	tests := []struct {
		price    float64
		base     float64
		expected float64
	}{
		{100.5, 2.5, 100.0},
		{102.4, 2.5, 100.0},
		{102.5, 2.5, 102.5},
		{50.01, 5.0, 50.0},
		{54.99, 5.0, 50.0},
		{55.0, 5.0, 55.0},
	}

	for _, tt := range tests {
		result := CompressPrice(tt.price, tt.base)
		if result != tt.expected {
			t.Errorf("CompressPrice(%v, %v) = %v, want %v", tt.price, tt.base, result, tt.expected)
		}
	}
}

func TestGenerateLevels(t *testing.T) {
	levels := GenerateLevels(25, 10)
	expected := []float64{25, 50, 75, 100, 125, 150, 175, 200, 225, 250}

	if len(levels) != len(expected) {
		t.Fatalf("GenerateLevels returned %d levels, want %d", len(levels), len(expected))
	}

	for i, v := range levels {
		if v != expected[i] {
			t.Errorf("GenerateLevels[%d] = %v, want %v", i, v, expected[i])
		}
	}
}

func TestInterpretTrade(t *testing.T) {
	if InterpretTrade(true) != model.SideSell {
		t.Error("InterpretTrade(true) should be SELL")
	}
	if InterpretTrade(false) != model.SideBuy {
		t.Error("InterpretTrade(false) should be BUY")
	}
}

func TestSortByTradeId(t *testing.T) {
	trades := []model.Trade{
		{TradeID: 3},
		{TradeID: 1},
		{TradeID: 2},
	}
	SortByTradeId(trades)
	for i := 0; i < len(trades)-1; i++ {
		if trades[i].TradeID > trades[i+1].TradeID {
			t.Errorf("trades not sorted: %d > %d", trades[i].TradeID, trades[i+1].TradeID)
		}
	}
}

func TestCompressTrades(t *testing.T) {
	config := CompressionConfig{
		Symbol:    "BTCUSDT",
		PriceTick: 0.1,
		BaseLevel: 25,
		MaxLevels: 10,
	}

	trades := []model.Trade{
		{Price: 100.0, Qty: 1.5, IsBuyerMaker: false, TradeID: 1},
		{Price: 101.0, Qty: 2.3, IsBuyerMaker: true, TradeID: 2},
		{Price: 102.0, Qty: 0.8, IsBuyerMaker: false, TradeID: 3},
	}

	rows := CompressTrades(trades, config)
	if len(rows) == 0 {
		t.Fatal("CompressTrades returned no rows")
	}

	for _, row := range rows {
		if row.Symbol != "BTCUSDT" {
			t.Errorf("row.Symbol = %q, want BTCUSDT", row.Symbol)
		}
		if row.BidVolume != TruncateVolume(row.BidVolume) {
			t.Error("bid_volume not truncated")
		}
		if row.AskVolume != TruncateVolume(row.AskVolume) {
			t.Error("ask_volume not truncated")
		}
	}
}
