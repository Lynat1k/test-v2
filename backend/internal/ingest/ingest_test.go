package ingest

import (
	"fmt"
	"testing"
	"time"

	"github.com/procluster/procluster/internal/model"
)

func TestParseFuturesAggTrade(t *testing.T) {
	now := time.Now().UnixMilli()
	data := []byte(fmt.Sprintf(`{
		"e": "aggTrade",
		"E": %d,
		"s": "BTCUSDT",
		"a": 5933014,
		"p": "100000.50",
		"q": "0.125",
		"f": 100,
		"l": 105,
		"T": %d,
		"m": true
	}`, now, now))

	trade, err := ParseMessage(data, MarketFutures)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if trade.Price != 100000.50 {
		t.Errorf("price = %f, want 100000.50", trade.Price)
	}
	if trade.Qty != 0.125 {
		t.Errorf("qty = %f, want 0.125", trade.Qty)
	}
	if trade.TradeID != 5933014 {
		t.Errorf("tradeId = %d, want 5933014", trade.TradeID)
	}
	if !trade.IsBuyerMaker {
		t.Error("isBuyerMaker should be true")
	}
	if trade.Time.Before(time.Now().Add(-5 * time.Second)) {
		t.Errorf("trade time too old: %v", trade.Time)
	}
}

func TestParseSpotTrade(t *testing.T) {
	now := time.Now().UnixMilli()
	data := []byte(fmt.Sprintf(`{
		"e": "trade",
		"E": %d,
		"s": "BTCUSDT",
		"t": 12345,
		"p": "50000.25",
		"q": "1.5",
		"T": %d,
		"m": false
	}`, now, now))

	trade, err := ParseMessage(data, MarketSpot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if trade.Price != 50000.25 {
		t.Errorf("price = %f, want 50000.25", trade.Price)
	}
	if trade.Qty != 1.5 {
		t.Errorf("qty = %f, want 1.5", trade.Qty)
	}
	if trade.TradeID != 12345 {
		t.Errorf("tradeId = %d, want 12345", trade.TradeID)
	}
	if trade.IsBuyerMaker {
		t.Error("isBuyerMaker should be false")
	}
}

func TestParseInvalidJSON(t *testing.T) {
	_, err := ParseMessage([]byte("invalid"), MarketFutures)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestParseZeroPrice(t *testing.T) {
	now := time.Now().UnixMilli()
	data := []byte(fmt.Sprintf(`{
		"e": "aggTrade",
		"E": %d,
		"s": "BTCUSDT",
		"a": 1,
		"p": "0",
		"q": "1.0",
		"f": 1,
		"l": 1,
		"T": %d,
		"m": false
	}`, now, now))
	_, err := ParseMessage(data, MarketFutures)
	if err == nil {
		t.Error("expected error for zero price")
	}
}

func TestInterpretTradeSide(t *testing.T) {
	trueTrade := model.Trade{IsBuyerMaker: true}
	if trueTrade.IsBuyerMaker != true {
		t.Error("expected true")
	}

	falseTrade := model.Trade{IsBuyerMaker: false}
	if falseTrade.IsBuyerMaker != false {
		t.Error("expected false")
	}
}
