package aggregation

import (
	"sort"
	"time"

	"github.com/procluster/procluster/internal/model"
)

type intervalKey struct {
	CandleOpen time.Time
	PriceLevel float64
}

type intervalTracker struct {
	first *model.ClusterRow
	last  *model.ClusterRow
}

func AlignToTimeframe(t time.Time, tf string) time.Time {
	// Binance market time is UTC. Alignment must not depend on the process TZ:
	// live aggregator feeds trade.Time from time.UnixMilli (time.Local), so on a
	// non-UTC host the 4h/1d branches below (time.Date with t.Location()) would
	// bucket on local boundaries and diverge from the UTC-bucketed indicator
	// read paths. Force UTC so all call sites align identically.
	t = t.UTC()
	switch tf {
	case "5m":
		minute := t.Minute() / 5 * 5
		return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), minute, 0, 0, t.Location())
	case "15m":
		minute := t.Minute() / 15 * 15
		return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), minute, 0, 0, t.Location())
	case "30m":
		minute := t.Minute() / 30 * 30
		return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), minute, 0, 0, t.Location())
	case "1h":
		return t.Truncate(time.Hour)
	case "4h":
		hour := t.Hour() / 4 * 4
		return time.Date(t.Year(), t.Month(), t.Day(), hour, 0, 0, 0, t.Location())
	case "1d":
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	}
	return t
}

func AggregateForTimeframe(rows []model.ClusterRow, tf string) []model.ClusterRow {
	buckets := make(map[intervalKey]*model.ClusterRow)
	trackers := make(map[time.Time]*intervalTracker)

	for _, row := range rows {
		aligned := AlignToTimeframe(row.CandleOpen, tf)
		key := intervalKey{CandleOpen: aligned, PriceLevel: row.PriceLevel}

		existing, ok := buckets[key]
		if !ok {
			existing = &model.ClusterRow{
				Symbol:      row.Symbol,
				Timeframe:   tf,
				CandleOpen:  aligned,
				PriceLevel:  row.PriceLevel,
				Compression: row.Compression,
			}
			buckets[key] = existing
		}
		existing.BidVolume += row.BidVolume
		existing.AskVolume += row.AskVolume

		tr, ok := trackers[aligned]
		if !ok {
			tr = &intervalTracker{}
			trackers[aligned] = tr
		}
		if tr.first == nil || row.CandleOpen.Before(tr.first.CandleOpen) {
			fCopy := row
			tr.first = &fCopy
		}
		if tr.last == nil || row.CandleOpen.After(tr.last.CandleOpen) {
			lCopy := row
			tr.last = &lCopy
		}
	}

	result := make([]model.ClusterRow, 0, len(buckets))
	for key, row := range buckets {
		tr := trackers[key.CandleOpen]
		if tr != nil && tr.first != nil {
			row.OpenPrice = tr.first.OpenPrice
		}
		if tr != nil && tr.last != nil {
			row.ClosePrice = tr.last.ClosePrice
		}
		result = append(result, *row)
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].CandleOpen.Equal(result[j].CandleOpen) {
			return result[i].PriceLevel < result[j].PriceLevel
		}
		return result[i].CandleOpen.Before(result[j].CandleOpen)
	})

	return result
}

func Rollup(rows []model.ClusterRow) []model.ClusterRow {
	var result []model.ClusterRow
	for _, tf := range []string{"5m", "15m", "30m", "1h", "4h", "1d"} {
		rollupRows := AggregateForTimeframe(rows, tf)
		for i := range rollupRows {
			rollupRows[i].BidVolume = TruncateVolume(rollupRows[i].BidVolume)
			rollupRows[i].AskVolume = TruncateVolume(rollupRows[i].AskVolume)
			rollupRows[i].Timeframe = tf
		}
		result = append(result, rollupRows...)
	}
	return result
}
