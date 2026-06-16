package history

import (
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/procluster/procluster/internal/model"
)

type MarketType string

const (
	MarketFutures MarketType = "futures"
	MarketSpot    MarketType = "spot"
)

func ParseCSV(reader io.Reader, market MarketType) ([]model.Trade, error) {
	r := csv.NewReader(reader)
	r.LazyQuotes = true

	var trades []model.Trade
	lineNum := 0
	for {
		record, err := r.Read()
		if err == io.EOF {
			break
		}
		lineNum++

		if err != nil {
			log.Printf("[csv] line %d: read error: %v, skipping", lineNum, err)
			continue
		}

		if len(record) == 0 {
			continue
		}

		if lineNum == 1 && looksLikeHeader(record[0]) {
			log.Printf("[csv] line 1: header detected, skipping")
			continue
		}

		trade, err := parseRecord(record, market, lineNum)
		if err != nil {
			log.Printf("[csv] line %d: %v, skipping", lineNum, err)
			continue
		}

		trades = append(trades, *trade)
	}

	return trades, nil
}

func looksLikeHeader(s string) bool {
	lower := strings.ToLower(s)
	return strings.Contains(lower, "aggtradeid") ||
		strings.Contains(lower, "price") ||
		strings.Contains(lower, "timestamp") ||
		strings.Contains(lower, "buyer")
}

func parseRecord(record []string, market MarketType, lineNum int) (*model.Trade, error) {
	var aggTradeID int64
	var price float64
	var qty float64
	var timestampMs int64
	var isBuyerMaker bool

	switch market {
	case MarketFutures:
		if len(record) < 7 {
			return nil, fmt.Errorf("expected 7 columns, got %d", len(record))
		}

		var err error
		aggTradeID, err = strconv.ParseInt(strings.TrimSpace(record[0]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse aggTradeId: %w", err)
		}

		price, err = strconv.ParseFloat(strings.TrimSpace(record[1]), 64)
		if err != nil {
			return nil, fmt.Errorf("parse price: %w", err)
		}

		qty, err = strconv.ParseFloat(strings.TrimSpace(record[2]), 64)
		if err != nil {
			return nil, fmt.Errorf("parse qty: %w", err)
		}

		timestampMs, err = strconv.ParseInt(strings.TrimSpace(record[5]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse timestamp: %w", err)
		}

		isBuyerMaker, err = strconv.ParseBool(strings.TrimSpace(record[6]))
		if err != nil {
			return nil, fmt.Errorf("parse isBuyerMaker: %w", err)
		}

	case MarketSpot:
		if len(record) < 8 {
			return nil, fmt.Errorf("expected 8 columns, got %d", len(record))
		}

		var err error
		aggTradeID, err = strconv.ParseInt(strings.TrimSpace(record[0]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse aggTradeId: %w", err)
		}

		price, err = strconv.ParseFloat(strings.TrimSpace(record[1]), 64)
		if err != nil {
			return nil, fmt.Errorf("parse price: %w", err)
		}

		qty, err = strconv.ParseFloat(strings.TrimSpace(record[2]), 64)
		if err != nil {
			return nil, fmt.Errorf("parse qty: %w", err)
		}

		timestampRaw, err := strconv.ParseInt(strings.TrimSpace(record[5]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse timestamp: %w", err)
		}
		timestampMs = timestampRaw / 1000 // SEE ALSO: admin/historyloader.go parseAggTradeCSV (same µs→ms rule for spot)

		isBuyerMaker = parseBoolFlexible(strings.TrimSpace(record[6]))
	}

	if aggTradeID <= 0 {
		return nil, fmt.Errorf("invalid aggTradeId: %d", aggTradeID)
	}
	if price <= 0 {
		return nil, fmt.Errorf("invalid price: %f", price)
	}
	if qty <= 0 {
		return nil, fmt.Errorf("invalid qty: %f", qty)
	}
	if timestampMs <= 0 {
		return nil, fmt.Errorf("invalid timestamp: %d", timestampMs)
	}

	return &model.Trade{
		Price:        price,
		Qty:          qty,
		IsBuyerMaker: isBuyerMaker,
		TradeID:      aggTradeID,
		Time:         time.UnixMilli(timestampMs),
	}, nil
}

func parseBoolFlexible(s string) bool {
	switch strings.ToLower(s) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		return false
	}
}
