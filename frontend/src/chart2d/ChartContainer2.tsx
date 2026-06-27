import { useCallback } from 'react'
import type { CandleMode, VolumeMode } from '@/chart-engine'
import type { Indicator } from '@/chart2d/types'
import { useAuthContext } from '@/features/auth/AuthContext'
import { useUserLimits } from '@/contexts/LimitsContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useChartControls } from '@/contexts/ChartControlsContext'
import { useUserSettings } from '@/contexts/UserSettingsContext'
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
  const { accessToken, user } = useAuthContext()
  const { limits } = useUserLimits()
  const { theme } = useTheme()
  const { resolveTickerConfig, isConfigReady } = useChartControls()
  const { getSetting, setSetting } = useUserSettings()

  // Per (symbol + market) toggle for abbreviated cluster cell numbers (NOT per timeframe).
  // Mirrors the chartCompression_ key shape; server-synced for auth users, LS for guests.
  const abbreviateNumbers = getSetting<Record<string, boolean>>(`clusterAbbreviate_${symbol}`, {})[market] === true
  const onToggleAbbreviateNumbers = useCallback(() => {
    const existing = getSetting<Record<string, boolean>>(`clusterAbbreviate_${symbol}`, {})
    setSetting(`clusterAbbreviate_${symbol}`, { ...existing, [market]: !(existing[market] === true) })
  }, [getSetting, setSetting, symbol, market])

  const hideClusterNumbers = getSetting<Record<string, boolean>>(`clusterHideNumbers_${symbol}`, {})[market] === true
  const onToggleHideClusterNumbers = useCallback(() => {
    const existing = getSetting<Record<string, boolean>>(`clusterHideNumbers_${symbol}`, {})
    setSetting(`clusterHideNumbers_${symbol}`, { ...existing, [market]: !(existing[market] === true) })
  }, [getSetting, setSetting, symbol, market])

  // Server-driven base + price-tick for this slot's symbol/market — feeds the unified
  // priceStep = priceTick * base * level used by both live and history.
  const tickerCfg = resolveTickerConfig(symbol)
  const isFutures = market.toLowerCase() === 'futures'
  const baseCompression = isFutures ? tickerCfg.baseFutures : tickerCfg.baseSpot
  const priceTick = isFutures ? tickerCfg.futurePriceTick : tickerCfg.spotPriceTick

  // Gate cluster loading until every input to priceStep has settled, so the chart
  // issues exactly one clusters-batch request at the final step (no duplicate min-step
  // fetch). Terminal-on-failure, so a 401 still lets clusters load via the fallback step.
  const configReady = isConfigReady(symbol)

  return (
    <div className="relative w-full h-full flex flex-col">
      <ClusterChartAdapter
        symbol={symbol}
        market={market}
        timeframe={timeframe}
        compression={compression}
        baseCompression={baseCompression}
        priceTick={priceTick}
        configReady={configReady}
        candleType={MODE_MAP[mode] ?? 'auto'}
        candleDataType={VOLUME_MAP[volumeMode] ?? 'bid_ask'}
        candlePalette={palette}
        abbreviateNumbers={abbreviateNumbers}
        onToggleAbbreviateNumbers={onToggleAbbreviateNumbers}
        hideClusterNumbers={hideClusterNumbers}
        onToggleHideClusterNumbers={onToggleHideClusterNumbers}
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
        workspacesCount={limits.workspacesCount}
        showAnomalies={showAnomalies}
        onChangeShowAnomalies={onChangeShowAnomalies}
        theme={theme}
        userRole={user?.role ?? ''}
      />
    </div>
  )
}
