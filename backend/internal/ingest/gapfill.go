package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/procluster/procluster/internal/model"
)

type GapFiller struct {
	client *http.Client
}

func NewGapFiller() *GapFiller {
	return &GapFiller{
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

type historicalTrade struct {
	ID           int64  `json:"id"`
	Price        string `json:"price"`
	Quantity     string `json:"qty"`
	Time         int64  `json:"time"`
	IsBuyerMaker bool   `json:"isBuyerMaker"`
}

type aggTrade struct {
	AggregateTradeID int64  `json:"a"`
	Price            string `json:"p"`
	Quantity         string `json:"q"`
	FirstTradeID     int64  `json:"f"`
	LastTradeID      int64  `json:"l"`
	TradeTime        int64  `json:"T"`
	IsBuyerMaker     bool   `json:"m"`
}

func (g *GapFiller) FillGapFutures(ctx context.Context, symbol string, lastSeenID int64) ([]model.Trade, error) {
	var allTrades []model.Trade
	fromID := lastSeenID + 1

	for {
		url := fmt.Sprintf("https://fapi.binance.com/fapi/v1/aggTrades?symbol=%s&fromId=%d&limit=1000", symbol, fromID)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}

		resp, err := g.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("fetch aggTrades: %w", err)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("aggTrades API returned %d: %s", resp.StatusCode, string(body))
		}

		var trades []aggTrade
		if err := json.Unmarshal(body, &trades); err != nil {
			return nil, fmt.Errorf("unmarshal aggTrades: %w", err)
		}

		if len(trades) == 0 {
			break
		}

		for _, at := range trades {
			price, _ := strconv.ParseFloat(at.Price, 64)
			qty, _ := strconv.ParseFloat(at.Quantity, 64)
			allTrades = append(allTrades, model.Trade{
				Price:        price,
				Qty:          qty,
				IsBuyerMaker: at.IsBuyerMaker,
				TradeID:      at.AggregateTradeID,
				Time:         time.UnixMilli(at.TradeTime),
			})
		}

		lastID := trades[len(trades)-1].AggregateTradeID
		if lastID == fromID-1 || len(trades) < 1000 {
			break
		}
		fromID = lastID + 1
	}

	return allTrades, nil
}

func (g *GapFiller) FillGapSpot(ctx context.Context, symbol string, lastSeenID int64) ([]model.Trade, error) {
	var allTrades []model.Trade
	fromID := lastSeenID + 1

	for {
		url := fmt.Sprintf("https://api.binance.com/api/v3/historicalTrades?symbol=%s&fromId=%d&limit=1000", symbol, fromID)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}

		resp, err := g.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("fetch historicalTrades: %w", err)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("historicalTrades API returned %d: %s", resp.StatusCode, string(body))
		}

		var trades []historicalTrade
		if err := json.Unmarshal(body, &trades); err != nil {
			return nil, fmt.Errorf("unmarshal historicalTrades: %w", err)
		}

		if len(trades) == 0 {
			break
		}

		for _, ht := range trades {
			price, _ := strconv.ParseFloat(ht.Price, 64)
			qty, _ := strconv.ParseFloat(ht.Quantity, 64)
			allTrades = append(allTrades, model.Trade{
				Price:        price,
				Qty:          qty,
				IsBuyerMaker: ht.IsBuyerMaker,
				TradeID:      ht.ID,
				Time:         time.UnixMilli(ht.Time),
			})
		}

		lastID := trades[len(trades)-1].ID
		if lastID == fromID-1 || len(trades) < 1000 {
			break
		}
		fromID = lastID + 1
	}

	return allTrades, nil
}
