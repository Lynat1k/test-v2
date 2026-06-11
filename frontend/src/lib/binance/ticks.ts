import type { ClusterCandle, ClusterCell } from '@/types'

export async function fetchBinanceTicksAndAggregate(
  symbol: string,
  isFutures: boolean,
  priceStep: number,
  compressionTicks: number = 50
): Promise<ClusterCandle[]> {
  try {
    const binanceSymbol = symbol.toUpperCase().replace("/", "")
    const res = await fetch(`/api/binance-vision-ticks?symbol=${binanceSymbol}&priceStep=${priceStep}&compression=${compressionTicks}&isFutures=${isFutures}`)
    if (res.ok) {
      const data = await res.json()
      if (data.status === "ok" && Array.isArray(data.candles) && data.candles.length > 0) {
        return data.candles
      }
    }
  } catch {
    // Server API unavailable, fall back to direct REST
  }

  const binanceSymbol = symbol.toUpperCase().replace("/", "")
  const baseUrl = isFutures ? "https://fapi.binance.com" : "https://api.binance.com"
  const limit = 1000
  const initialUrl = isFutures
    ? `${baseUrl}/fapi/v1/aggTrades?symbol=${binanceSymbol}&limit=${limit}`
    : `${baseUrl}/api/v3/aggTrades?symbol=${binanceSymbol}&limit=${limit}`

  const res = await fetch(initialUrl)
  if (!res.ok) throw new Error(`Binance API response status: ${res.status}`)
  const latestTrades = await res.json()
  if (!Array.isArray(latestTrades) || latestTrades.length === 0) return []

  let allTrades = [...latestTrades]
  const firstId = latestTrades[0].a

  const pages = 3
  const fetchPromises: Promise<unknown[]>[] = []
  for (let i = 1; i <= pages; i++) {
    const targetFromId = Math.max(1, firstId - i * 1000)
    const pageUrl = isFutures
      ? `${baseUrl}/fapi/v1/aggTrades?symbol=${binanceSymbol}&limit=1000&fromId=${targetFromId}`
      : `${baseUrl}/api/v3/aggTrades?symbol=${binanceSymbol}&limit=1000&fromId=${targetFromId}`
    fetchPromises.push(
      fetch(pageUrl).then(async r => r.ok ? await r.json() : []).catch(() => [])
    )
  }

  const results = await Promise.all(fetchPromises)
  results.forEach(batch => { allTrades = [...allTrades, ...batch as typeof allTrades] })
  allTrades.sort((a: { a: number }, b: { a: number }) => a.a - b.a)

  const candles: ClusterCandle[] = []
  for (let i = 0; i < allTrades.length; i += compressionTicks) {
    const chunk = allTrades.slice(i, i + compressionTicks)
    if (chunk.length < 5) continue

    const prices = chunk.map((t: { p: string }) => parseFloat(t.p))
    const open = prices[0]!
    const close = prices[prices.length - 1]!
    const high = Math.max(...prices)
    const low = Math.min(...prices)
    const timestamp = chunk[chunk.length - 1].T

    const totalVolume = chunk.reduce((sum: number, t: { q: string }) => sum + parseFloat(t.q), 0)
    const cellMap: { [price: number]: { bid: number; ask: number; volume: number } } = {}

    chunk.forEach((t: { p: string; q: string; m: boolean }) => {
      const pVal = parseFloat(t.p)
      const stepPrice = Math.floor(pVal / priceStep) * priceStep
      const roundedPrice = parseFloat(stepPrice.toFixed(4))
      if (!cellMap[roundedPrice]) cellMap[roundedPrice] = { bid: 0, ask: 0, volume: 0 }
      const qty = parseFloat(t.q)
      if (t.m) { cellMap[roundedPrice].bid += qty } else { cellMap[roundedPrice].ask += qty }
      cellMap[roundedPrice].volume += qty
    })

    const cells: ClusterCell[] = []
    let maxCellVol = 0
    let pocPrice = (open + close) / 2

    Object.keys(cellMap).forEach(pStr => {
      const pNum = parseFloat(pStr)
      const data = cellMap[pNum]!
      cells.push({
        price: pNum, bid: parseFloat(data.bid.toFixed(4)), ask: parseFloat(data.ask.toFixed(4)),
        volume: parseFloat(data.volume.toFixed(4)), isPoc: false, isBuyImbalance: false, isSellImbalance: false
      })
    })

    cells.forEach(c => { if (c.volume > maxCellVol) { maxCellVol = c.volume; pocPrice = c.price } })
    cells.forEach(c => {
      if (c.price === pocPrice) c.isPoc = true
      c.isBuyImbalance = c.ask > c.bid * 1.8 && c.volume > (totalVolume / cells.length) * 0.4
      c.isSellImbalance = c.bid > c.ask * 1.8 && c.volume > (totalVolume / cells.length) * 0.4
    })
    cells.sort((a, b) => b.price - a.price)

    const sortedByVol = [...cells].sort((a, b) => b.volume - a.volume)
    const targetVol = totalVolume * 0.7
    let runningSum = 0
    const vaPrices: number[] = []
    for (const itemC of sortedByVol) {
      runningSum += itemC.volume
      vaPrices.push(itemC.price)
      if (runningSum >= targetVol) break
    }

    const val = vaPrices.length > 0 ? Math.min(...vaPrices) : low
    const vah = vaPrices.length > 0 ? Math.max(...vaPrices) : high
    const totalBid = cells.reduce((sum, c) => sum + c.bid, 0)
    const totalAsk = cells.reduce((sum, c) => sum + c.ask, 0)

    candles.push({
      timestamp, open: parseFloat(open.toFixed(4)), high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)), close: parseFloat(close.toFixed(4)),
      volume: parseFloat(totalVolume.toFixed(4)), delta: parseFloat((totalAsk - totalBid).toFixed(4)),
      pocPrice: parseFloat(pocPrice.toFixed(4)), cells, vah: parseFloat(vah.toFixed(4)),
      val: parseFloat(val.toFixed(4)), tickCount: chunk.length
    })
  }
  return candles
}
