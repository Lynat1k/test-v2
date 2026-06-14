package ingest

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/procluster/procluster/internal/model"
)

type MarketType string

const (
	MarketFutures MarketType = "futures"
	MarketSpot    MarketType = "spot"
)

type TradeMessage struct {
	Event            string `json:"e"`
	EventTime        int64  `json:"E"`
	Symbol           string `json:"s"`
	AggregateTradeID int64  `json:"a"`
	TradeID          int64  `json:"t"`
	Price            string `json:"p"`
	Quantity         string `json:"q"`
	FirstTradeID     int64  `json:"f"`
	LastTradeID      int64  `json:"l"`
	TradeTime        int64  `json:"T"`
	IsBuyerMaker     bool   `json:"m"`
}

func ParseMessage(data []byte, market MarketType) (*model.Trade, error) {
	var msg TradeMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("unmarshal trade message: %w", err)
	}

	if msg.Event != "trade" && msg.Event != "aggTrade" {
		return nil, fmt.Errorf("unexpected event type: %s", msg.Event)
	}

	price, err := strconv.ParseFloat(msg.Price, 64)
	if err != nil {
		return nil, fmt.Errorf("parse price %q: %w", msg.Price, err)
	}

	qty, err := strconv.ParseFloat(msg.Quantity, 64)
	if err != nil {
		return nil, fmt.Errorf("parse quantity %q: %w", msg.Quantity, err)
	}

	tradeID := msg.AggregateTradeID

	if tradeID == 0 {
		return nil, fmt.Errorf("zero tradeId")
	}

	trade := &model.Trade{
		Price:        price,
		Qty:          qty,
		IsBuyerMaker: msg.IsBuyerMaker,
		TradeID:      tradeID,
		Time:         time.UnixMilli(msg.TradeTime),
	}

	if err := validateTrade(trade); err != nil {
		return nil, err
	}

	return trade, nil
}

func validateTrade(t *model.Trade) error {
	if t.Price <= 0 {
		return fmt.Errorf("invalid price: %f", t.Price)
	}
	if t.Qty <= 0 {
		return fmt.Errorf("invalid qty: %f", t.Qty)
	}
	if t.TradeID <= 0 {
		return fmt.Errorf("invalid tradeId: %d", t.TradeID)
	}
	if time.Since(t.Time) > 10*time.Second {
		return fmt.Errorf("trade too old: %v", t.Time)
	}
	return nil
}
