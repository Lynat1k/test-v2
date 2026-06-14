package model

import "time"

type Side string

const (
	SideBuy  Side = "BUY"
	SideSell Side = "SELL"
)

type Trade struct {
	Price        float64
	Qty          float64
	IsBuyerMaker bool
	TradeID      int64
	Time         time.Time
	Market       string
	Symbol       string
}

type ClusterRow struct {
	Symbol      string
	Timeframe   string
	CandleOpen  time.Time
	PriceLevel  float64
	BidVolume   float64
	AskVolume   float64
	Compression uint16
	OpenPrice   float64
	ClosePrice  float64
}

type Candle struct {
	Symbol      string
	Timeframe   string
	CandleOpen  time.Time
	Open        float64
	High        float64
	Low         float64
	Close       float64
	TotalBid    float64
	TotalAsk    float64
	TotalDelta  float64
	TotalVolume float64
	TradesCount uint64
}

type DOMRow struct {
	Symbol      string
	SnapshotTS  time.Time
	PriceLevel  float64
	BidSize     float64
	AskSize     float64
	Compression uint16
}

type DOMSnapshot struct {
	Symbol     string
	SnapshotTS time.Time
	Levels     []DOMLevel
}

type DOMLevel struct {
	PriceLevel float64
	BidSize    float64
	AskSize    float64
}
