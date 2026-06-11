import type { ClusterCell, ClusterCandle, OrderBookRow, LiveTrade, CryptoPair } from '@/types'

export const AVAILABLE_PAIRS: CryptoPair[] = [
  { symbol: "BTC/USDT", name: "Bitcoin", price: 68420.0, change24h: 3.42, volume24h: 3420000000, delta24h: 12450.0, priceStep: 2.5 },
  { symbol: "ETH/USDT", name: "Ethereum", price: 3420.5, change24h: -1.25, volume24h: 1890000000, delta24h: -4120.0, priceStep: 0.25 },
  { symbol: "SOL/USDT", name: "Solana", price: 142.75, change24h: 8.84, volume24h: 920000000, delta24h: 8900.0, priceStep: 0.25 }
]

function boxMullerTransform(): number {
  const u = 1 - Math.random()
  const v = 1 - Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

export function generateClusterCells(
  low: number, high: number, open: number, close: number,
  priceStep: number, avgVolume: number
): ClusterCell[] {
  const startPrice = Math.floor(low / priceStep) * priceStep
  const endPrice = Math.ceil(high / priceStep) * priceStep
  const centerPrice = (open + close) / 2
  const maxPriceDistance = Math.max(endPrice - startPrice, priceStep)

  const tempCells: { price: number; bid: number; ask: number; volume: number }[] = []
  let maxVol = 0
  let pocIndex = -1

  for (let price = startPrice; price <= endPrice; price += priceStep) {
    const distanceFromCenter = Math.abs(price - centerPrice)
    const volumeFactor = Math.max(0.1, Math.exp(-Math.pow(distanceFromCenter / (maxPriceDistance * 0.4), 2)))
    const cellVol = avgVolume * volumeFactor * (0.6 + Math.random() * 0.8)
    const bidRatio = 0.35 + Math.random() * 0.3
    const bid = cellVol * bidRatio
    const ask = cellVol * (1 - bidRatio)

    tempCells.push({ price: parseFloat(price.toFixed(4)), bid, ask, volume: cellVol })
  }

  tempCells.forEach((c, idx) => {
    if (c.volume > maxVol) { maxVol = c.volume; pocIndex = idx }
  })

  const cells: ClusterCell[] = tempCells.map((c, idx) => ({
    ...c,
    isPoc: idx === pocIndex,
    isBuyImbalance: c.ask > c.bid * 1.8 && c.volume > avgVolume * 0.3,
    isSellImbalance: c.bid > c.ask * 1.8 && c.volume > avgVolume * 0.3,
  }))

  return cells.sort((a, b) => b.price - a.price)
}

export function generateHistoricalCandles(
  pair: CryptoPair, count: number, _timeframeMinutes: number
): ClusterCandle[] {
  const candles: ClusterCandle[] = []
  let currentPrice = pair.price
  const timeStep = _timeframeMinutes * 60 * 1000
  let timestamp = Date.now() - count * timeStep

  for (let i = 0; i < count; i++) {
    const changePercent = boxMullerTransform() * 0.003
    const open = currentPrice
    const close = currentPrice * (1 + changePercent)
    const maxDev = Math.abs(open - close) * (0.3 + Math.random() * 1.2)
    const high = Math.max(open, close) + maxDev
    const low = Math.min(open, close) - maxDev
    const candleVolume = 200 + Math.random() * 800
    const cells = generateClusterCells(low, high, open, close, pair.priceStep, candleVolume / 10)
    const pocCell = cells.find(c => c.isPoc)
    const pocPrice = pocCell ? pocCell.price : (open + close) / 2
    const bidTotal = cells.reduce((sum, c) => sum + c.bid, 0)
    const askTotal = cells.reduce((sum, c) => sum + c.ask, 0)
    const delta = askTotal - bidTotal
    const sortedByVol = [...cells].sort((a, b) => b.volume - a.volume)
    const targetVolume = candleVolume * 0.7
    let accumulatedVolume = 0
    const vaCells: number[] = []
    for (const cell of sortedByVol) {
      accumulatedVolume += cell.volume
      vaCells.push(cell.price)
      if (accumulatedVolume >= targetVolume) break
    }
    const val = vaCells.length > 0 ? Math.min(...vaCells) : low
    const vah = vaCells.length > 0 ? Math.max(...vaCells) : high

    candles.push({
      timestamp, open: parseFloat(open.toFixed(4)), high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)), close: parseFloat(close.toFixed(4)),
      volume: candleVolume, delta, pocPrice: parseFloat(pocPrice.toFixed(4)),
      cells, vah: parseFloat(vah.toFixed(4)), val: parseFloat(val.toFixed(4))
    })
    currentPrice = close
    timestamp += timeStep
  }
  return candles
}

export function generateOrderBook(midPrice: number, priceStep: number): { bids: OrderBookRow[]; asks: OrderBookRow[] } {
  const bids: OrderBookRow[] = []
  const asks: OrderBookRow[] = []
  const rowsCount = 200
  let totalBid = 0
  let totalAsk = 0

  for (let i = 1; i <= rowsCount; i++) {
    const price = midPrice - i * priceStep
    const isWhaleWall = i === 4 || i === 11
    const baseAmount = isWhaleWall ? (8 + Math.random() * 25) : (0.1 + Math.random() * 5)
    const amount = baseAmount / (1 + (i * 0.02))
    totalBid += amount
    bids.push({ price: parseFloat(price.toFixed(4)), amount, total: totalBid, percentage: 0 })
  }

  for (let i = 1; i <= rowsCount; i++) {
    const price = midPrice + i * priceStep
    const isWhaleWall = i === 5 || i === 13
    const baseAmount = isWhaleWall ? (8 + Math.random() * 25) : (0.1 + Math.random() * 5)
    const amount = baseAmount / (1 + (i * 0.02))
    totalAsk += amount
    asks.push({ price: parseFloat(price.toFixed(4)), amount, total: totalAsk, percentage: 0 })
  }

  const maxTotal = Math.max(totalBid, totalAsk)
  bids.forEach(b => { b.percentage = (b.total / maxTotal) * 100 })
  asks.forEach(a => { a.percentage = (a.total / maxTotal) * 100 })

  return { bids, asks }
}

export function generateLiveTrade(midPrice: number, _priceStep: number): LiveTrade {
  const side = Math.random() > 0.48 ? "buy" : "sell"
  const spreadPercent = 0.0002
  const priceOffset = midPrice * spreadPercent * Math.random()
  const price = side === "buy" ? midPrice + priceOffset : midPrice - priceOffset
  const isWhale = Math.random() > 0.95
  const amount = isWhale ? (15 + Math.random() * 45) : (0.01 + Math.random() * 4.5)

  return {
    id: Math.random().toString(36).substr(2, 9),
    timestamp: Date.now(),
    price: parseFloat(price.toFixed(4)),
    amount, side, isWhale
  }
}
