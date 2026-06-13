import { useEffect, useRef, useCallback } from 'react'

import { Engine } from '@/chart-engine'
import type { Candle, CandleMode, ClusterLevel, VolumeMode } from '@/chart-engine'
import { useCandlePalette } from '@/contexts/CandlePaletteContext'

interface ApiCandle {
  Symbol: string;
  Timeframe: string;
  CandleOpen: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  TotalVolume: number;
}

interface ApiCluster {
  PriceLevel: number;
  BidVolume: number;
  AskVolume: number;
}

interface ChartPanelProps {
  symbol: string;
  market: string;
  timeframe: string;
  chartIndex: 0 | 1;
  mode: CandleMode;
  volumeMode: VolumeMode;
  compression: number;
  palette: 'default' | 'alternative';
  onFpsChange?: (fps: number) => void;
  onResolvedModeChange?: (mode: Exclude<CandleMode, 'auto'>) => void;
}

function mapCandle(c: ApiCandle): Candle {
  return {
    timestamp: new Date(c.CandleOpen).getTime(),
    open: c.Open,
    high: c.High,
    low: c.Low,
    close: c.Close,
    volume: c.TotalVolume,
  };
}

function mapCluster(c: ApiCluster): ClusterLevel {
  return {
    priceLevel: c.PriceLevel,
    bidVolume: c.BidVolume,
    askVolume: c.AskVolume,
  };
}

const BATCH_SIZE = 100;
const PARALLEL_LIMIT = 3;

export function ChartPanel({
  symbol, market, timeframe, chartIndex, mode, volumeMode, compression, palette,
  onFpsChange, onResolvedModeChange,
}: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const { getActivePalette } = useCandlePalette();

  const fetchClustersBatch = useCallback(async (timestamps: number[]) => {
    const engine = engineRef.current;
    if (!engine || timestamps.length === 0) return;

    const dataStore = engine['dataStore'] as any;
    const toLoad = timestamps.filter(ts => !dataStore.clusterMap?.has(ts));

    if (toLoad.length === 0) return;

    const chunks: number[][] = [];
    for (let i = 0; i < toLoad.length; i += BATCH_SIZE) {
      chunks.push(toLoad.slice(i, i + BATCH_SIZE));
    }

    for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
      const batch = chunks.slice(i, i + PARALLEL_LIMIT);
      await Promise.all(batch.map(async (chunk) => {
        const candleOpens = chunk.join(',');
        try {
          const resp = await fetch(
            `/api/v1/candles/${symbol}/clusters-batch?timeframe=${timeframe}&candleOpens=${candleOpens}`
          );
          const data = await resp.json();
          if (data.ok && data.data?.clusters) {
            const clustersMap = new Map<number, ClusterLevel[]>();
            for (const [ts, levels] of Object.entries(data.data.clusters)) {
              clustersMap.set(Number(ts), (levels as ApiCluster[]).map(mapCluster));
            }
            engine.setClusterDataBatch(clustersMap);
          }
        } catch (err) {
          console.error('Failed to fetch clusters batch:', err);
        }
      }));
    }
  }, [symbol, timeframe]);

  const fetchClustersRef = useRef(fetchClustersBatch);
  fetchClustersRef.current = fetchClustersBatch;

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new Engine({
      container: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      palette: getActivePalette(chartIndex),
    });

    let fpsInterval: ReturnType<typeof setInterval> | undefined;
    let ws: WebSocket | undefined;
    let clusterFetchTimeout: ReturnType<typeof setTimeout> | undefined;

    engine.init().then(() => {
      engineRef.current = engine;

      fetch(`/api/v1/candles?symbol=${symbol}&market=${market}&timeframe=${timeframe}&limit=500`)
        .then(r => r.json())
        .then((resp: { ok: boolean; data: { candles: ApiCandle[] } }) => {
          if (resp.ok && resp.data?.candles) {
            const candles = resp.data.candles.map(mapCandle);
            engine.setTimeframe(timeframe);
            engine.setData(candles);

            const timestamps = candles.slice(0, 50).map(c => c.timestamp);
            fetchClustersRef.current(timestamps);
          }
        })
        .catch(err => console.error('Failed to fetch candles:', err));

      engine.on('needHistory', (before: number) => {
        fetch(`/api/v1/candles?symbol=${symbol}&market=${market}&timeframe=${timeframe}&limit=500&before=${before}`)
          .then(r => r.json())
          .then((resp: { ok: boolean; data: { candles: ApiCandle[] } }) => {
            if (resp.ok && resp.data?.candles && resp.data.candles.length > 0) {
              const candles = resp.data.candles.map(mapCandle);
              engine.prependData(candles);
            }
          })
          .catch(err => console.error('Failed to fetch history:', err));
      });

      engine.on('viewportChange', () => {
        if (clusterFetchTimeout) clearTimeout(clusterFetchTimeout);
        clusterFetchTimeout = setTimeout(() => {
          const ds = engine['dataStore'] as any;
          const allCandles = ds.getCandles() ?? [];
          if (allCandles.length === 0) return;

          const renderer = engine['renderer'] as any;
          const scales = renderer?.scales;
          if (!scales) return;

          const { start, end } = scales.getVisibleRange(allCandles.length);
          const visibleCandles = allCandles.slice(start, end + 1);
          const timestamps = visibleCandles.map((c: Candle) => c.timestamp);

          if (timestamps.length > 0 && timestamps.length <= 100) {
            fetchClustersRef.current(timestamps);
          } else if (timestamps.length > 100) {
            const step = Math.ceil(timestamps.length / 100);
            const sampled = timestamps.filter((_: number, i: number) => i % step === 0);
            fetchClustersRef.current(sampled);
          }
        }, 500);
      });

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws!.send(JSON.stringify({
          type: 'chart_subscribe',
          symbol,
          market,
          timeframe,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'candle_update' && msg.data) {
            const d = msg.data;
            engine.updateLast({
              timestamp: d.candleOpen,
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
              volume: d.totalVolume,
            });

            if (d.levels && Array.isArray(d.levels)) {
              engine.setClusterData(d.candleOpen, d.levels.map((l: any) => ({
                priceLevel: l.priceLevel,
                bidVolume: l.bidVolume,
                askVolume: l.askVolume,
              })));
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      fpsInterval = setInterval(() => {
        const currentFps = engine.getFPS();
        onFpsChange?.(currentFps);
        if (engine.getMode() === 'auto') {
          onResolvedModeChange?.(engine.getResolvedMode());
        }
      }, 1000);
    });

    return () => {
      if (fpsInterval !== undefined) clearInterval(fpsInterval);
      if (clusterFetchTimeout) clearTimeout(clusterFetchTimeout);
      ws?.close();
      wsRef.current = null;

      engine.destroy();
      engineRef.current = null;
    };
  }, [symbol, market, timeframe, chartIndex]);

  useEffect(() => {
    engineRef.current?.setPalette(palette);
  }, [palette]);

  useEffect(() => {
    engineRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    engineRef.current?.setVolumeMode(volumeMode);
  }, [volumeMode]);

  useEffect(() => {
    engineRef.current?.setCompression(compression);
  }, [compression]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && engineRef.current) {
          engineRef.current.resize(width, height);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mode === 'clusters' || mode === 'footprint' || mode === 'auto') {
      const engine = engineRef.current;
      if (engine) {
        const ds = engine['dataStore'] as any;
        const allCandles = ds.getCandles() ?? [];
        if (allCandles.length > 0) {
          const renderer = engine['renderer'] as any;
          const scales = renderer?.scales;
          if (scales) {
            const { start, end } = scales.getVisibleRange(allCandles.length);
            const visibleCandles = allCandles.slice(start, end + 1);
            const timestamps = visibleCandles.map((c: Candle) => c.timestamp);
            if (timestamps.length > 0 && timestamps.length <= 100) {
              fetchClustersRef.current(timestamps);
            }
          }
        }
      }
    }
  }, [mode]);

  return (
    <div ref={containerRef} className="relative w-full h-full" />
  );
}
