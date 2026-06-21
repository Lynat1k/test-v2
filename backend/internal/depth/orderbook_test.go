package depth

import (
	"testing"
)

func TestSnapshotFromREST(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	bids := []PriceLevel{{Price: 84900, Qty: 1.5}, {Price: 84800, Qty: 2.0}}
	asks := []PriceLevel{{Price: 85000, Qty: 0.5}, {Price: 85100, Qty: 3.0}}
	ob.SnapshotFromREST(100, bids, asks)

	if ob.GetLastUpdateID() != 100 {
		t.Errorf("lastUpdateId = %d, want 100", ob.GetLastUpdateID())
	}

	levels := ob.GetAggregatedLevels(85000, 0.05, 100)
	if len(levels) == 0 {
		t.Fatal("expected levels, got 0")
	}

	found := false
	for _, l := range levels {
		if l.PriceLevel == 84900 {
			if l.BidSize != 1.5 {
				t.Errorf("bidSize = %f, want 1.5", l.BidSize)
			}
			found = true
		}
	}
	if !found {
		t.Error("price level 84900 not found")
	}
}

func TestApplyFuturesUpdate(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	ob.SnapshotFromREST(100, nil, nil)

	ok := ob.ApplyFuturesUpdate(101, 102, 100,
		[][2]string{{"84900.0", "1.5"}},
		[][2]string{{"85000.0", "0.5"}},
	)
	if !ok {
		t.Fatal("ApplyFuturesUpdate returned false")
	}

	if ob.GetLastUpdateID() != 102 {
		t.Errorf("lastUpdateId = %d, want 102", ob.GetLastUpdateID())
	}

	levels := ob.GetAggregatedLevels(85000, 0.05, 100)
	found := false
	for _, l := range levels {
		if l.PriceLevel == 84900 {
			if l.BidSize != 1.5 {
				t.Errorf("bidSize = %f, want 1.5", l.BidSize)
			}
			found = true
		}
	}
	if !found {
		t.Error("price level 84900 not found")
	}
}

func TestFuturesPUMismatch(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	ob.SnapshotFromREST(100, nil, nil)

	ob.ApplyFuturesUpdate(101, 102, 100, nil, nil)

	ok := ob.ApplyFuturesUpdate(103, 104, 999, nil, nil)
	if ok {
		t.Error("expected false for pu mismatch")
	}
}

func TestFuturesDeleteLevel(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	ob.SnapshotFromREST(100,
		[]PriceLevel{{Price: 84900, Qty: 1.5}},
		nil,
	)

	ob.ApplyFuturesUpdate(101, 102, 100,
		[][2]string{{"84900.0", "0"}},
		nil,
	)

	levels := ob.GetAggregatedLevels(85000, 0.05, 100)
	for _, l := range levels {
		if l.PriceLevel == 84900 && l.BidSize != 0 {
			t.Errorf("bidSize should be 0 after delete, got %f", l.BidSize)
		}
	}
}

func TestApplySpotUpdate(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "spot")
	ob.SnapshotFromREST(100, nil, nil)

	ok := ob.ApplySpotUpdate(101, 102,
		[][2]string{{"84900.00", "2.0"}},
		[][2]string{{"85000.00", "1.0"}},
	)
	if !ok {
		t.Fatal("ApplySpotUpdate returned false")
	}

	if ob.GetLastUpdateID() != 102 {
		t.Errorf("lastUpdateId = %d, want 102", ob.GetLastUpdateID())
	}
}

func TestSpotUSequenceMismatch(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "spot")
	ob.SnapshotFromREST(100, nil, nil)

	ob.ApplySpotUpdate(101, 102, nil, nil)

	ok := ob.ApplySpotUpdate(999, 1000, nil, nil)
	if ok {
		t.Error("expected false for U mismatch")
	}
}

func TestGetAggregatedLevelsPercentRange(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	bids := []PriceLevel{
		{Price: 84900, Qty: 1.0},
		{Price: 80000, Qty: 5.0},
	}
	asks := []PriceLevel{
		{Price: 85000, Qty: 1.0},
		{Price: 90000, Qty: 5.0},
	}
	ob.SnapshotFromREST(1, bids, asks)

	levels := ob.GetAggregatedLevels(85000, 0.05, 100)
	for _, l := range levels {
		if l.PriceLevel == 80000 || l.PriceLevel == 90000 {
			t.Errorf("level %f should be filtered out by ±5%%", l.PriceLevel)
		}
	}
}

func TestGetAggregatedLevelsTruncation(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	bids := []PriceLevel{
		{Price: 84900, Qty: 1.56},
	}
	ob.SnapshotFromREST(1, bids, nil)

	levels := ob.GetAggregatedLevels(85000, 0.05, 100)
	for _, l := range levels {
		if l.PriceLevel == 84900 {
			if l.BidSize != 1.5 {
				t.Errorf("bidSize = %f, want 1.5 (truncated)", l.BidSize)
			}
		}
	}
}

func TestGetAggregatedLevelsAggregation(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	bids := []PriceLevel{
		{Price: 84900, Qty: 1.56},
		{Price: 84950, Qty: 2.34},
	}
	ob.SnapshotFromREST(1, bids, nil)

	levels := ob.GetAggregatedLevels(85000, 0.05, 100)
	found := false
	for _, l := range levels {
		if l.PriceLevel == 84900 {
			if l.BidSize != 3.9 {
				t.Errorf("bidSize = %f, want 3.9 (sum 1.56+2.34 truncated)", l.BidSize)
			}
			found = true
		}
	}
	if !found {
		t.Error("price level 84900 not found")
	}
}

func TestClear(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	ob.SnapshotFromREST(100,
		[]PriceLevel{{Price: 84900, Qty: 1.0}},
		[]PriceLevel{{Price: 85000, Qty: 1.0}},
	)
	ob.Clear()

	if ob.GetLastUpdateID() != 0 {
		t.Errorf("lastUpdateId = %d, want 0 after clear", ob.GetLastUpdateID())
	}

	levels := ob.GetAggregatedLevels(85000, 0.05, 100)
	if len(levels) != 0 {
		t.Errorf("expected 0 levels after clear, got %d", len(levels))
	}
}

func TestSetGetLastPrice(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	ob.SetLastPrice(85000.12)

	if ob.GetLastPrice() != 85000.12 {
		t.Errorf("lastPrice = %f, want 85000.12", ob.GetLastPrice())
	}
}

func TestInvalidPriceIgnored(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	ob.SnapshotFromREST(100, nil, nil)

	ok := ob.ApplyFuturesUpdate(101, 102, 100,
		[][2]string{{"-100", "1.0"}, {"0", "1.0"}},
		[][2]string{{"abc", "1.0"}},
	)
	if !ok {
		t.Fatal("should return true even with invalid data")
	}

	levels := ob.GetAggregatedLevels(85000, 0.05, 100)
	if len(levels) != 0 {
		t.Errorf("expected 0 levels for invalid prices, got %d", len(levels))
	}
}

func TestPrune_RemovesLevelsOutsideRange(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	bids := []PriceLevel{
		{Price: 50000, Qty: 1},
		{Price: 100000, Qty: 2},
		{Price: 105000, Qty: 3},
		{Price: 109000, Qty: 4},
	}
	asks := []PriceLevel{
		{Price: 111000, Qty: 1},
		{Price: 115000, Qty: 2},
		{Price: 120000, Qty: 3},
		{Price: 130000, Qty: 4},
		{Price: 200000, Qty: 5},
	}
	ob.SnapshotFromREST(1, bids, asks)

	rb, ra := ob.Prune(110000, 0.10)
	if rb != 1 {
		t.Errorf("removedBids = %d, want 1 (50000 outside [99000..121000])", rb)
	}
	if ra != 2 {
		t.Errorf("removedAsks = %d, want 2 (130000 and 200000 outside [99000..121000])", ra)
	}

	stats := ob.Stats()
	if stats.Bids != 3 {
		t.Errorf("remaining bids = %d, want 3", stats.Bids)
	}
	if stats.Asks != 3 {
		t.Errorf("remaining asks = %d, want 3", stats.Asks)
	}
	// 6 prices in [100000, 105000, 109000, 111000, 115000, 120000]; p5 = idx 0, p95 = idx 5.
	if stats.P5Price != 100000 {
		t.Errorf("P5Price = %f, want 100000", stats.P5Price)
	}
	if stats.P95Price != 120000 {
		t.Errorf("P95Price = %f, want 120000", stats.P95Price)
	}
}

func TestStats_PercentilesIgnoreDustOutliers(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	// 100 plausible levels around 64000, plus one dust at $1 and one at $999999.
	bids := make([]PriceLevel, 0, 51)
	asks := make([]PriceLevel, 0, 51)
	bids = append(bids, PriceLevel{Price: 1, Qty: 0.0001}) // dust outlier
	for i := 0; i < 50; i++ {
		bids = append(bids, PriceLevel{Price: 63000 + float64(i), Qty: 1})
	}
	for i := 0; i < 50; i++ {
		asks = append(asks, PriceLevel{Price: 64000 + float64(i), Qty: 1})
	}
	asks = append(asks, PriceLevel{Price: 999999, Qty: 0.0001}) // dust outlier
	ob.SnapshotFromREST(1, bids, asks)

	s := ob.Stats()
	if s.Bids+s.Asks != 102 {
		t.Fatalf("total levels = %d, want 102", s.Bids+s.Asks)
	}
	// p5 of 102 prices is idx 5, p95 is idx 96. Neither should be 1 or 999999.
	if s.P5Price <= 1 {
		t.Errorf("P5Price = %f, dust outlier $1 leaked into the 5th percentile", s.P5Price)
	}
	if s.P95Price >= 999999 {
		t.Errorf("P95Price = %f, dust outlier $999999 leaked into the 95th percentile", s.P95Price)
	}
	// Both percentiles should be within the plausible range [63000, 64049].
	if s.P5Price < 63000 || s.P5Price > 64049 {
		t.Errorf("P5Price = %f, want in [63000, 64049]", s.P5Price)
	}
	if s.P95Price < 63000 || s.P95Price > 64049 {
		t.Errorf("P95Price = %f, want in [63000, 64049]", s.P95Price)
	}
}

func TestPrune_NoOpOnInvalidInputs(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "futures")
	ob.SnapshotFromREST(1, []PriceLevel{{Price: 100000, Qty: 1}}, []PriceLevel{{Price: 110000, Qty: 1}})

	rb, ra := ob.Prune(0, 0.10)
	if rb != 0 || ra != 0 {
		t.Errorf("Prune with center=0 should be no-op, got rb=%d ra=%d", rb, ra)
	}
	rb, ra = ob.Prune(105000, 0)
	if rb != 0 || ra != 0 {
		t.Errorf("Prune with pctRange=0 should be no-op, got rb=%d ra=%d", rb, ra)
	}
}

func TestApplyFirstEvent_BypassesSequenceCheck(t *testing.T) {
	ob := NewOrderBook("BTCUSDT", "spot")
	ob.SnapshotFromREST(100, []PriceLevel{{Price: 50000, Qty: 1}}, []PriceLevel{{Price: 51000, Qty: 1}})

	bids := [][2]string{{"50000", "5"}, {"49000", "2"}}
	asks := [][2]string{{"51000", "0"}, {"52000", "3"}}
	ob.ApplyFirstEvent(150, bids, asks)

	if ob.GetLastUpdateID() != 150 {
		t.Errorf("lastUpd = %d, want 150", ob.GetLastUpdateID())
	}
	levels := ob.GetAggregatedLevels(50500, 0.10, 100)
	gotBid50000 := false
	for _, l := range levels {
		if l.PriceLevel == 50000 && l.BidSize == 5 {
			gotBid50000 = true
		}
		if l.PriceLevel == 51000 && l.AskSize > 0 {
			t.Errorf("ask at 51000 should have been deleted by qty=0, got %f", l.AskSize)
		}
	}
	if !gotBid50000 {
		t.Errorf("expected bid 50000=5 after first event")
	}
}
