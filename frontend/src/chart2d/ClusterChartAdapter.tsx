import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ClusterChart from "./ClusterChart";
import { ChartLoader } from "@/components/ChartLoader";
import { adapter, apiRowsToCells, mergeLiveUpdate, aggregateLevels, computeValueArea } from "./adapter";
import type { ClusterCandle, OrderBook } from "./types";
import type { ApiCandle, ApiClusterRow } from "./adapter";
import { fetchClustersBatchImpl } from "./clusterCache";
import type { ClustersChunkResponse } from "./clusterCache";
import { useLiveChart } from "./useLiveChart";
import type { LiveChartState } from "./useLiveChart";
import { useDOM } from "@/hooks/useDOM";

const NOOP = () => {};

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
  compression?: number;
  // Server-driven base compression + price tick for this symbol/market. When provided,
  // priceStep = priceTick * baseCompression * compression (identical to REST). Optional so
  // the standalone preview (mounted outside ChartControlsProvider) can fall back.
  baseCompression?: number;
  priceTick?: number;
  candleType?: "auto" | "japanese" | "footprint" | "clusters" | "bars";
  candleDataType?: "bid_ask" | "delta" | "volume";
  candlePalette?: "default" | "alternative";
  abbreviateNumbers?: boolean;
  onToggleAbbreviateNumbers?: () => void;
  indicators?: import("@/chart2d/types").Indicator[] | undefined;
  activeIndicators?: Record<string, boolean>;
  onToggleIndicator?: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
  onRemoveIndicator?: (id: string) => void;
  onShowIndicatorsSettings?: (id?: string) => void;
  language?: "RU" | "EN" | "KZ";
  accessToken?: string | null;
  workspaceLayout?: "1" | "2h" | "2v";
  onWorkspaceLayoutChange?: (layout: "1" | "2h" | "2v") => void;
  workspacesCount?: number;
  showAnomalies?: boolean | undefined;
  onChangeShowAnomalies?: ((show: boolean) => void) | undefined;
  theme?: "dark" | "light";
  userRole?: string;
}

function estimatePriceStep(symbol: string): number {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("BTC")) return 2.5;
  if (upper.startsWith("ETH")) return 0.25;
  if (upper.startsWith("SOL")) return 0.25;
  return 0.1;
}

function computePriceStep(symbol: string, market: string, compressionMultiplier: number): number {
  const isFutures = market.toLowerCase() === "futures";
  const isBtc = symbol.toUpperCase().includes("BTC");
  const baseTickStep = isBtc ? (isFutures ? 0.1 : 0.01) : 0.01;
  const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
  const compression = baseCompression * compressionMultiplier;
  return baseTickStep * compression;
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
  compression = 1,
  baseCompression,
  priceTick,
  candleType = "auto",
  candleDataType = "bid_ask",
  candlePalette = "default",
  abbreviateNumbers = false,
  onToggleAbbreviateNumbers,
  indicators,
  activeIndicators,
  onToggleIndicator,
  onToggleVisibility,
  onRemoveIndicator,
  onShowIndicatorsSettings,
  language = "RU",
  accessToken,
  workspaceLayout,
  onWorkspaceLayoutChange,
  workspacesCount,
  showAnomalies,
  onChangeShowAnomalies,
  theme = "dark",
  userRole,
}: ClusterChartAdapterProps) {
  // Unified price step for both live and history. Prefer the server-driven config
  // (priceTick * base * level — identical to the REST clusters query); fall back to the
  // hardcoded estimate only when props are absent (preview route / before tickers load).
  const priceStep = (baseCompression != null && baseCompression > 0 && priceTick != null && priceTick > 0)
    ? priceTick * baseCompression * compression
    : computePriceStep(symbol, market, compression);
  const priceStepRef = useRef(priceStep);
  const [candles, setCandles] = useState<ClusterCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allHistoryLoadedRef = useRef(false);
  const historyLoadingRef = useRef(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const clusterCacheRef = useRef<Map<number, ApiClusterRow[]>>(new Map());
  const appliedLevelsRef = useRef<Map<number, ApiClusterRow[]>>(new Map());
  const accessTokenRef = useRef(accessToken);
  const candlesRef = useRef<ClusterCandle[]>(candles);
  const prependScrollRef = useRef<((addedCount: number) => void) | null>(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  // Keep the live-merge price step fresh (symbol/market/compression change AND when the
  // server base/tick arrives). Read via ref inside onCandleUpdate to avoid a stale closure.
  useEffect(() => {
    priceStepRef.current = priceStep;
  }, [priceStep]);

  const [liveState, setLiveState] = useState<LiveChartState>({ status: "disconnected" });

  useLiveChart({
    symbol,
    market,
    timeframe,
    accessToken,
    enabled: true,
    onCandleUpdate: (candle) => {
      // Apply user-selected compression to live levels (same as REST SQL floor/group)
      const rows: ApiClusterRow[] = candle.cells.map(c => ({
        PriceLevel: c.price,
        BidVolume: c.bid,
        AskVolume: c.ask,
      }));
      const aggregated = aggregateLevels(rows, priceStepRef.current);
      const aggregatedCells = apiRowsToCells(aggregated);
      const pocCell = aggregatedCells.find(c => c.isPoc);
      const { vah, val } = computeValueArea(aggregatedCells);
      setCandles((prev) => mergeLiveUpdate(prev, {
        ...candle,
        cells: aggregatedCells,
        pocPrice: pocCell ? pocCell.price : (candle.open + candle.close) / 2,
        vah,
        val,
      }));
    },
    onStateChange: setLiveState,
  });

  useEffect(() => {
    allHistoryLoadedRef.current = false;
    historyLoadingRef.current = false;
    clusterCacheRef.current = new Map();
    appliedLevelsRef.current = new Map();
  }, [symbol, market, timeframe, compression]);

  const fetchClustersBatch = useCallback(async (timestamps: number[]): Promise<Map<number, ApiClusterRow[]>> => {
    return fetchClustersBatchImpl({
      timestamps,
      cache: clusterCacheRef.current,
      batchSize: BATCH_SIZE,
      parallelLimit: PARALLEL_LIMIT,
      fetchChunk: async (chunk): Promise<ClustersChunkResponse> => {
        const candleOpens = chunk.join(',');
        const resp = await fetch(
          `/api/v1/candles/${symbol}/clusters-batch?timeframe=${timeframe}&market=${market}&candleOpens=${candleOpens}&priceStep=${priceStep}`,
          { headers: authHeaders(accessTokenRef.current) },
        );
        if (!resp.ok) return { ok: false, ts: new Map() };
        const data = await resp.json();
        if (!data.ok || !data.data?.clusters) return { ok: false, ts: new Map() };
        const ts = new Map<number, ApiClusterRow[]>();
        for (const [tsStr, levels] of Object.entries(data.data.clusters)) {
          ts.set(Number(tsStr), levels as ApiClusterRow[]);
        }
        return { ok: true, ts };
      },
    });
  }, [symbol, market, timeframe, priceStep]);

  const handleNeedHistory = useCallback(async (oldestTimestamp: number) => {
    if (allHistoryLoadedRef.current) return;
    if (historyLoadingRef.current) return;
    historyLoadingRef.current = true;
    setIsLoadingHistory(true);

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
      for (const [ts, levels] of clusterMap.entries()) {
        appliedLevelsRef.current.set(ts, levels);
      }
      const adapted = adapter(apiCandles, clusterMap);

      // Compute addedCount BEFORE setCandles (synchronous, before React batches the update)
      const prevFirstTs = candlesRef.current.length > 0 ? candlesRef.current[0]!.timestamp : Infinity;
      const unique = adapted.filter((c: ClusterCandle) => c.timestamp < prevFirstTs);
      const addedCount = unique.length;

      setCandles(prev => {
        if (addedCount === 0) {
          allHistoryLoadedRef.current = true;
          return prev;
        }
        const merged = [...unique, ...prev].sort((a, b) => a.timestamp - b.timestamp);
        return merged;
      });

      // Sync scrollLeft in the same JS task (before React microtask and before browser paint)
      if (addedCount > 0) {
        prependScrollRef.current?.(addedCount);
      }
    } catch (err) {
      console.warn('[chart2d] history fetch failed:', err);
    } finally {
      historyLoadingRef.current = false;
      setIsLoadingHistory(false);
    }
  }, [symbol, market, timeframe, fetchClustersBatch]);

  const handleVisibleTimestampsChange = useCallback((timestamps: number[]) => {
    fetchClustersBatch(timestamps).then(clusterMap => {
      let anyChanged = false;
      for (const c of candlesRef.current) {
        const levels = clusterMap.get(c.timestamp);
        if (levels === undefined) continue;
        if (appliedLevelsRef.current.get(c.timestamp) !== levels) {
          anyChanged = true;
          break;
        }
      }
      if (!anyChanged) return;
      setCandles(prev => prev.map(c => {
        const levels = clusterMap.get(c.timestamp);
        if (levels === undefined) return c;
        if (appliedLevelsRef.current.get(c.timestamp) === levels) return c;
        appliedLevelsRef.current.set(c.timestamp, levels);
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
          for (const [ts, levels] of clusterMap.entries()) {
            appliedLevelsRef.current.set(ts, levels);
          }
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
  }, [symbol, market, timeframe, compression, !!accessToken]);

  const activePair = useMemo(() => makePair(symbol, market), [symbol, market]);

  const domEnabled = useMemo(() => !!activeIndicators?.['depthOfMarket'], [activeIndicators]);
  const { levels: domLevels } = useDOM({ symbol, market, accessToken: accessToken ?? null, enabled: domEnabled });
  const orderBook = useMemo<OrderBook>(() => ({
    bids: domLevels.filter(l => l.bidSize > 0).map(l => ({ price: l.priceLevel, amount: l.bidSize, total: 0, percentage: 0 })),
    asks: domLevels.filter(l => l.askSize > 0).map(l => ({ price: l.priceLevel, amount: l.askSize, total: 0, percentage: 0 })),
  }), [domLevels]);

  const inner = loading ? (
    <ChartLoader theme={theme} />
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
      clusterStep={priceStep}
      {...(indicators ? { indicators } : {})}
      {...(activeIndicators ? { activeIndicators } : {})}
      {...(onToggleIndicator ? { onToggleIndicator } : {})}
      {...(onToggleVisibility ? { onToggleVisibility } : {})}
      {...(onRemoveIndicator ? { onRemoveIndicator } : {})}
      {...(onShowIndicatorsSettings ? { onShowIndicatorsSettings } : {})}
      marketType={market.toUpperCase() as "SPOT" | "FUTURES"}
      candleType={candleType}
      candleDataType={candleDataType}
      candlePalette={candlePalette}
      abbreviateNumbers={abbreviateNumbers}
      {...(onToggleAbbreviateNumbers ? { onToggleAbbreviateNumbers } : {})}
      timeframe={timeframe}
      language={language}
      workspaceLayout={workspaceLayout ?? "1"}
      onWorkspaceLayoutChange={onWorkspaceLayoutChange ?? NOOP}
      workspacesCount={workspacesCount ?? 1}
      onNeedHistory={handleNeedHistory}
      onVisibleTimestampsChange={handleVisibleTimestampsChange}
      prependScrollRef={prependScrollRef}
      isLoadingHistory={isLoadingHistory}
      showAnomalies={showAnomalies}
      onChangeShowAnomalies={onChangeShowAnomalies}
      theme={theme}
      {...(userRole !== undefined ? { userRole } : {})}
      {...(domEnabled ? { orderBook } : {})}
    />
  );

  const showBadge = liveState.status !== "disconnected" && liveState.status !== "active";
  const badgeClass = liveState.status === "connecting" ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : liveState.status === "rejected" ? "bg-red-500/20 text-red-400 border-red-500/30"
    : liveState.status === "evicted" ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
    : "";
  const badgeText = liveState.status === "connecting" ? "WS..."
    : liveState.status === "rejected" ? "Session limit"
    : liveState.status === "evicted" ? "Session evicted"
    : "";
  const liveBadge = showBadge ? (
    <div className={`absolute top-2 left-2 z-50 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider select-none pointer-events-none border ${badgeClass}`}>
      {badgeText}
    </div>
  ) : null;

  return <div className="flex-1 flex flex-col min-h-0 relative">{inner}{liveBadge}</div>;
}
