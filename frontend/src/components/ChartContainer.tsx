import { useEffect, useRef, useState } from 'react';

import { Engine } from '@/chart-engine';
import type { Candle } from '@/chart-engine';
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

export function ChartContainer({ symbol, market, timeframe, chartIndex }: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [fps, setFps] = useState(0);
  const { getActivePalette } = useCandlePalette();

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

    engine.init().then(() => {
      engineRef.current = engine;

      // Fetch initial candles from REST API
      fetch(`/api/v1/candles?symbol=${symbol}&market=${market}&timeframe=${timeframe}&limit=500`)
        .then(r => r.json())
        .then((resp: { ok: boolean; data: { candles: ApiCandle[] } }) => {
          if (resp.ok && resp.data?.candles) {
            const candles = resp.data.candles.map(mapCandle);
            engine.setData(candles);
          }
        })
        .catch(err => console.error('Failed to fetch candles:', err));

      // Load more history when scrolling left
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

      // Connect WebSocket for live updates
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
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      // FPS counter
      fpsInterval = setInterval(() => {
        setFps(engine.getFPS());
      }, 1000);
    });

    return () => {
      if (fpsInterval !== undefined) clearInterval(fpsInterval);
      ws?.close();
      wsRef.current = null;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [symbol, market, timeframe, chartIndex, getActivePalette]);

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

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-2 left-2 text-xs text-gray-400">
        {symbol} | {fps} FPS
      </div>
    </div>
  );
}
