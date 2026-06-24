package aggregation

import (
	"math"
	"sort"

	"github.com/procluster/procluster/internal/model"
)

func TruncateVolume(v float64) float64 {
	return math.Trunc(v*10) / 10
}

func CompressPrice(price float64, base float64) float64 {
	return math.Floor(price/base) * base
}

func GenerateLevels(base float64, maxLevels int) []float64 {
	levels := make([]float64, maxLevels)
	for i := 0; i < maxLevels; i++ {
		levels[i] = base * float64(i+1)
	}
	return levels
}

func InterpretTrade(isBuyerMaker bool) model.Side {
	if isBuyerMaker {
		return model.SideSell
	}
	return model.SideBuy
}

func SortByTradeId(trades []model.Trade) {
	sort.Slice(trades, func(i, j int) bool {
		return trades[i].TradeID < trades[j].TradeID
	})
}

func CompressTrades(trades []model.Trade, config CompressionConfig) []model.ClusterRow {
	SortByTradeId(trades)

	buckets := make(map[float64]*model.ClusterRow)

	for _, t := range trades {
		level := CompressPrice(t.Price, config.BaseLevel*config.PriceTick)
		row, ok := buckets[level]
		if !ok {
			row = &model.ClusterRow{
				Symbol:      config.Symbol,
				PriceLevel:  level,
				Compression: uint16(config.BaseLevel),
			}
			buckets[level] = row
		}

		if InterpretTrade(t.IsBuyerMaker) == model.SideSell {
			row.BidVolume += t.Qty
		} else {
			row.AskVolume += t.Qty
		}
	}

	result := make([]model.ClusterRow, 0, len(buckets))
	for _, row := range buckets {
		row.BidVolume = TruncateVolume(row.BidVolume)
		row.AskVolume = TruncateVolume(row.AskVolume)
		result = append(result, *row)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].PriceLevel < result[j].PriceLevel
	})

	return result
}
