import type { ApiClusterRow } from "./adapter";

export interface ClustersChunkResponse {
  ok: boolean;
  ts: Map<number, ApiClusterRow[]>;
}

export interface FetchBatchOptions {
  timestamps: number[];
  cache: Map<number, ApiClusterRow[]>;
  fetchChunk: (chunk: number[]) => Promise<ClustersChunkResponse>;
  batchSize: number;
  parallelLimit: number;
}

export async function fetchClustersBatchImpl(
  opts: FetchBatchOptions,
): Promise<Map<number, ApiClusterRow[]>> {
  const { timestamps, cache, fetchChunk, batchSize, parallelLimit } = opts;
  const result = new Map<number, ApiClusterRow[]>();
  const missing: number[] = [];

  for (const t of timestamps) {
    const cached = cache.get(t);
    if (cached !== undefined) {
      result.set(t, cached);
    } else {
      missing.push(t);
    }
  }

  if (missing.length === 0) return result;

  const chunks: number[][] = [];
  for (let i = 0; i < missing.length; i += batchSize) {
    chunks.push(missing.slice(i, i + batchSize));
  }

  for (let i = 0; i < chunks.length; i += parallelLimit) {
    const batch = chunks.slice(i, i + parallelLimit);
    await Promise.all(
      batch.map(async (chunk) => {
        try {
          const resp = await fetchChunk(chunk);
          if (!resp.ok) return;
          for (const [ts, levels] of resp.ts.entries()) {
            cache.set(ts, levels);
            result.set(ts, levels);
          }
        } catch (err) {
          console.warn("[chart2d] clusters-batch chunk failed:", err);
        }
      }),
    );
  }

  return result;
}
