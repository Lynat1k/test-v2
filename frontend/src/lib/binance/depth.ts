import type { OrderBookRow } from '@/types'

export async function fetchBinanceDepth(
  symbol: string, isFutures: boolean, priceStep: number
): Promise<{ bids: OrderBookRow[]; asks: OrderBookRow[] } | null> {
  const binanceSymbol = symbol.toUpperCase().replace("/", "")
  const endpoint = isFutures
    ? `https://fapi.binance.com/fapi/v1/depth?symbol=${binanceSymbol}&limit=1000`
    : `https://api.binance.com/api/v3/depth?symbol=${binanceSymbol}&limit=1000`

  try {
    const res = await fetch(endpoint)
    if (!res.ok) throw new Error(`depth status ${res.status}`)
    const data = await res.json()
    if (!data || !Array.isArray(data.bids) || !Array.isArray(data.asks)) {
      throw new Error("Invalid raw depth")
    }

    const aggBids: Record<number, number> = {}
    const aggAsks: Record<number, number> = {}

    data.bids.forEach((item: [string, string]) => {
      const p = parseFloat(item[0])
      const q = parseFloat(item[1])
      const bucketPrice = parseFloat((Math.floor(p / priceStep) * priceStep).toFixed(4))
      aggBids[bucketPrice] = (aggBids[bucketPrice] || 0) + q
    })

    data.asks.forEach((item: [string, string]) => {
      const p = parseFloat(item[0])
      const q = parseFloat(item[1])
      const bucketPrice = parseFloat((Math.ceil(p / priceStep) * priceStep).toFixed(4))
      aggAsks[bucketPrice] = (aggAsks[bucketPrice] || 0) + q
    })

    const bidsArr: OrderBookRow[] = []
    let cumulativeBid = 0
    Object.keys(aggBids).map(Number).sort((a, b) => b - a).slice(0, 250).forEach(price => {
      const amount = aggBids[price]!
      cumulativeBid += amount
      bidsArr.push({ price, amount, total: cumulativeBid, percentage: 0 })
    })

    const asksArr: OrderBookRow[] = []
    let cumulativeAsk = 0
    Object.keys(aggAsks).map(Number).sort((a, b) => a - b).slice(0, 250).forEach(price => {
      const amount = aggAsks[price]!
      cumulativeAsk += amount
      asksArr.push({ price, amount, total: cumulativeAsk, percentage: 0 })
    })

    const maxTotal = Math.max(
      bidsArr.length > 0 ? bidsArr[bidsArr.length - 1]!.total : 1,
      asksArr.length > 0 ? asksArr[asksArr.length - 1]!.total : 1
    )
    bidsArr.forEach(b => { b.percentage = (b.total / maxTotal) * 100 })
    asksArr.forEach(a => { a.percentage = (a.total / maxTotal) * 100 })

    return { bids: bidsArr, asks: asksArr }
  } catch {
    return null
  }
}
