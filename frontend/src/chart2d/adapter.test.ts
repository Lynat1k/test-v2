import { describe, it, expect } from "vitest";
import { adapter, mergeLiveUpdate } from "./adapter";
import type { ApiCandle, ApiClusterRow } from "./adapter";

function makeCandle(overrides: Partial<ApiCandle> & { CandleOpen: string }): ApiCandle {
  return {
    Symbol: "BTCUSDT",
    Timeframe: "1m",
    Open: 43000,
    High: 43100,
    Low: 42950,
    Close: 43080,
    TotalVolume: 235.8,
    TotalBid: 120.5,
    TotalAsk: 115.3,
    TotalDelta: 5.2,
    TradesCount: 342,
    ...overrides,
  };
}

function makeRow(overrides: Partial<ApiClusterRow> & { PriceLevel: number }): ApiClusterRow {
  return {
    BidVolume: 10,
    AskVolume: 15,
    ...overrides,
  };
}

describe("adapter", () => {
  it("converts plain candles with no cluster data", () => {
    const candles = [makeCandle({ CandleOpen: "2024-01-15T10:30:00Z" })];
    const clusterMap = new Map<number, ApiClusterRow[]>();

    const result = adapter(candles, clusterMap);

    expect(result).toHaveLength(1);
    const c = result[0]!;

    expect(c.timestamp).toBe(new Date("2024-01-15T10:30:00Z").getTime());
    expect(c.open).toBe(43000);
    expect(c.high).toBe(43100);
    expect(c.low).toBe(42950);
    expect(c.close).toBe(43080);
    expect(c.volume).toBe(235.8);
    expect(c.delta).toBe(5.2);
    expect(c.cells).toEqual([]);
    expect(c.pocPrice).toBe((43000 + 43080) / 2);

    expect(c.vah).toBe(43100);
    expect(c.val).toBe(42950);
  });

  it("merges cluster rows into cells with POC detection", () => {
    const candles = [makeCandle({ CandleOpen: "2024-01-15T10:30:00Z" })];
    const ts = new Date("2024-01-15T10:30:00Z").getTime();

    const rows: ApiClusterRow[] = [
      makeRow({ PriceLevel: 43080, BidVolume: 5, AskVolume: 8 }),
      makeRow({ PriceLevel: 43075, BidVolume: 20, AskVolume: 5 }),
      makeRow({ PriceLevel: 43070, BidVolume: 3, AskVolume: 3 }),
    ];
    const clusterMap = new Map([[ts, rows]]);

    const result = adapter(candles, clusterMap);

    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.cells).toHaveLength(3);

    // Sorted descending by price
    expect(c.cells[0]!.price).toBe(43080);
    expect(c.cells[1]!.price).toBe(43075);
    expect(c.cells[2]!.price).toBe(43070);

    // POC = max volume cell (43075: vol=25)
    const pocCell = c.cells.find((cell) => cell.isPoc);
    expect(pocCell).toBeDefined();
    expect(pocCell!.price).toBe(43075);
    expect(pocCell!.volume).toBe(25);

    // pocPrice matches POC cell
    expect(c.pocPrice).toBe(43075);

    // VAH/VAL should be within range of cells
    expect(c.vah).toBeGreaterThanOrEqual(c.val);
  });

  it("does not set imbalance flags (ClusterChart computes locally)", () => {
    const candles = [makeCandle({ CandleOpen: "2024-01-15T10:30:00Z" })];
    const ts = new Date("2024-01-15T10:30:00Z").getTime();

    const rows: ApiClusterRow[] = [
      makeRow({ PriceLevel: 43090, BidVolume: 20, AskVolume: 2 }),
      makeRow({ PriceLevel: 43080, BidVolume: 4, AskVolume: 4 }),
      makeRow({ PriceLevel: 43075, BidVolume: 2, AskVolume: 20 }),
    ];
    const clusterMap = new Map([[ts, rows]]);

    const result = adapter(candles, clusterMap);
    const c = result[0]!;

    // ClusterChart computes diagonal imbalance locally with ratio 3.0
    // adapter must NOT pre-compute these flags
    for (const cell of c.cells) {
      expect(cell.isBuyImbalance).toBe(false);
      expect(cell.isSellImbalance).toBe(false);
    }
  });

  it("handles empty candle array", () => {
    const result = adapter([], new Map());
    expect(result).toEqual([]);
  });

  it("computes value area (vah/val) from clustered cells", () => {
    const candles = [makeCandle({ CandleOpen: "2024-01-15T10:30:00Z" })];
    const ts = new Date("2024-01-15T10:30:00Z").getTime();

    const rows: ApiClusterRow[] = [
      makeRow({ PriceLevel: 43090, BidVolume: 10, AskVolume: 10 }),
      makeRow({ PriceLevel: 43080, BidVolume: 40, AskVolume: 40 }),
      makeRow({ PriceLevel: 43070, BidVolume: 5, AskVolume: 5 }),
    ];
    const clusterMap = new Map([[ts, rows]]);

    const result = adapter(candles, clusterMap);
    const c = result[0]!;

    expect(c.vah).toBe(43080);
    expect(c.val).toBe(43080);
  });
});

describe("mergeLiveUpdate", () => {
  it("replaces existing candle by timestamp", () => {
    const existing = [
      { timestamp: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 100, delta: 1, pocPrice: 10, cells: [], vah: 11, val: 9 },
      { timestamp: 200, open: 11, high: 12, low: 10, close: 11.5, volume: 200, delta: 2, pocPrice: 11, cells: [], vah: 12, val: 10 },
    ];
    const updated = { timestamp: 200, open: 12, high: 13, low: 11, close: 12.5, volume: 300, delta: 3, pocPrice: 12, cells: [], vah: 13, val: 11 };

    const result = mergeLiveUpdate(existing as any, updated as any);

    expect(result).toHaveLength(2);
    expect(result[0]!.timestamp).toBe(100);
    expect(result[1]!.close).toBe(12.5);
    expect(result[1]!.volume).toBe(300);
  });

  it("appends new candle when timestamp not found", () => {
    const existing = [
      { timestamp: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 100, delta: 1, pocPrice: 10, cells: [], vah: 11, val: 9 },
    ];
    const updated = { timestamp: 300, open: 12, high: 13, low: 11, close: 12.5, volume: 300, delta: 3, pocPrice: 12, cells: [], vah: 13, val: 11 };

    const result = mergeLiveUpdate(existing as any, updated as any);

    expect(result).toHaveLength(2);
    expect(result[1]!.timestamp).toBe(300);
  });
});
