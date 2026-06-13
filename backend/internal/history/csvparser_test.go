package history

import (
	"strings"
	"testing"
	"time"
)

func TestParseFuturesCSV(t *testing.T) {
	csvData := `aggTradeId,price,qty,firstTradeId,lastTradeId,time,isBuyerMaker
281969046,104739.50,0.002,281969046,281969046,1717200000000,false
281969047,104740.00,0.150,281969047,281969047,1717200000100,true
281969048,104738.50,0.001,281969048,281969048,1717200000200,False
281969049,104741.00,0.050,281969049,281969049,1717200000300,True
`

	trades, err := ParseCSV(strings.NewReader(csvData), MarketFutures)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(trades) != 4 {
		t.Fatalf("expected 4 trades, got %d", len(trades))
	}

	tests := []struct {
		idx          int
		price        float64
		qty          float64
		tradeID      int64
		isBuyerMaker bool
		timeMs       int64
	}{
		{0, 104739.50, 0.002, 281969046, false, 1717200000000},
		{1, 104740.00, 0.150, 281969047, true, 1717200000100},
		{2, 104738.50, 0.001, 281969048, false, 1717200000200},
		{3, 104741.00, 0.050, 281969049, true, 1717200000300},
	}

	for _, tt := range tests {
		trade := trades[tt.idx]
		if trade.Price != tt.price {
			t.Errorf("trade[%d].Price = %f, want %f", tt.idx, trade.Price, tt.price)
		}
		if trade.Qty != tt.qty {
			t.Errorf("trade[%d].Qty = %f, want %f", tt.idx, trade.Qty, tt.qty)
		}
		if trade.TradeID != tt.tradeID {
			t.Errorf("trade[%d].TradeID = %d, want %d", tt.idx, trade.TradeID, tt.tradeID)
		}
		if trade.IsBuyerMaker != tt.isBuyerMaker {
			t.Errorf("trade[%d].IsBuyerMaker = %v, want %v", tt.idx, trade.IsBuyerMaker, tt.isBuyerMaker)
		}
		expectedTime := time.UnixMilli(tt.timeMs)
		if !trade.Time.Equal(expectedTime) {
			t.Errorf("trade[%d].Time = %v, want %v", tt.idx, trade.Time, expectedTime)
		}
	}
}

func TestParseSpotCSV(t *testing.T) {
	csvData := `aggTradeId,price,qty,firstTradeId,lastTradeId,time,isBuyerMaker,isBestMatch
123456789,104739.50,0.002,123456789,123456789,1717200000000000,False,True
123456790,104740.00,0.150,123456790,123456790,1717200000100000,True,True
123456791,104738.50,0.001,123456791,123456791,1717200000200000,false,True
123456792,104741.00,0.050,123456792,123456792,1717200000300000,true,True
`

	trades, err := ParseCSV(strings.NewReader(csvData), MarketSpot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(trades) != 4 {
		t.Fatalf("expected 4 trades, got %d", len(trades))
	}

	tests := []struct {
		idx          int
		price        float64
		qty          float64
		tradeID      int64
		isBuyerMaker bool
		timeMs       int64
	}{
		{0, 104739.50, 0.002, 123456789, false, 1717200000000},
		{1, 104740.00, 0.150, 123456790, true, 1717200000100},
		{2, 104738.50, 0.001, 123456791, false, 1717200000200},
		{3, 104741.00, 0.050, 123456792, true, 1717200000300},
	}

	for _, tt := range tests {
		trade := trades[tt.idx]
		if trade.Price != tt.price {
			t.Errorf("trade[%d].Price = %f, want %f", tt.idx, trade.Price, tt.price)
		}
		if trade.Qty != tt.qty {
			t.Errorf("trade[%d].Qty = %f, want %f", tt.idx, trade.Qty, tt.qty)
		}
		if trade.TradeID != tt.tradeID {
			t.Errorf("trade[%d].TradeID = %d, want %d", tt.idx, trade.TradeID, tt.tradeID)
		}
		if trade.IsBuyerMaker != tt.isBuyerMaker {
			t.Errorf("trade[%d].IsBuyerMaker = %v, want %v", tt.idx, trade.IsBuyerMaker, tt.isBuyerMaker)
		}
		expectedTime := time.UnixMilli(tt.timeMs)
		if !trade.Time.Equal(expectedTime) {
			t.Errorf("trade[%d].Time = %v, want %v", tt.idx, trade.Time, expectedTime)
		}
	}
}

func TestParseFuturesCSV_SingleColumnHeader(t *testing.T) {
	csvData := `aggTradeId,price,qty,firstTradeId,lastTradeId,time,isBuyerMaker
281969046,104739.50,0.002,281969046,281969046,1717200000000,false
`

	trades, err := ParseCSV(strings.NewReader(csvData), MarketFutures)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(trades) != 1 {
		t.Fatalf("expected 1 trade, got %d", len(trades))
	}

	if trades[0].TradeID != 281969046 {
		t.Errorf("trade.TradeID = %d, want 281969046", trades[0].TradeID)
	}
}

func TestParseSpotCSV_MicrosecondsConversion(t *testing.T) {
	csvData := `aggTradeId,price,qty,firstTradeId,lastTradeId,time,isBuyerMaker,isBestMatch
1,100.00,0.001,1,1,1717200000500000,false,true
`

	trades, err := ParseCSV(strings.NewReader(csvData), MarketSpot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(trades) != 1 {
		t.Fatalf("expected 1 trade, got %d", len(trades))
	}

	expectedTime := time.UnixMilli(1717200000500)
	if !trades[0].Time.Equal(expectedTime) {
		t.Errorf("trade.Time = %v, want %v (microseconds divided by 1000)", trades[0].Time, expectedTime)
	}
}

func TestParseSpotCSV_IsBuyerMakerCaseInsensitive(t *testing.T) {
	csvData := `aggTradeId,price,qty,firstTradeId,lastTradeId,time,isBuyerMaker,isBestMatch
1,100.00,0.001,1,1,1717200000000000,True,1
2,100.00,0.001,2,2,1717200000000000,False,1
3,100.00,0.001,3,3,1717200000000000,TRUE,1
4,100.00,0.001,4,4,1717200000000000,FALSE,1
`

	trades, err := ParseCSV(strings.NewReader(csvData), MarketSpot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(trades) != 4 {
		t.Fatalf("expected 4 trades, got %d", len(trades))
	}

	expected := []bool{true, false, true, false}
	for i, exp := range expected {
		if trades[i].IsBuyerMaker != exp {
			t.Errorf("trade[%d].IsBuyerMaker = %v, want %v", i, trades[i].IsBuyerMaker, exp)
		}
	}
}

func TestParseCSV_SkipsBadLines(t *testing.T) {
	csvData := `aggTradeId,price,qty,firstTradeId,lastTradeId,time,isBuyerMaker
bad_data,not_a_number,0.001,1,1,1717200000000,false
281969046,104739.50,0.002,281969046,281969046,1717200000000,false
`

	trades, err := ParseCSV(strings.NewReader(csvData), MarketFutures)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(trades) != 1 {
		t.Fatalf("expected 1 trade (bad line skipped), got %d", len(trades))
	}

	if trades[0].TradeID != 281969046 {
		t.Errorf("trade.TradeID = %d, want 281969046", trades[0].TradeID)
	}
}

func TestBuildURL_Futures(t *testing.T) {
	date := time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)
	url := BuildURL(MarketFutures, "BTCUSDT", date)

	expected := "https://data.binance.vision/data/futures/um/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2026-05-15.zip"
	if url != expected {
		t.Errorf("BuildURL = %q, want %q", url, expected)
	}
}

func TestBuildURL_Spot(t *testing.T) {
	date := time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)
	url := BuildURL(MarketSpot, "BTCUSDT", date)

	expected := "https://data.binance.vision/data/spot/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2026-05-15.zip"
	if url != expected {
		t.Errorf("BuildURL = %q, want %q", url, expected)
	}
}
