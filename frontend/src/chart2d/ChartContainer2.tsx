import type { CandleMode, VolumeMode } from '@/chart-engine'
import type { Indicator } from '@/chart2d/types'
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
  layoutMode: 'single' | 'horizontal' | 'vertical'
  indicators?: Indicator[] | undefined
  activeIndicators: Record<string, boolean>
  onToggleIndicator: (id: string) => void
  onToggleVisibility: (id: string) => void
  onRemoveIndicator: (id: string) => void
  onShowIndicatorsSettings: (id?: string) => void
  onLayoutChange?: (mode: 'single' | 'horizontal' | 'vertical') => void
  onFpsChange?: (fps: number) => void
  onResolvedModeChange?: (mode: Exclude<CandleMode, 'auto'>) => void
  showAnomalies?: boolean | undefined
  onChangeShowAnomalies?: (show: boolean) => void
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
  bars: 'bars',
}

const LAYOUT_MAP: Record<string, '1' | '2h' | '2v'> = {
  single: '1',
  horizontal: '2h',
  vertical: '2v',
}

export function ChartContainer2({
  symbol, market, timeframe, mode, volumeMode, palette, compression,
  layoutMode, indicators, activeIndicators, onToggleIndicator, onToggleVisibility, onRemoveIndicator, onShowIndicatorsSettings,
  onLayoutChange, showAnomalies, onChangeShowAnomalies,
}: ChartContainer2Props) {
  const { accessToken } = useAuthContext()

  return (
    <div className="relative w-full h-full flex flex-col">
      <ClusterChartAdapter
        symbol={symbol}
        market={market}
        timeframe={timeframe}
        compression={compression}
        candleType={MODE_MAP[mode] ?? 'auto'}
        candleDataType={VOLUME_MAP[volumeMode] ?? 'bid_ask'}
        candlePalette={palette}
        indicators={indicators}
        activeIndicators={activeIndicators}
        onToggleIndicator={onToggleIndicator}
        onToggleVisibility={onToggleVisibility}
        onRemoveIndicator={onRemoveIndicator}
        onShowIndicatorsSettings={onShowIndicatorsSettings}
        accessToken={accessToken}
        workspaceLayout={LAYOUT_MAP[layoutMode] ?? '1'}
        onWorkspaceLayoutChange={(id) => {
          const map: Record<string, 'single' | 'horizontal' | 'vertical'> = {
            '1': 'single',
            '2h': 'horizontal',
            '2v': 'vertical',
          }
          onLayoutChange?.(map[id] ?? 'single')
        }}
        workspacesCount={2}
        showAnomalies={showAnomalies}
        onChangeShowAnomalies={onChangeShowAnomalies}
      />
    </div>
  )
}
