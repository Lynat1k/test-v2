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

// BookDepthRatio — снапшот суммарной глубины стакана (лимитные qty) в полосах
// ±1/3/5% от центральной цены на момент закрытия минутной свечи. Источник для
// индикатора Bid & Ask Ratio. Bid_N/Ask_N — сырые суммы объёма (truncate до 1
// знака выполняется при вставке в ClickHouse).
type BookDepthRatio struct {
	Symbol     string
	Market     string
	SnapshotTS time.Time
	Bid1       float64
	Ask1       float64
	Bid3       float64
	Ask3       float64
	Bid5       float64
	Ask5       float64
}

// LongShortRatio — глобальный long/short account ratio (отношение числа аккаунтов
// в long к числу в short) на 5-минутной сетке. Только futures. Доли
// восстанавливаются точно: long% = ratio/(ratio+1)*100. Источник для индикатора
// Long/Short Account Ratio.
type LongShortRatio struct {
	Symbol string
	Market string
	TS     time.Time
	Ratio  float64
}
