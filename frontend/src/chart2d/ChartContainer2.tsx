import type { CandleMode, VolumeMode } from '@/chart-engine'
import { useAuthContext } from '@/features/auth/AuthContext'
import ClusterChartAdapter from './ClusterChartAdapter'
import type { ClusterChartAdapterProps } from './ClusterChartAdapter'

interface ChartContainer2Props {
  symbol: string
  market: string
  timeframe: string
  chartIndex: 0 | 1
  mode: CandleMode
  volumeMode: VolumeMode
  compression: number
  palette: 'default' | 'alternative'
  onFpsChange?: (fps: number) => void
  onResolvedModeChange?: (mode: Exclude<CandleMode, 'auto'>) => void
}

const VOLUME_MAP: Record<VolumeMode, ClusterChartAdapterProps['candleDataType']> = {
  bidask: 'bid_ask',
  volume: 'volume',
  delta: 'delta',
}

const MODE_MAP: Record<string, ClusterChartAdapterProps['candleType']> = {
  auto: 'auto',
  japanese: 'japanese',
  footprint: 'footprint',
  clusters: 'clusters',
  bars: 'japanese',
}

export function ChartContainer2({
  symbol, market, timeframe, mode, volumeMode, palette,
}: ChartContainer2Props) {
  const { accessToken } = useAuthContext()

  return (
    <div className="relative w-full h-full flex flex-col">
      <ClusterChartAdapter
        symbol={symbol}
        market={market}
        timeframe={timeframe}
        candleType={MODE_MAP[mode] ?? 'auto'}
        candleDataType={VOLUME_MAP[volumeMode] ?? 'bid_ask'}
        candlePalette={palette}
        accessToken={accessToken}
      />
    </div>
  )
}
