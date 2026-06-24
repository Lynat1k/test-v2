import { describe, it, expect } from "vitest";
import { fetchClustersBatchImpl } from "./clusterCache";
import type { ClustersChunkResponse } from "./clusterCache";
import type { ApiClusterRow } from "./adapter";

function row(price: number, bid = 5, ask = 5): ApiClusterRow {
  return { PriceLevel: price, BidVolume: bid, AskVolume: ask };
}

describe("fetchClustersBatchImpl", () => {
  it("fetches missing ts, returns map for all requested, caches response keys including []", async () => {
    const cache = new Map<number, ApiClusterRow[]>();
    const calls: number[][] = [];
    const fetchChunk = async (chunk: number[]): Promise<ClustersChunkResponse> => {
      calls.push(chunk);
      const ts = new Map<number, ApiClusterRow[]>();
      ts.set(1, [row(100)]);
      ts.set(2, []);
      ts.set(3, [row(200)]);
      return { ok: true, ts };
    };

    const map = await fetchClustersBatchImpl({
      timestamps: [1, 2, 3],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });

    expect(map.size).toBe(3);
    expect(map.get(1)).toHaveLength(1);
    expect(map.get(2)).toEqual([]);
    expect(map.get(3)).toHaveLength(1);
    expect(cache.get(1)).toHaveLength(1);
    expect(cache.get(2)).toEqual([]);
    expect(cache.get(3)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("returns cached values without re-fetching, fetches only missing ts", async () => {
    const cache = new Map<number, ApiClusterRow[]>();
    cache.set(1, [row(100)]);
    cache.set(2, []);
    cache.set(3, [row(200)]);

    const calls: number[][] = [];
    const fetchChunk = async (chunk: number[]): Promise<ClustersChunkResponse> => {
      calls.push(chunk);
      const ts = new Map<number, ApiClusterRow[]>();
      ts.set(4, [row(300)]);
      return { ok: true, ts };
    };

    const map = await fetchClustersBatchImpl({
      timestamps: [2, 3, 4],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });

    expect(map.size).toBe(3);
    expect(map.get(2)).toEqual([]);
    expect(map.get(3)).toHaveLength(1);
    expect(map.get(4)).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([4]);
  });

  it("returns same array reference from cache (for ref-comparison in render)", async () => {
    const cache = new Map<number, ApiClusterRow[]>();
    const levels = [row(100)];
    cache.set(1, levels);

    let called = false;
    const fetchChunk = async (): Promise<ClustersChunkResponse> => {
      called = true;
      return { ok: true, ts: new Map() };
    };

    const map = await fetchClustersBatchImpl({
      timestamps: [1],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });

    expect(map.get(1)).toBe(levels);
    expect(called).toBe(false);
  });

  it("does NOT cache on !ok response, retries on next call", async () => {
    const cache = new Map<number, ApiClusterRow[]>();
    let callCount = 0;
    const fetchChunk = async (): Promise<ClustersChunkResponse> => {
      callCount++;
      if (callCount === 1) return { ok: false, ts: new Map() };
      const ts = new Map<number, ApiClusterRow[]>();
      ts.set(1, [row(100)]);
      return { ok: true, ts };
    };

    const map1 = await fetchClustersBatchImpl({
      timestamps: [1],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });
    expect(map1.size).toBe(0);
    expect(cache.has(1)).toBe(false);

    const map2 = await fetchClustersBatchImpl({
      timestamps: [1],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });
    expect(map2.get(1)).toHaveLength(1);
    expect(cache.has(1)).toBe(true);
    expect(callCount).toBe(2);
  });

  it("does NOT cache ts missing from response, retries that ts on next call", async () => {
    const cache = new Map<number, ApiClusterRow[]>();
    let callCount = 0;
    const fetchChunk = async (): Promise<ClustersChunkResponse> => {
      callCount++;
      const ts = new Map<number, ApiClusterRow[]>();
      if (callCount === 1) {
        ts.set(1, [row(100)]);
      } else {
        ts.set(2, [row(200)]);
      }
      return { ok: true, ts };
    };

    const map1 = await fetchClustersBatchImpl({
      timestamps: [1, 2],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });
    expect(map1.get(1)).toHaveLength(1);
    expect(map1.has(2)).toBe(false);
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);

    const map2 = await fetchClustersBatchImpl({
      timestamps: [1, 2],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });
    expect(map2.get(1)).toHaveLength(1);
    expect(map2.get(2)).toHaveLength(1);
    expect(cache.has(2)).toBe(true);
    expect(callCount).toBe(2);
  });

  it("survives thrown fetcher without polluting cache", async () => {
    const cache = new Map<number, ApiClusterRow[]>();
    let callCount = 0;
    const fetchChunk = async (): Promise<ClustersChunkResponse> => {
      callCount++;
      if (callCount === 1) throw new Error("boom");
      const ts = new Map<number, ApiClusterRow[]>();
      ts.set(1, [row(100)]);
      return { ok: true, ts };
    };

    const map1 = await fetchClustersBatchImpl({
      timestamps: [1],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });
    expect(map1.size).toBe(0);
    expect(cache.has(1)).toBe(false);

    const map2 = await fetchClustersBatchImpl({
      timestamps: [1],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });
    expect(map2.get(1)).toHaveLength(1);
  });

  it("splits into chunks by batchSize", async () => {
    const cache = new Map<number, ApiClusterRow[]>();
    const calls: number[][] = [];
    const fetchChunk = async (chunk: number[]): Promise<ClustersChunkResponse> => {
      calls.push([...chunk]);
      const ts = new Map<number, ApiClusterRow[]>();
      for (const t of chunk) ts.set(t, [row(t)]);
      return { ok: true, ts };
    };

    const timestamps = [10, 20, 30, 40, 50, 60, 70];
    const map = await fetchClustersBatchImpl({
      timestamps,
      cache,
      fetchChunk,
      batchSize: 3,
      parallelLimit: 2,
    });

    expect(map.size).toBe(7);
    expect(calls.length).toBe(3);
    expect(calls[0]).toEqual([10, 20, 30]);
    expect(calls[1]).toEqual([40, 50, 60]);
    expect(calls[2]).toEqual([70]);
  });

  it("short-circuits when all timestamps are cached (no network call)", async () => {
    const cache = new Map<number, ApiClusterRow[]>();
    cache.set(1, [row(100)]);
    cache.set(2, [row(200)]);

    let called = false;
    const fetchChunk = async (): Promise<ClustersChunkResponse> => {
      called = true;
      return { ok: true, ts: new Map() };
    };

    const map = await fetchClustersBatchImpl({
      timestamps: [1, 2],
      cache,
      fetchChunk,
      batchSize: 100,
      parallelLimit: 3,
    });

    expect(called).toBe(false);
    expect(map.size).toBe(2);
  });
});
