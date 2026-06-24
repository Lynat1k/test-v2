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

// Regression: per-trade truncation bug — 1000 trades qty=0.001 must NOT collapse to 0.
// Old code: TruncateVolume(0.001)=0.0 per trade → sum=0.0.
// Fixed code: sum=~1.0 in full precision → TruncateVolume of final sum=1.0.
// IsBuyerMaker=false → BUY → row.AskVolume (ATAS swap inside CompressTrades).
func TestCompressTrades_PerTradeFix_ManySmallTrades(t *testing.T) {
	config := CompressionConfig{
		Symbol:    "BTCUSDT",
		PriceTick: 0.1,
		BaseLevel: 25,
		MaxLevels: 10,
	}

	const n = 1000
	const qty = 0.001
	trades := make([]model.Trade, n)
	for i := 0; i < n; i++ {
		trades[i] = model.Trade{
			Price:        100.0,
			Qty:          qty,
			IsBuyerMaker: false,
			TradeID:      int64(i + 1),
		}
	}

	rows := CompressTrades(trades, config)
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	row := rows[0]

	// Expected: TruncateVolume(Σqty) for one side, 0 for the other.
	wantAsk := TruncateVolume(qty * float64(n)) // 1.0
	if row.AskVolume != wantAsk {
		t.Errorf("AskVolume = %v, want %v (old buggy code would give 0.0)", row.AskVolume, wantAsk)
	}
	if row.BidVolume != 0.0 {
		t.Errorf("BidVolume = %v, want 0.0 (no SELL trades in input)", row.BidVolume)
	}
	if row.AskVolume == 0.0 {
		t.Fatal("AskVolume collapsed to 0 — per-trade truncation bug is back")
	}
}

// Regression: mixed fractional qty must sum in full precision before truncation.
// Trades: 5.625 + 0.247 + 3.376 = 9.248 → TruncateVolume(9.248) = 9.2.
// Old code: TruncateVolume(5.625)+TruncateVolume(0.247)+TruncateVolume(3.376)
//         = 5.6 + 0.2 + 3.3 = 9.1 → TruncateVolume(9.1) = 9.1. WRONG (loses 0.1).
// IsBuyerMaker=false → BUY → row.AskVolume (ATAS swap inside CompressTrades).
func TestCompressTrades_PerTradeFix_MixedFractional(t *testing.T) {
	config := CompressionConfig{
		Symbol:    "BTCUSDT",
		PriceTick: 0.1,
		BaseLevel: 25,
		MaxLevels: 10,
	}

	trades := []model.Trade{
		{Price: 100.0, Qty: 5.625, IsBuyerMaker: false, TradeID: 1},
		{Price: 100.0, Qty: 0.247, IsBuyerMaker: false, TradeID: 2},
		{Price: 100.0, Qty: 3.376, IsBuyerMaker: false, TradeID: 3},
	}

	rows := CompressTrades(trades, config)
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	row := rows[0]

	const want = 9.2
	if row.AskVolume != want {
		t.Errorf("AskVolume = %v, want %v (old buggy code would give 9.1)", row.AskVolume, want)
	}
	if row.BidVolume != 0.0 {
		t.Errorf("BidVolume = %v, want 0.0", row.BidVolume)
	}
}

// General invariant: Σ(BidVolume+AskVolume) for one price level must equal
// TruncateVolume(Σ trade.Qty). Old code violated this for fractional qty.
func TestCompressTrades_PerTradeFix_SumInvariant(t *testing.T) {
	config := CompressionConfig{
		Symbol:    "BTCUSDT",
		PriceTick: 0.1,
		BaseLevel: 25,
		MaxLevels: 10,
	}

	// Mix sell + buy trades at same price level.
	qty := []float64{0.125, 0.387, 1.892, 0.043, 2.501, 0.766, 0.099, 4.317}
	side := []bool{false, true, false, true, false, true, false, true} // IsBuyerMaker

	var totalQty float64
	trades := make([]model.Trade, len(qty))
	for i, q := range qty {
		trades[i] = model.Trade{
			Price:        100.0,
			Qty:          q,
			IsBuyerMaker: side[i],
			TradeID:      int64(i + 1),
		}
		totalQty += q
	}

	rows := CompressTrades(trades, config)
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}

	// Sum of per-side truncated buckets must equal truncated-sum within 1 unit
	// of last decimal (per-side truncation can lose up to 0.099 each side, so
	// total combined loss is bounded by ~0.2). Old buggy code lost ~0.099 PER
	// TRADE, so on 8 trades up to ~0.8 — far outside this bound.
	got := rows[0].BidVolume + rows[0].AskVolume
	want := TruncateVolume(totalQty)
	diff := got - want
	if diff < 0 {
		diff = -diff
	}
	if diff > 0.2 {
		t.Errorf("BidVolume+AskVolume=%v, TruncateVolume(Σqty)=%v, diff=%v (>0.2 — per-trade truncation likely back)", got, want, diff)
	}
}
