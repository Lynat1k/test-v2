import type { ClusterCandle, ClusterCell } from '@/types'

export async function fetchBinanceKlines(
  symbol: string, interval: string, isFutures: boolean, priceStep: number
): Promise<ClusterCandle[]> {
  const binanceSymbol = symbol.toUpperCase().replace("/", "")

  try {
    const proxyUrl = `/api/binance-klines?symbol=${binanceSymbol}&interval=${interval}&isFutures=${isFutures}&priceStep=${priceStep}`
    const proxyRes = await fetch(proxyUrl)
    if (proxyRes.ok) {
      const resultObj = await proxyRes.json()
      if (resultObj.status === "ok" && Array.isArray(resultObj.candles) && resultObj.candles.length > 0) {
        return resultObj.candles
      }
    }
  } catch {
    // Server proxy unavailable
  }

  const endpoint = isFutures
    ? `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSymbol}&interval=${interval}&limit=1000`
    : `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=1000`

  const res = await fetch(endpoint)
  if (!res.ok) throw new Error(`STATUS ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error("Invalid format from Binance")

  return data.map((item: (string | number)[]) => {
    const timestamp = Number(item[0])
    const open = parseFloat(item[1] as string)
    const high = parseFloat(item[2] as string)
    const low = parseFloat(item[3] as string)
    const close = parseFloat(item[4] as string)
    const volume = parseFloat(item[5] as string)
    const takerBuyVol = parseFloat(item[9] as string)
    const takerSellVol = Math.max(0, volume - takerBuyVol)

    const startPrice = Math.floor(low / priceStep) * priceStep
    const endPrice = Math.ceil(high / priceStep) * priceStep
    const centerPrice = (open + close) / 2
    const maxPriceDistance = Math.max(endPrice - startPrice, priceStep)

    const tempCells: { price: number; bid: number; ask: number; volume: number }[] = []
    let maxCellVol = 0
    let pocIndex = -1
    let activePriceStep = priceStep
    let rangeUnits = Math.round((endPrice - startPrice) / activePriceStep)
    if (rangeUnits > 250) {
      activePriceStep = priceStep * Math.ceil(rangeUnits / 250)
    }

    let cellCount = 0
    for (let price = startPrice; price <= endPrice; price += activePriceStep) {
      cellCount++
      if (cellCount > 250) break
    }

    let currentPriceLevel = startPrice
    const parsedLevels: number[] = []
    for (let i = 0; i < cellCount; i++) {
      parsedLevels.push(parseFloat(currentPriceLevel.toFixed(4)))
      currentPriceLevel += activePriceStep
    }

    const weights = parsedLevels.map(p => {
      const dist = Math.abs(p - centerPrice)
      return Math.max(0.01, Math.exp(-Math.pow(dist / (maxPriceDistance * 0.45), 2)))
    })
    const sumWeights = weights.reduce((s, w) => s + w, 0) || 1

    parsedLevels.forEach((priceLevel, idx) => {
      const weight = weights[idx]! / sumWeights
      const levelVol = volume * weight
      const takerRatio = volume > 0 ? takerBuyVol / volume : 0.5
      tempCells.push({
        price: priceLevel,
        ask: levelVol * takerRatio,
        bid: levelVol * (1 - takerRatio),
        volume: levelVol
      })
    })

    tempCells.forEach((c, idx) => {
      if (c.volume > maxCellVol) { maxCellVol = c.volume; pocIndex = idx }
    })

    const finalCells: ClusterCell[] = tempCells.map((c, idx) => ({
      price: c.price,
      bid: parseFloat(c.bid.toFixed(4)),
      ask: parseFloat(c.ask.toFixed(4)),
      volume: parseFloat(c.volume.toFixed(4)),
      isPoc: idx === pocIndex,
      isBuyImbalance: c.ask > c.bid * 1.8 && c.volume > (volume / tempCells.length) * 0.4,
      isSellImbalance: c.bid > c.ask * 1.8 && c.volume > (volume / tempCells.length) * 0.4,
    }))

    const sortedCells = finalCells.sort((a, b) => b.price - a.price)
    const pocCell = sortedCells.find(c => c.isPoc)
    const sortedByVol = [...sortedCells].sort((a, b) => b.volume - a.volume)
    const targetVolSurround = volume * 0.7
    let runningSum = 0
    const vahValPrices: number[] = []
    for (const itemC of sortedByVol) {
      runningSum += itemC.volume
      vahValPrices.push(itemC.price)
      if (runningSum >= targetVolSurround) break
    }

    return {
      timestamp, open: parseFloat(open.toFixed(4)), high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)), close: parseFloat(close.toFixed(4)),
      volume: parseFloat(volume.toFixed(4)), delta: parseFloat((takerBuyVol - takerSellVol).toFixed(4)),
      pocPrice: pocCell ? pocCell.price : parseFloat(((open + close) / 2).toFixed(4)),
      cells: sortedCells,
      vah: vahValPrices.length > 0 ? parseFloat(Math.max(...vahValPrices).toFixed(4)) : parseFloat(high.toFixed(4)),
      val: vahValPrices.length > 0 ? parseFloat(Math.min(...vahValPrices).toFixed(4)) : parseFloat(low.toFixed(4))
    }
  })
}
