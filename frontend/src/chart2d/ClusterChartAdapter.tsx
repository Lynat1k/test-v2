import { useState, useEffect } from "react";
import ClusterChart from "./ClusterChart";
import { adapter } from "./adapter";
import type { ClusterCandle } from "./types";
import type { ApiCandle, ApiClusterRow } from "./adapter";

export interface ClusterChartAdapterProps {
  symbol: string;
  market: string;
  timeframe: string;
  candleType?: "auto" | "japanese" | "footprint" | "clusters";
  candleDataType?: "bid_ask" | "delta" | "volume";
  candlePalette?: "default" | "alternative";
  language?: "RU" | "EN" | "KZ";
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

export default function ClusterChartAdapter({
  symbol,
  market,
  timeframe,
  candleType = "auto",
  candleDataType = "bid_ask",
  candlePalette = "default",
  language = "RU",
}: ClusterChartAdapterProps) {
  const [candles, setCandles] = useState<ClusterCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const candleUrl = `/api/v1/candles?symbol=${symbol}&market=${market}&timeframe=${timeframe}&limit=200`;
        const candleRes = await fetch(candleUrl);
        const candleData = await candleRes.json();

        if (!candleData.ok) {
          throw new Error(candleData.error?.message || "Failed to fetch candles");
        }

        const apiCandles: ApiCandle[] = candleData.data.candles;

        const timestamps = apiCandles.map((c: ApiCandle) =>
          new Date(c.CandleOpen).getTime()
        );

        let clusterMap = new Map<number, ApiClusterRow[]>();

        try {
          const clusterRes = await fetch(
            `/api/v1/candles/${symbol}/clusters-batch?timeframe=${timeframe}&candleOpens=${timestamps.join(",")}`
          );
          const clusterData = await clusterRes.json();
          if (clusterData.ok && clusterData.data?.clusters) {
            for (const [ts, levels] of Object.entries(clusterData.data.clusters)) {
              clusterMap.set(Number(ts), levels as ApiClusterRow[]);
            }
          }
        } catch {
          // clusters-batch may fail or be unavailable — candles still render without cells
        }

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
  }, [symbol, market, timeframe]);

  const activePair = makePair(symbol, market);

  const inner = loading ? (
    <div className="flex items-center justify-center w-full h-full text-zinc-500 text-sm">
      Loading chart…
    </div>
  ) : error ? (
    <div className="flex items-center justify-center w-full h-full text-red-400 text-sm">
      {error}
    </div>
  ) : (
    <ClusterChart
      candles={candles}
      activePair={activePair}
      candleType={candleType === "auto" ? "japanese" : candleType}
      candleDataType={candleDataType}
      candlePalette={candlePalette}
      language={language}
    />
  );

  return <div className="flex-1 flex flex-col min-h-0">{inner}</div>;
}
