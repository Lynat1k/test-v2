package depth

import (
	"sort"
	"strconv"
	"sync"

	"github.com/procluster/procluster/internal/aggregation"
)

type PriceLevel struct {
	Price float64
	Qty   float64
}

type DOMLevel struct {
	PriceLevel float64 `json:"priceLevel"`
	BidSize    float64 `json:"bidSize"`
	AskSize    float64 `json:"askSize"`
}

type OrderBook struct {
	mu        sync.RWMutex
	bids      map[float64]float64
	asks      map[float64]float64
	lastUpd   int64
	lastPrice float64
	symbol    string
	market    string
}

func NewOrderBook(symbol, market string) *OrderBook {
	return &OrderBook{
		bids:   make(map[float64]float64),
		asks:   make(map[float64]float64),
		symbol: symbol,
		market: market,
	}
}

func (ob *OrderBook) SnapshotFromREST(lastUpdateId int64, bids, asks []PriceLevel) {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	ob.bids = make(map[float64]float64, len(bids))
	for _, l := range bids {
		if l.Price > 0 && l.Qty >= 0 {
			ob.bids[l.Price] = l.Qty
		}
	}

	ob.asks = make(map[float64]float64, len(asks))
	for _, l := range asks {
		if l.Price > 0 && l.Qty >= 0 {
			ob.asks[l.Price] = l.Qty
		}
	}

	ob.lastUpd = lastUpdateId
}

func (ob *OrderBook) ApplyFuturesUpdate(firstU, lastU, prevU int64, bids, asks [][2]string) bool {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	if ob.lastUpd > 0 && prevU != ob.lastUpd {
		return false
	}

	for _, pair := range bids {
		if len(pair) < 2 {
			continue
		}
		price, err1 := strconv.ParseFloat(pair[0], 64)
		qty, err2 := strconv.ParseFloat(pair[1], 64)
		if err1 != nil || err2 != nil || price <= 0 {
			continue
		}
		if qty == 0 {
			delete(ob.bids, price)
		} else {
			ob.bids[price] = qty
		}
	}

	for _, pair := range asks {
		if len(pair) < 2 {
			continue
		}
		price, err1 := strconv.ParseFloat(pair[0], 64)
		qty, err2 := strconv.ParseFloat(pair[1], 64)
		if err1 != nil || err2 != nil || price <= 0 {
			continue
		}
		if qty == 0 {
			delete(ob.asks, price)
		} else {
			ob.asks[price] = qty
		}
	}

	ob.lastUpd = lastU
	return true
}

func (ob *OrderBook) ApplySpotUpdate(firstU, lastU int64, bids, asks [][2]string) bool {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	if ob.lastUpd > 0 && firstU != ob.lastUpd+1 {
		return false
	}

	for _, pair := range bids {
		if len(pair) < 2 {
			continue
		}
		price, err1 := strconv.ParseFloat(pair[0], 64)
		qty, err2 := strconv.ParseFloat(pair[1], 64)
		if err1 != nil || err2 != nil || price <= 0 {
			continue
		}
		if qty == 0 {
			delete(ob.bids, price)
		} else {
			ob.bids[price] = qty
		}
	}

	for _, pair := range asks {
		if len(pair) < 2 {
			continue
		}
		price, err1 := strconv.ParseFloat(pair[0], 64)
		qty, err2 := strconv.ParseFloat(pair[1], 64)
		if err1 != nil || err2 != nil || price <= 0 {
			continue
		}
		if qty == 0 {
			delete(ob.asks, price)
		} else {
			ob.asks[price] = qty
		}
	}

	ob.lastUpd = lastU
	return true
}

// ApplyFirstEvent применяет первое event после REST snapshot — без проверки sequence.
// По Binance protocol первое event после snapshot может иметь U < lastUpdateId (overlap),
// поэтому валидация prevU/firstU неприменима. Дельты идемпотентны: qty=N на цене P → P=N.
func (ob *OrderBook) ApplyFirstEvent(lastU int64, bids, asks [][2]string) {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	for _, pair := range bids {
		if len(pair) < 2 {
			continue
		}
		price, err1 := strconv.ParseFloat(pair[0], 64)
		qty, err2 := strconv.ParseFloat(pair[1], 64)
		if err1 != nil || err2 != nil || price <= 0 {
			continue
		}
		if qty == 0 {
			delete(ob.bids, price)
		} else {
			ob.bids[price] = qty
		}
	}

	for _, pair := range asks {
		if len(pair) < 2 {
			continue
		}
		price, err1 := strconv.ParseFloat(pair[0], 64)
		qty, err2 := strconv.ParseFloat(pair[1], 64)
		if err1 != nil || err2 != nil || price <= 0 {
			continue
		}
		if qty == 0 {
			delete(ob.asks, price)
		} else {
			ob.asks[price] = qty
		}
	}

	ob.lastUpd = lastU
}

func (ob *OrderBook) SetLastPrice(price float64) {
	ob.mu.Lock()
	ob.lastPrice = price
	ob.mu.Unlock()
}

func (ob *OrderBook) GetLastPrice() float64 {
	ob.mu.RLock()
	defer ob.mu.RUnlock()
	return ob.lastPrice
}

func (ob *OrderBook) GetLastUpdateID() int64 {
	ob.mu.RLock()
	defer ob.mu.RUnlock()
	return ob.lastUpd
}

func (ob *OrderBook) Clear() {
	ob.mu.Lock()
	defer ob.mu.Unlock()
	ob.bids = make(map[float64]float64)
	ob.asks = make(map[float64]float64)
	ob.lastUpd = 0
}

// Prune removes levels outside [centerPrice*(1-pctRange), centerPrice*(1+pctRange)].
// Protects RAM during long uptime: diff-stream may add far levels we no longer need.
// Range should be WIDER than the display filter (e.g. ±10% when display is ±5%) so
// price jumps don't drop levels we'd want.
func (ob *OrderBook) Prune(centerPrice, pctRange float64) (removedBids, removedAsks int) {
	if centerPrice <= 0 || pctRange <= 0 {
		return 0, 0
	}
	low := centerPrice * (1 - pctRange)
	high := centerPrice * (1 + pctRange)

	ob.mu.Lock()
	defer ob.mu.Unlock()

	for p := range ob.bids {
		if p < low || p > high {
			delete(ob.bids, p)
			removedBids++
		}
	}
	for p := range ob.asks {
		if p < low || p > high {
			delete(ob.asks, p)
			removedAsks++
		}
	}
	return
}

type BookStats struct {
	Bids     int
	Asks     int
	P5Price  float64 // 5th percentile of prices — ignores low-side dust outliers
	P95Price float64 // 95th percentile of prices — ignores high-side dust outliers
}

// Stats returns a snapshot of book size and a robust price extent.
// Uses 5th/95th percentiles so single dust orders far from the mid don't
// distort the "coverage" diagnostic.
func (ob *OrderBook) Stats() BookStats {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	s := BookStats{Bids: len(ob.bids), Asks: len(ob.asks)}
	total := s.Bids + s.Asks
	if total == 0 {
		return s
	}

	prices := make([]float64, 0, total)
	for p := range ob.bids {
		prices = append(prices, p)
	}
	for p := range ob.asks {
		prices = append(prices, p)
	}
	sort.Float64s(prices)

	p5idx := int(float64(total) * 0.05)
	p95idx := int(float64(total) * 0.95)
	if p95idx >= total {
		p95idx = total - 1
	}
	s.P5Price = prices[p5idx]
	s.P95Price = prices[p95idx]
	return s
}

func (ob *OrderBook) GetAggregatedLevels(centerPrice float64, pctRange float64, baseStep float64) []DOMLevel {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	if centerPrice <= 0 || baseStep <= 0 {
		return nil
	}

	low := centerPrice * (1 - pctRange)
	high := centerPrice * (1 + pctRange)

	type aggLevel struct {
		bidSum float64
		askSum float64
	}
	levels := make(map[float64]*aggLevel)

	for price, qty := range ob.bids {
		if price >= low && price <= high {
			pl := aggregation.CompressPrice(price, baseStep)
			al, ok := levels[pl]
			if !ok {
				al = &aggLevel{}
				levels[pl] = al
			}
			al.bidSum += qty
		}
	}

	for price, qty := range ob.asks {
		if price >= low && price <= high {
			pl := aggregation.CompressPrice(price, baseStep)
			al, ok := levels[pl]
			if !ok {
				al = &aggLevel{}
				levels[pl] = al
			}
			al.askSum += qty
		}
	}

	result := make([]DOMLevel, 0, len(levels))
	for pl, al := range levels {
		result = append(result, DOMLevel{
			PriceLevel: pl,
			BidSize:    aggregation.TruncateVolume(al.bidSum),
			AskSize:    aggregation.TruncateVolume(al.askSum),
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].PriceLevel < result[j].PriceLevel
	})

	return result
}
