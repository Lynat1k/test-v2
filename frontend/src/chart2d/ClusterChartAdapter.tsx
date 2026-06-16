import { useState, useEffect, useCallback, useRef } from "react";
import ClusterChart from "./ClusterChart";
import { adapter, apiRowsToCells } from "./adapter";
import type { ClusterCandle } from "./types";
import type { ApiCandle, ApiClusterRow } from "./adapter";

const BATCH_SIZE = 100;
const PARALLEL_LIMIT = 3;

const TF_LIMIT: Record<string, number> = {
  "1m": 500,
  "5m": 500,
  "15m": 500,
  "30m": 400,
  "1h": 300,
  "4h": 200,
  "1d": 200,
};

export interface ClusterChartAdapterProps {
  symbol: string;
  market: string;
  timeframe: string;
  candleType?: "auto" | "japanese" | "footprint" | "clusters";
  candleDataType?: "bid_ask" | "delta" | "volume";
  candlePalette?: "default" | "alternative";
  language?: "RU" | "EN" | "KZ";
  accessToken?: string | null;
  workspaceLayout?: "1" | "2h" | "2v";
  onWorkspaceLayoutChange?: (layout: "1" | "2h" | "2v") => void;
  workspacesCount?: number;
}

function estimatePriceStep(symbol: string): number {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("BTC")) return 2.5;
  if (upper.startsWith("ETH")) return 0.25;
  if (upper.startsWith("SOL")) return 0.25;
  return 0.1;
}

function makePair(symbol: string, _market: string) {
  const priceStep = estimatePriceStep(symbol);
  return {
    symbol: symbol.replace("USDT", "/USDT"),
    name: symbol.replace("USDT", ""),
    price: 0,
    change24h: 0,
    volume24h: 0,
    delta24h: 0,
    priceStep,
    compressionSpot: 1,
    compressionFutures: 5,
    minTickStep: symbol.startsWith("BTC") ? 0.1 : 0.01,
  };
}

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function ClusterChartAdapter({
  symbol,
  market,
  timeframe,
  candleType = "auto",
  candleDataType = "bid_ask",
  candlePalette = "default",
  language = "RU",
  accessToken,
  workspaceLayout,
  onWorkspaceLayoutChange,
  workspacesCount,
}: ClusterChartAdapterProps) {
  const [candles, setCandles] = useState<ClusterCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allHistoryLoadedRef = useRef(false);
  const historyLoadingRef = useRef(false);
  const clusterLoadedTsRef = useRef<Set<number>>(new Set());
  const accessTokenRef = useRef(accessToken);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    allHistoryLoadedRef.current = false;
    historyLoadingRef.current = false;
    clusterLoadedTsRef.current = new Set();
  }, [symbol, market, timeframe]);

  const fetchClustersBatch = useCallback(async (timestamps: number[]): Promise<Map<number, ApiClusterRow[]>> => {
    const clusterMap = new Map<number, ApiClusterRow[]>();
    const unloaded = timestamps.filter(t => !clusterLoadedTsRef.current.has(t));
    if (unloaded.length === 0) return clusterMap;

    const chunks: number[][] = [];
    for (let i = 0; i < unloaded.length; i += BATCH_SIZE) {
      chunks.push(unloaded.slice(i, i + BATCH_SIZE));
    }

    for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
      const batch = chunks.slice(i, i + PARALLEL_LIMIT);
      await Promise.all(batch.map(async (chunk) => {
        const candleOpens = chunk.join(',');
        try {
          const resp = await fetch(
            `/api/v1/candles/${symbol}/clusters-batch?timeframe=${timeframe}&candleOpens=${candleOpens}`,
            { headers: authHeaders(accessTokenRef.current) }
          );
          if (!resp.ok) return;
          const data = await resp.json();
          if (data.ok && data.data?.clusters) {
            for (const [ts, levels] of Object.entries(data.data.clusters)) {
              const tsNum = Number(ts);
              clusterLoadedTsRef.current.add(tsNum);
              clusterMap.set(tsNum, levels as ApiClusterRow[]);
            }
          }
        } catch (err) {
          console.warn('[chart2d] clusters-batch fetch failed:', err);
        }
      }));
    }
    return clusterMap;
  }, [symbol, market, timeframe]);

  const handleNeedHistory = useCallback(async (oldestTimestamp: number) => {
    if (allHistoryLoadedRef.current) return;
    if (historyLoadingRef.current) return;
    historyLoadingRef.current = true;

    try {
      const limit = TF_LIMIT[timeframe] ?? 200;
      const before = oldestTimestamp - 1;
      const url = `/api/v1/candles?symbol=${symbol}&market=${market}&timeframe=${timeframe}&limit=${limit}&before=${before}`;
      const res = await fetch(url, { headers: authHeaders(accessTokenRef.current) });
      const data = await res.json();

      if (!data.ok || !data.data?.candles || data.data.candles.length === 0) {
        allHistoryLoadedRef.current = true;
        return;
      }

      const apiCandles: ApiCandle[] = data.data.candles;

      const clusterMap = await fetchClustersBatch(
        apiCandles.map((c: ApiCandle) => new Date(c.CandleOpen).getTime())
      );
      const adapted = adapter(apiCandles, clusterMap);

      setCandles(prev => {
        const prevFirstTs = prev.length > 0 ? prev[0]!.timestamp : Infinity;
        const unique = adapted.filter((c: ClusterCandle) => c.timestamp < prevFirstTs);
        if (unique.length === 0) {
          allHistoryLoadedRef.current = true;
          return prev;
        }
        const merged = [...unique, ...prev].sort((a, b) => a.timestamp - b.timestamp);
        return merged;
      });
    } catch (err) {
      console.warn('[chart2d] history fetch failed:', err);
    } finally {
      historyLoadingRef.current = false;
    }
  }, [symbol, market, timeframe, fetchClustersBatch]);

  const handleVisibleTimestampsChange = useCallback((timestamps: number[]) => {
    fetchClustersBatch(timestamps).then(clusterMap => {
      if (clusterMap.size === 0) return;
      setCandles(prev => prev.map(c => {
        const levels = clusterMap.get(c.timestamp);
        if (!levels) return c;
        const cells = apiRowsToCells(levels);
        const pocCell = cells.find(cell => cell.isPoc);
        return {
          ...c,
          cells,
          pocPrice: pocCell ? pocCell.price : (c.open + c.close) / 2,
        } as ClusterCandle;
      }));
    });
  }, [fetchClustersBatch]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      allHistoryLoadedRef.current = false;
      historyLoadingRef.current = false;

      try {
        const limit = TF_LIMIT[timeframe] ?? 200;
        const candleUrl = `/api/v1/candles?symbol=${symbol}&market=${market}&timeframe=${timeframe}&limit=${limit}`;
        const candleRes = await fetch(candleUrl, { headers: authHeaders(accessTokenRef.current) });
        const candleData = await candleRes.json();

        if (!candleData.ok) {
          throw new Error(candleData.error?.message || "Failed to fetch candles");
        }

        const apiCandles: ApiCandle[] = candleData.data?.candles ?? [];

        const timestamps = apiCandles.map((c: ApiCandle) =>
          new Date(c.CandleOpen).getTime()
        );

        const clusterMap = await fetchClustersBatch(timestamps);

        if (!cancelled) {
          const adapted = adapter(apiCandles, clusterMap);
          setCandles(adapted);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [symbol, market, timeframe, accessToken]);

  const activePair = makePair(symbol, market);

  const inner = loading ? (
    <div className="flex items-center justify-center w-full h-full text-zinc-500 text-sm">
      Loading chart…
    </div>
  ) : error ? (
    <div className="flex items-center justify-center w-full h-full text-red-400 text-sm">
      {error}
    </div>
  ) : candles.length === 0 ? (
    <div className="flex items-center justify-center w-full h-full text-zinc-500 text-sm">
      No data for this period
    </div>
  ) : (
    <ClusterChart
      candles={candles}
      activePair={activePair}
      candleType={candleType === "auto" ? "japanese" : candleType}
      candleDataType={candleDataType}
      candlePalette={candlePalette}
      language={language}
      workspaceLayout={workspaceLayout ?? "1"}
      onWorkspaceLayoutChange={onWorkspaceLayoutChange ?? (() => {})}
      workspacesCount={workspacesCount ?? 1}
      onNeedHistory={handleNeedHistory}
      onVisibleTimestampsChange={handleVisibleTimestampsChange}
    />
  );

  return <div className="flex-1 flex flex-col min-h-0">{inner}</div>;
}
