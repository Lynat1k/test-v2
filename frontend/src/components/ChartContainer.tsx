import { useEffect, useRef, useState, useCallback } from 'react';

import { Engine } from '@/chart-engine';
import type { Candle, CandleMode, ClusterLevel, VolumeMode } from '@/chart-engine';
import { useCandlePalette } from '@/contexts/CandlePaletteContext';

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

interface ChartContainerProps {
  symbol: string;
  market: string;
  timeframe: string;
  chartIndex: 0 | 1;
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

export function ChartContainer({ symbol, market, timeframe, chartIndex }: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [fps, setFps] = useState(0);
  const [mode, setModeState] = useState<CandleMode>('japanese');
  const [volumeMode, setVolumeModeState] = useState<VolumeMode>('bidask');
  const { getActivePalette } = useCandlePalette();

  const fetchClustersBatch = useCallback(async (timestamps: number[]) => {
    const engine = engineRef.current;
    if (!engine || timestamps.length === 0) return;

    // Filter out already-loaded clusters (skip if DataStore has levels for this timestamp)
    const dataStore = engine['dataStore'] as any;
    const toLoad = timestamps.filter(ts => !dataStore.clusterMap?.has(ts));

    if (toLoad.length === 0) return;

    // Chunk into batches of BATCH_SIZE
    const chunks: number[][] = [];
    for (let i = 0; i < toLoad.length; i += BATCH_SIZE) {
      chunks.push(toLoad.slice(i, i + BATCH_SIZE));
    }

    // Process with limited parallelism
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
            engine.setData(candles);

            // Load clusters only for visible candles (first 50)
            const timestamps = candles.slice(0, 50).map(c => c.timestamp);
            fetchClustersBatch(timestamps);
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

      // Debounced viewport change: fetch clusters for visible candles
      engine.on('viewportChange', () => {
        if (clusterFetchTimeout) clearTimeout(clusterFetchTimeout);
        clusterFetchTimeout = setTimeout(() => {
          const ds = engine['dataStore'] as any;
          const allCandles = ds.getCandles() ?? [];
          if (allCandles.length === 0) return;

          // Get visible range from renderer's scales
          const renderer = engine['renderer'] as any;
          const scales = renderer?.scales;
          if (!scales) return;

          const { start, end } = scales.getVisibleRange(allCandles.length);
          const visibleCandles = allCandles.slice(start, end + 1);
          const timestamps = visibleCandles.map((c: Candle) => c.timestamp);

          if (timestamps.length > 0 && timestamps.length <= 100) {
            fetchClustersBatch(timestamps);
          } else if (timestamps.length > 100) {
            // Take every Nth to stay under limit
            const step = Math.ceil(timestamps.length / 100);
            const sampled = timestamps.filter((_: number, i: number) => i % step === 0);
            fetchClustersBatch(sampled);
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
        setFps(engine.getFPS());
      }, 1000);
    });

    return () => {
      if (fpsInterval !== undefined) clearInterval(fpsInterval);
      if (clusterFetchTimeout) clearTimeout(clusterFetchTimeout);
      ws?.close();
      wsRef.current = null;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [symbol, market, timeframe, chartIndex, getActivePalette, fetchClustersBatch]);

  useEffect(() => {
    engineRef.current?.setPalette(getActivePalette(chartIndex));
  }, [getActivePalette, chartIndex]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && engineRef.current) {
        engineRef.current.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleModeChange = (newMode: CandleMode) => {
    setModeState(newMode);
    engineRef.current?.setMode(newMode);

    // When switching to clusters/footprint, fetch clusters for visible candles immediately
    if (newMode === 'clusters' || newMode === 'footprint') {
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
              fetchClustersBatch(timestamps);
            }
          }
        }
      }
    }
  };

  const handleVolumeModeChange = (newVolumeMode: VolumeMode) => {
    setVolumeModeState(newVolumeMode);
    engineRef.current?.setVolumeMode(newVolumeMode);
  };

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1 liquid-glass-card rounded px-2 py-1">
          {(['japanese', 'clusters', 'footprint', 'bars'] as CandleMode[]).map((m) => (
            <button
              key={m}
              className={`px-2 py-0.5 rounded text-xs ${mode === m ? 'bg-white/20' : 'hover:bg-white/10'}`}
              onClick={() => handleModeChange(m)}
            >
              {m === 'japanese' ? 'Японские' : m === 'clusters' ? 'Кластеры' : m === 'footprint' ? 'Футпринт' : 'Бары'}
            </button>
          ))}
        </div>

        {(mode === 'clusters' || mode === 'footprint') && (
          <div className="flex items-center gap-1 liquid-glass-card rounded px-2 py-1">
            {(['bidask', 'volume', 'delta'] as VolumeMode[]).map((vm) => (
              <button
                key={vm}
                className={`px-2 py-0.5 rounded text-xs ${volumeMode === vm ? 'bg-white/20' : 'hover:bg-white/10'}`}
                onClick={() => handleVolumeModeChange(vm)}
              >
                {vm === 'bidask' ? 'Bid×Ask' : vm === 'volume' ? 'Volume' : 'Delta'}
              </button>
            ))}
          </div>
        )}

        <div className="liquid-glass-card rounded px-2 py-1 text-xs text-gray-400">
          {symbol} | {fps} FPS
        </div>
      </div>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
