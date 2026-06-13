package aggregation

import (
	"testing"
	"time"

	"github.com/procluster/procluster/internal/model"
)

func TestRollup_1mTo1h(t *testing.T) {
	base := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)

	var rows []model.ClusterRow
	for m := 0; m < 60; m++ {
		ts := base.Add(time.Duration(m) * time.Minute)
		rows = append(rows, model.ClusterRow{
			Symbol:      "BTCUSDT",
			Timeframe:   "1m",
			CandleOpen:  ts,
			PriceLevel:  100000.0,
			BidVolume:   1.0,
			AskVolume:   0.5,
			Compression: 25,
			OpenPrice:   100.0 + float64(m),
			ClosePrice:  100.0 + float64(m),
		})
	}

	result := AggregateForTimeframe(rows, "1h")

	if len(result) != 1 {
		t.Fatalf("expected 1 1h candle, got %d", len(result))
	}

	row := result[0]
	if !row.CandleOpen.Equal(base) {
		t.Errorf("CandleOpen = %v, want %v", row.CandleOpen, base)
	}
	if row.Timeframe != "1h" {
		t.Errorf("Timeframe = %q, want 1h", row.Timeframe)
	}

	expectedBid := TruncateVolume(60.0)
	if row.BidVolume != expectedBid {
		t.Errorf("BidVolume = %f, want %f", row.BidVolume, expectedBid)
	}
	expectedAsk := TruncateVolume(30.0)
	if row.AskVolume != expectedAsk {
		t.Errorf("AskVolume = %f, want %f", row.AskVolume, expectedAsk)
	}

	if row.OpenPrice != 100.0 {
		t.Errorf("OpenPrice = %f, want 100.0 (first minute)", row.OpenPrice)
	}
	if row.ClosePrice != 159.0 {
		t.Errorf("ClosePrice = %f, want 159.0 (last minute)", row.ClosePrice)
	}
}

func TestRollup_1mTo1h_TwoIntervals(t *testing.T) {
	h10 := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	h11 := time.Date(2026, 6, 13, 11, 0, 0, 0, time.UTC)

	var rows []model.ClusterRow
	for m := 0; m < 30; m++ {
		rows = append(rows, model.ClusterRow{
			Symbol:      "BTCUSDT",
			Timeframe:   "1m",
			CandleOpen:  h10.Add(time.Duration(m) * time.Minute),
			PriceLevel:  100000.0,
			BidVolume:   1.0,
			AskVolume:   0.5,
			Compression: 25,
			OpenPrice:   100.0,
			ClosePrice:  200.0,
		})
	}
	for m := 0; m < 30; m++ {
		rows = append(rows, model.ClusterRow{
			Symbol:      "BTCUSDT",
			Timeframe:   "1m",
			CandleOpen:  h11.Add(time.Duration(m) * time.Minute),
			PriceLevel:  100000.0,
			BidVolume:   2.0,
			AskVolume:   1.0,
			Compression: 25,
			OpenPrice:   300.0,
			ClosePrice:  400.0,
		})
	}

	result := AggregateForTimeframe(rows, "1h")

	if len(result) != 2 {
		t.Fatalf("expected 2 1h candles, got %d", len(result))
	}

	type check struct {
		idx      int
		expected time.Time
		bidVol   float64
		askVol   float64
		openP    float64
		closeP   float64
	}

	checks := []check{
		{0, h10, 30.0, 15.0, 100.0, 200.0},
		{1, h11, 60.0, 30.0, 300.0, 400.0},
	}

	for _, c := range checks {
		row := result[c.idx]
		if !row.CandleOpen.Equal(c.expected) {
			t.Errorf("[%d] CandleOpen = %v, want %v", c.idx, row.CandleOpen, c.expected)
		}
		if row.BidVolume != TruncateVolume(c.bidVol) {
			t.Errorf("[%d] BidVolume = %f, want %f", c.idx, row.BidVolume, TruncateVolume(c.bidVol))
		}
		if row.AskVolume != TruncateVolume(c.askVol) {
			t.Errorf("[%d] AskVolume = %f, want %f", c.idx, row.AskVolume, TruncateVolume(c.askVol))
		}
		if row.OpenPrice != c.openP {
			t.Errorf("[%d] OpenPrice = %f, want %f", c.idx, row.OpenPrice, c.openP)
		}
		if row.ClosePrice != c.closeP {
			t.Errorf("[%d] ClosePrice = %f, want %f", c.idx, row.ClosePrice, c.closeP)
		}
	}
}

func TestRollup_1mTo4h(t *testing.T) {
	base := time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC)

	var rows []model.ClusterRow
	for m := 0; m < 240; m++ {
		ts := base.Add(time.Duration(m) * time.Minute)
		rows = append(rows, model.ClusterRow{
			Symbol:      "BTCUSDT",
			Timeframe:   "1m",
			CandleOpen:  ts,
			PriceLevel:  100000.0,
			BidVolume:   1.0,
			AskVolume:   0.5,
			Compression: 25,
			OpenPrice:   100.0,
			ClosePrice:  200.0,
		})
	}

	result := AggregateForTimeframe(rows, "4h")

	if len(result) != 1 {
		t.Fatalf("expected 1 4h candle, got %d", len(result))
	}

	if result[0].CandleOpen != base {
		t.Errorf("CandleOpen = %v, want %v", result[0].CandleOpen, base)
	}

	expectedBid := TruncateVolume(240.0)
	if result[0].BidVolume != expectedBid {
		t.Errorf("BidVolume = %f, want %f", result[0].BidVolume, expectedBid)
	}
}

func TestRollup_1mTo4h_MultipleBlocks(t *testing.T) {
	base := time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC)

	var rows []model.ClusterRow
	for h := 0; h < 24; h++ {
		for m := 0; m < 60; m++ {
			ts := base.Add(time.Duration(h*60+m) * time.Minute)
			rows = append(rows, model.ClusterRow{
				Symbol:      "BTCUSDT",
				Timeframe:   "1m",
				CandleOpen:  ts,
				PriceLevel:  100000.0,
				BidVolume:   1.0,
				AskVolume:   0.5,
				Compression: 25,
				OpenPrice:   100.0,
				ClosePrice:  200.0,
			})
		}
	}

	result := AggregateForTimeframe(rows, "4h")

	if len(result) != 6 {
		t.Fatalf("expected 6 4h candles for 24h, got %d", len(result))
	}

	expectedTimes := []time.Time{
		base,
		base.Add(4 * time.Hour),
		base.Add(8 * time.Hour),
		base.Add(12 * time.Hour),
		base.Add(16 * time.Hour),
		base.Add(20 * time.Hour),
	}

	for i, expected := range expectedTimes {
		if !result[i].CandleOpen.Equal(expected) {
			t.Errorf("[%d] CandleOpen = %v, want %v", i, result[i].CandleOpen, expected)
		}
	}
}

func TestRollup_1mTo1d(t *testing.T) {
	base := time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC)

	var rows []model.ClusterRow
	for m := 0; m < 1440; m++ {
		ts := base.Add(time.Duration(m) * time.Minute)
		rows = append(rows, model.ClusterRow{
			Symbol:      "BTCUSDT",
			Timeframe:   "1m",
			CandleOpen:  ts,
			PriceLevel:  100000.0,
			BidVolume:   1.0,
			AskVolume:   0.5,
			Compression: 25,
			OpenPrice:   100.0,
			ClosePrice:  200.0,
		})
	}

	result := AggregateForTimeframe(rows, "1d")

	if len(result) != 1 {
		t.Fatalf("expected 1 1d candle, got %d", len(result))
	}

	if result[0].CandleOpen != base {
		t.Errorf("CandleOpen = %v, want %v", result[0].CandleOpen, base)
	}

	expectedBid := TruncateVolume(1440.0)
	if result[0].BidVolume != expectedBid {
		t.Errorf("BidVolume = %f, want %f", result[0].BidVolume, expectedBid)
	}
}

func TestRollup_MultiplePriceLevels(t *testing.T) {
	base := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)

	var rows []model.ClusterRow
	for m := 0; m < 60; m++ {
		for _, pl := range []float64{100000.0, 100002.5, 100005.0} {
			rows = append(rows, model.ClusterRow{
				Symbol:      "BTCUSDT",
				Timeframe:   "1m",
				CandleOpen:  base.Add(time.Duration(m) * time.Minute),
				PriceLevel:  pl,
				BidVolume:   1.0,
				AskVolume:   0.5,
				Compression: 25,
				OpenPrice:   100.0,
				ClosePrice:  200.0,
			})
		}
	}

	result := AggregateForTimeframe(rows, "1h")

	if len(result) != 3 {
		t.Fatalf("expected 3 price levels, got %d", len(result))
	}

	levels := make(map[float64]float64)
	for _, r := range result {
		levels[r.PriceLevel] = r.BidVolume
	}

	for _, pl := range []float64{100000.0, 100002.5, 100005.0} {
		if vol, ok := levels[pl]; !ok {
			t.Errorf("missing price level %f", pl)
		} else if vol != TruncateVolume(60.0) {
			t.Errorf("price level %f: BidVolume = %f, want %f", pl, vol, TruncateVolume(60.0))
		}
	}
}

func TestRollup_Full(t *testing.T) {
	base := time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC)

	var rows []model.ClusterRow
	for m := 0; m < 120; m++ {
		ts := base.Add(time.Duration(m) * time.Minute)
		rows = append(rows, model.ClusterRow{
			Symbol:      "BTCUSDT",
			Timeframe:   "1m",
			CandleOpen:  ts,
			PriceLevel:  100000.0,
			BidVolume:   1.0,
			AskVolume:   0.5,
			Compression: 25,
			OpenPrice:   100.0,
			ClosePrice:  200.0,
		})
	}

	result := Rollup(rows)

	h1h := 0
	h4h := 0
	h1d := 0
	for _, r := range result {
		switch r.Timeframe {
		case "1h":
			h1h++
		case "4h":
			h4h++
		case "1d":
			h1d++
		}
	}

	if h1h != 2 {
		t.Errorf("expected 2 1h candles, got %d", h1h)
	}
	if h4h != 1 {
		t.Errorf("expected 1 4h candle, got %d", h4h)
	}
	if h1d != 1 {
		t.Errorf("expected 1 1d candle, got %d", h1d)
	}
}

func TestAlignToTimeframe(t *testing.T) {
	tests := []struct {
		name     string
		input    time.Time
		tf       string
		expected time.Time
	}{
		{
			name:     "1h truncates minutes",
			input:    time.Date(2026, 6, 13, 10, 37, 0, 0, time.UTC),
			tf:       "1h",
			expected: time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC),
		},
		{
			name:     "4h 00:00-03:59 → 00:00",
			input:    time.Date(2026, 6, 13, 2, 15, 0, 0, time.UTC),
			tf:       "4h",
			expected: time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC),
		},
		{
			name:     "4h 04:00-07:59 → 04:00",
			input:    time.Date(2026, 6, 13, 5, 45, 0, 0, time.UTC),
			tf:       "4h",
			expected: time.Date(2026, 6, 13, 4, 0, 0, 0, time.UTC),
		},
		{
			name:     "4h 08:00-11:59 → 08:00",
			input:    time.Date(2026, 6, 13, 11, 59, 0, 0, time.UTC),
			tf:       "4h",
			expected: time.Date(2026, 6, 13, 8, 0, 0, 0, time.UTC),
		},
		{
			name:     "4h 20:00-23:59 → 20:00",
			input:    time.Date(2026, 6, 13, 23, 59, 0, 0, time.UTC),
			tf:       "4h",
			expected: time.Date(2026, 6, 13, 20, 0, 0, 0, time.UTC),
		},
		{
			name:     "1d truncates to midnight",
			input:    time.Date(2026, 6, 13, 23, 59, 0, 0, time.UTC),
			tf:       "1d",
			expected: time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := AlignToTimeframe(tt.input, tt.tf)
			if !got.Equal(tt.expected) {
				t.Errorf("AlignToTimeframe(%v, %q) = %v, want %v", tt.input, tt.tf, got, tt.expected)
			}
		})
	}
}
