import type { DOMLevel } from '@/types/dom'
import type { TickerConfig, MarketType } from '@/contexts/ChartControlsContext'

/**
 * Returns the next value strictly greater than v in the 1-2-5 × 10^n series:
 *   …0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50…
 *
 * The mantissa after normalising by 10^exp is always in [1, 10), so:
 *   mantissa < 2  → next is 2 × 10^exp
 *   mantissa < 5  → next is 5 × 10^exp
 *   otherwise     → next is 1 × 10^(exp+1)
 *
 * Rounding via ×1e9 / 1e9 kills float drift (e.g. 0.30000000004 → 0.3).
 */
function nextInGrid125(v: number): number {
  const exp = Math.floor(Math.log10(v))
  const scale = Math.pow(10, exp)
  // Normalise to [1, 10) and kill float drift
  const mantissa = Math.round((v / scale) * 1e9) / 1e9

  let nextMantissa: number
  let nextExp = exp
  if (mantissa < 2) {
    nextMantissa = 2
  } else if (mantissa < 5) {
    nextMantissa = 5
  } else {
    nextMantissa = 1
    nextExp = exp + 1
  }

  return Math.round(nextMantissa * Math.pow(10, nextExp) * 1e9) / 1e9
}

/**
 * Builds 8 price-step levels starting from baseStep using the 1-2-5 grid.
 *
 * Examples (verified):
 *   2.5  → [2.5, 5, 10, 20, 50, 100, 200, 500]
 *   5    → [5, 10, 20, 50, 100, 200, 500, 1000]
 *   1    → [1, 2, 5, 10, 20, 50, 100, 200]
 *   2    → [2, 5, 10, 20, 50, 100, 200, 500]
 *   0.5  → [0.5, 1, 2, 5, 10, 20, 50, 100]
 *   0.01 → [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2]
 *   0.001→ [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2]
 */
export function buildDOMCompressionLevels(baseStep: number): number[] {
  const levels: number[] = [baseStep]
  let current = baseStep
  for (let i = 1; i < 8; i++) {
    current = nextInGrid125(current)
    levels.push(current)
  }
  return levels
}

/**
 * Returns the base price-step in $ for the DOM at a given market.
 * baseStep = baseCompression * priceTick (both from ticker config stored in DB).
 */
export function getDomBaseStep(ticker: TickerConfig, market: MarketType): number {
  if (market === 'futures') {
    return Math.round(ticker.baseFutures * ticker.futurePriceTick * 1e9) / 1e9
  }
  return Math.round(ticker.baseSpot * ticker.spotPriceTick * 1e9) / 1e9
}

/**
 * Client-side aggregation of DOM levels into wider price buckets.
 * Formula mirrors the server/cluster formula: bucket = floor(price / step) * step.
 * Result is sorted descending by price (ask-then-bid order for display).
 */
export function aggregateDOMLevels(levels: DOMLevel[], step: number): DOMLevel[] {
  if (levels.length === 0 || step <= 0) return levels
  const map = new Map<number, { bid: number; ask: number }>()
  for (const l of levels) {
    const bucket = Math.floor(l.priceLevel / step) * step
    const existing = map.get(bucket)
    if (existing) {
      existing.bid += l.bidSize
      existing.ask += l.askSize
    } else {
      map.set(bucket, { bid: l.bidSize, ask: l.askSize })
    }
  }
  return Array.from(map.entries())
    .map(([price, v]) => ({ priceLevel: price, bidSize: v.bid, askSize: v.ask }))
    .sort((a, b) => b.priceLevel - a.priceLevel)
}
