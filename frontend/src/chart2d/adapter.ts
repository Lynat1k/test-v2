import type { ClusterCandle, ClusterCell } from "./types";

/**
 * Raw candle shape returned by GET /api/v1/candles.
 */
export interface ApiCandle {
  Symbol: string;
  Timeframe: string;
  CandleOpen: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  TotalVolume: number;
  TotalBid: number;
  TotalAsk: number;
  TotalDelta: number;
  TradesCount: number;
}

/**
 * Raw cluster-level row returned by GET /api/v1/candles/{symbol}/clusters-batch.
 */
export interface ApiClusterRow {
  PriceLevel: number;
  BidVolume: number;
  AskVolume: number;
}

function parseCandleOpen(ts: string): number {
  return new Date(ts).getTime();
}

export function computeValueArea(cells: ClusterCell[]): { vah: number; val: number } {
  const totalVolume = cells.reduce((s, c) => s + c.volume, 0);
  if (totalVolume === 0 || cells.length === 0) {
    return { vah: 0, val: 0 };
  }
  const target = totalVolume * 0.7;
  const sorted = [...cells].sort((a, b) => b.volume - a.volume);

  let accumulated = 0;
  const vaPrices: number[] = [];
  for (const cell of sorted) {
    accumulated += cell.volume;
    vaPrices.push(cell.price);
    if (accumulated >= target) break;
  }

  return {
    vah: Math.max(...vaPrices),
    val: Math.min(...vaPrices),
  };
}

export function apiRowsToCells(rows: ApiClusterRow[]): ClusterCell[] {
  if (!rows || rows.length === 0) return [];

  // Merge rows with the same PriceLevel by summing bid/ask/volume
  const map = new Map<number, ClusterCell>();
  for (const r of rows) {
    const existing = map.get(r.PriceLevel);
    if (existing) {
      existing.bid += r.BidVolume;
      existing.ask += r.AskVolume;
      existing.volume = existing.bid + existing.ask;
    } else {
      map.set(r.PriceLevel, {
        price: r.PriceLevel,
        bid: r.BidVolume,
        ask: r.AskVolume,
        volume: r.BidVolume + r.AskVolume,
        isPoc: false,
        isBuyImbalance: false,
        isSellImbalance: false,
      });
    }
  }

  const cells = Array.from(map.values());

  let maxVol = -1;
  let pocIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    if (c.volume > maxVol) {
      maxVol = c.volume;
      pocIdx = i;
    }
  }

  if (pocIdx >= 0) {
    cells[pocIdx]!.isPoc = true;
  }

  return cells.sort((a, b) => b.price - a.price);
}

export function adapter(
  candles: ApiCandle[],
  clusterMap: Map<number, ApiClusterRow[]>
): ClusterCandle[] {
  if (!candles || candles.length === 0) return [];

  return candles
    .map((raw) => {
      const timestamp = parseCandleOpen(raw.CandleOpen);
      const rows = clusterMap.get(timestamp);
      const cells = rows ? apiRowsToCells(rows) : [];

      const pocCell = cells.find((c) => c.isPoc);
      const pocPrice = pocCell ? pocCell.price : (raw.Open + raw.Close) / 2;

      const { vah, val } = cells.length > 0
        ? computeValueArea(cells)
        : { vah: raw.High, val: raw.Low };

      return {
        timestamp,
        open: raw.Open,
        high: raw.High,
        low: raw.Low,
        close: raw.Close,
        volume: raw.TotalVolume,
        delta: raw.TotalDelta,
        pocPrice,
        cells,
        vah,
        val,
        ...(raw.TradesCount > 0 ? { tickCount: raw.TradesCount } : {}),
      } as ClusterCandle;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function mergeLiveUpdate(
  existing: ClusterCandle[],
  updated: ClusterCandle
): ClusterCandle[] {
  const idx = existing.findIndex((c) => c.timestamp === updated.timestamp);
  if (idx >= 0) {
    const copy = [...existing];
    copy[idx] = updated;
    return copy;
  }
  return [...existing, updated];
}
