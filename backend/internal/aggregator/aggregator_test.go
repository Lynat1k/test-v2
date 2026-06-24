package aggregator

import (
	"fmt"
	"math"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/model"
)

const (
	testSymbol = "BTCUSDT"
	testMarket = "futures"
)

func testCompressionConfig() aggregation.CompressionConfig {
	return aggregation.CompressionConfig{
		Symbol:    testSymbol,
		PriceTick: 0.1,
		BaseLevel: 25,
		MaxLevels: 10,
	}
}

// newTestAggregator builds a minimal Aggregator backed by miniredis and a
// hardcoded BTCUSDT:futures config. orderBooks is nil (processTrade gates
// on its presence). UpdatesCh / CandleCloseCh stay nil so the WS-push and
// candle-close branches are skipped — neither path is needed for these
// regression tests and both would require additional fakes.
func newTestAggregator(t *testing.T) *Aggregator {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	a := &Aggregator{
		rdb:      rdb,
		configs:  make(map[string]aggregationCompressionConfig),
		tfStates: make(map[string]map[string]*tfLiveState),
		mu:       sync.Mutex{},
	}
	a.configs[BookKey(testSymbol, testMarket)] = aggregationCompressionConfig{
		Symbol:    testSymbol,
		PriceTick: 0.1,
		BaseLevel: 25,
	}
	return a
}

// feedTrades drives processTrade for each trade. All trades MUST sit in the
// same 1m candle AND the same higher-TF buckets, so no flush is triggered
// (no DB calls, repo is nil). UpdatesCh is nil so WS-push branch is skipped.
// This exercises the REAL bug site at aggregator.go:231 (per-trade trunc).
func feedTrades(t *testing.T, a *Aggregator, trades []model.Trade) {
	t.Helper()
	var live liveCandle
	var lastUpdate time.Time
	for _, tr := range trades {
		a.processTrade(tr, &live, &lastUpdate)
	}
}

func sortRows(rows []model.ClusterRow) {
	sort.Slice(rows, func(i, j int) bool { return rows[i].PriceLevel < rows[j].PriceLevel })
}

func sortLevels(levels []CandleLevel) {
	sort.Slice(levels, func(i, j int) bool { return levels[i].PriceLevel < levels[j].PriceLevel })
}

// genFractionalTrades returns a deterministic mix of trades at a single price
// level with fractional qty that exposes the per-trade truncation bug.
// All trades land in the same minute and the same 5m bucket.
func genFractionalTrades(basePrice float64, base time.Time) []model.Trade {
	qty := []float64{0.001, 0.001, 0.001, 0.001, 0.001, 0.099, 0.099, 0.099,
		0.247, 0.387, 0.766, 1.892, 2.501, 3.376, 4.317, 5.625}
	side := []bool{false, true, false, true, false, true, false, true,
		false, true, false, true, false, true, false, true}

	trades := make([]model.Trade, len(qty))
	for i, q := range qty {
		trades[i] = model.Trade{
			Symbol:       testSymbol,
			Market:       testMarket,
			Price:        basePrice,
			Qty:          q,
			IsBuyerMaker: side[i],
			TradeID:      int64(i + 1),
			Time:         base.Add(time.Duration(i) * time.Millisecond),
		}
	}
	return trades
}

// Regression for live higher-TF path: processTrade -> tfStates -> tfStateToRows.
// Drives the REAL bug site at aggregator.go:231 via processTrade.
// After the fix, this path must match batch CompressTrades on the same trades.
func TestLiveHigherTF_EqualsBatch(t *testing.T) {
	a := newTestAggregator(t)
	base := time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC) // start of 5m bucket
	trades := genFractionalTrades(50000.0, base)

	feedTrades(t, a, trades)

	st := a.tfStates[BookKey(testSymbol, testMarket)]["5m"]
	if st == nil {
		t.Fatal("no 5m tfLiveState created")
	}
	liveRows := a.tfStateToRows(st, testSymbol, testMarket)
	sortRows(liveRows)

	batchRows := aggregation.CompressTrades(trades, testCompressionConfig())
	sortRows(batchRows)

	if len(liveRows) != len(batchRows) {
		t.Fatalf("row count mismatch: live=%d batch=%d", len(liveRows), len(batchRows))
	}
	for i := range liveRows {
		if liveRows[i].PriceLevel != batchRows[i].PriceLevel {
			t.Errorf("row %d: PriceLevel live=%v batch=%v", i, liveRows[i].PriceLevel, batchRows[i].PriceLevel)
		}
		if liveRows[i].BidVolume != batchRows[i].BidVolume {
			t.Errorf("row %d (price=%v): BidVolume live=%v batch=%v",
				i, liveRows[i].PriceLevel, liveRows[i].BidVolume, batchRows[i].BidVolume)
		}
		if liveRows[i].AskVolume != batchRows[i].AskVolume {
			t.Errorf("row %d (price=%v): AskVolume live=%v batch=%v",
				i, liveRows[i].PriceLevel, liveRows[i].AskVolume, batchRows[i].AskVolume)
		}
	}

	// Sanity: bounded loss vs real Σqty.
	var totalLive, totalQty float64
	for _, r := range liveRows {
		totalLive += r.BidVolume + r.AskVolume
	}
	for _, tr := range trades {
		totalQty += tr.Qty
	}
	if math.Abs(totalQty-totalLive) > 0.2*float64(len(liveRows)) {
		t.Errorf("excessive loss: totalQty=%v live=%v diff=%v", totalQty, totalLive, totalQty-totalLive)
	}
}

// Regression for live 1m path via Redis: processTrade -> Redis -> readLevelsFromRedis.
// Same comparison vs batch CompressTrades.
//
// Swap convention (per backend/CLAUDE.md):
//   - Internal: pl.bid=BUY, pl.ask=SELL.
//   - readLevelsFromRedis swaps: CandleLevel.BidVolume=askVol (SELL), AskVolume=bidVol (BUY).
//   - CompressTrades pre-swaps: row.BidVolume=SELL, row.AskVolume=BUY.
//   Both in same ATAS frame, directly comparable.
func TestLive1mRedis_EqualsBatch(t *testing.T) {
	a := newTestAggregator(t)
	base := time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC)
	trades := genFractionalTrades(50000.0, base)

	feedTrades(t, a, trades)

	candleOpen := base.Truncate(time.Minute)
	key := fmt.Sprintf("cluster:levels:%s:%s:1m:%d", testSymbol, testMarket, candleOpen.UnixMilli())

	liveLevels := a.readLevelsFromRedis(key)
	sortLevels(liveLevels)

	batchRows := aggregation.CompressTrades(trades, testCompressionConfig())
	sortRows(batchRows)

	if len(liveLevels) != len(batchRows) {
		t.Fatalf("level count mismatch: live=%d batch=%d", len(liveLevels), len(batchRows))
	}
	for i := range liveLevels {
		if liveLevels[i].PriceLevel != batchRows[i].PriceLevel {
			t.Errorf("level %d: PriceLevel live=%v batch=%v", i, liveLevels[i].PriceLevel, batchRows[i].PriceLevel)
		}
		if liveLevels[i].BidVolume != batchRows[i].BidVolume {
			t.Errorf("level %d (price=%v): BidVolume live=%v batch=%v",
				i, liveLevels[i].PriceLevel, liveLevels[i].BidVolume, batchRows[i].BidVolume)
		}
		if liveLevels[i].AskVolume != batchRows[i].AskVolume {
			t.Errorf("level %d (price=%v): AskVolume live=%v batch=%v",
				i, liveLevels[i].PriceLevel, liveLevels[i].AskVolume, batchRows[i].AskVolume)
		}
	}

	// Absolute bounded-loss check (independent of live==batch symmetry):
	// real loss must be small even if BOTH paths happen to be broken equally.
	var totalLive, totalQty float64
	for _, l := range liveLevels {
		totalLive += l.BidVolume + l.AskVolume
	}
	for _, tr := range trades {
		totalQty += tr.Qty
	}
	if math.Abs(totalQty-totalLive) > 0.2*float64(len(liveLevels)) {
		t.Errorf("excessive loss: totalQty=%v live=%v diff=%v (per-trade trunc back?)",
			totalQty, totalLive, totalQty-totalLive)
	}
}

// Regression for pushTFUpdates: validates truncation-on-output via the WS
// push branch. Drives processTrade (with UpdatesCh nil to avoid in-loop push)
// then sets UpdatesCh and calls pushTFUpdates manually to capture levels.
func TestPushTFUpdates_TruncatesOnOutput(t *testing.T) {
	a := newTestAggregator(t)
	base := time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC)
	trades := genFractionalTrades(50000.0, base)

	feedTrades(t, a, trades)

	updates := make(chan CandleUpdate, len(higherTimeframes))
	a.UpdatesCh = updates
	a.pushTFUpdates(testSymbol, testMarket)
	close(updates)

	var got5m *CandleUpdate
	for u := range updates {
		u := u
		if u.Timeframe == "5m" {
			got5m = &u
			break
		}
	}
	if got5m == nil {
		t.Fatal("no 5m CandleUpdate pushed")
	}

	for _, l := range got5m.Levels {
		if l.BidVolume != aggregation.TruncateVolume(l.BidVolume) {
			t.Errorf("pushTFUpdates: BidVolume %v not truncated at output", l.BidVolume)
		}
		if l.AskVolume != aggregation.TruncateVolume(l.AskVolume) {
			t.Errorf("pushTFUpdates: AskVolume %v not truncated at output", l.AskVolume)
		}
	}

	batchRows := aggregation.CompressTrades(trades, testCompressionConfig())
	sortRows(batchRows)
	sortLevels(got5m.Levels)
	if len(got5m.Levels) != len(batchRows) {
		t.Fatalf("level count mismatch: ws=%d batch=%d", len(got5m.Levels), len(batchRows))
	}
	for i := range got5m.Levels {
		if got5m.Levels[i].BidVolume != batchRows[i].BidVolume {
			t.Errorf("level %d: BidVolume ws=%v batch=%v", i, got5m.Levels[i].BidVolume, batchRows[i].BidVolume)
		}
		if got5m.Levels[i].AskVolume != batchRows[i].AskVolume {
			t.Errorf("level %d: AskVolume ws=%v batch=%v", i, got5m.Levels[i].AskVolume, batchRows[i].AskVolume)
		}
	}

	// Absolute bounded-loss (catches symmetrically-broken old code where
	// ws==batch but both equal the wrong value).
	var totalWS, totalQty float64
	for _, l := range got5m.Levels {
		totalWS += l.BidVolume + l.AskVolume
	}
	for _, tr := range trades {
		totalQty += tr.Qty
	}
	if math.Abs(totalQty-totalWS) > 0.2*float64(len(got5m.Levels)) {
		t.Errorf("excessive loss: totalQty=%v ws=%v diff=%v (per-trade trunc back?)",
			totalQty, totalWS, totalQty-totalWS)
	}
}

// Hardest case: 1000 tiny trades that EACH round to 0 under old per-trade
// truncation. Live higher-TF path must accumulate to ~1.0, not collapse to 0.
// Drives processTrade so the real bug site at aggregator.go:231 is exercised.
func TestLiveHigherTF_ManySmallTradesNotZero(t *testing.T) {
	a := newTestAggregator(t)
	base := time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC)
	const n = 1000
	const qty = 0.001
	trades := make([]model.Trade, n)
	for i := 0; i < n; i++ {
		trades[i] = model.Trade{
			Symbol:       testSymbol,
			Market:       testMarket,
			Price:        50000.0,
			Qty:          qty,
			IsBuyerMaker: false, // BUY → after ATAS swap lands in AskVolume
			TradeID:      int64(i + 1),
			Time:         base.Add(time.Duration(i) * time.Millisecond),
		}
	}

	feedTrades(t, a, trades)

	st := a.tfStates[BookKey(testSymbol, testMarket)]["5m"]
	rows := a.tfStateToRows(st, testSymbol, testMarket)
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	want := aggregation.TruncateVolume(qty * float64(n)) // 1.0
	if rows[0].AskVolume != want {
		t.Errorf("AskVolume = %v, want %v (old per-trade trunc would give 0.0)", rows[0].AskVolume, want)
	}
	if rows[0].AskVolume == 0.0 {
		t.Fatal("AskVolume collapsed to 0 — live per-trade truncation back?")
	}
}
