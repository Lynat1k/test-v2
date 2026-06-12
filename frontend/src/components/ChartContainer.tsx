import { useEffect, useRef, useState } from 'react';

import { Engine } from '@/chart-engine';
import { useCandlePalette } from '@/contexts/CandlePaletteContext';

interface ChartContainerProps {
  symbol: string;
  market: string;
  timeframe: string;
  chartIndex: 0 | 1;
}

export function ChartContainer({ symbol, market, timeframe, chartIndex }: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
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

    engine.init().then(() => {
      engineRef.current = engine;

      engine.on('viewportChange', () => {
      });

      engine.on('needHistory', (before: number) => {
        console.log('Need history before:', before);
      });

      fpsInterval = setInterval(() => {
        setFps(engine.getFPS());
      }, 1000);
    });

    return () => {
      if (fpsInterval !== undefined) clearInterval(fpsInterval);
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
