import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { CandleMode, VolumeMode } from '@/chart-engine'

export type MarketType = 'futures' | 'spot'
export type CandlePalette = 'default' | 'alternative'

export interface TickerConfig {
  symbol: string
  name: string
  baseFutures: number
  baseSpot: number
}

export const AVAILABLE_TICKERS: TickerConfig[] = [
  { symbol: 'BTCUSDT', name: 'BTC/USDT', baseFutures: 25, baseSpot: 500 },
  { symbol: 'ETHUSDT', name: 'ETH/USDT', baseFutures: 1, baseSpot: 10 },
]

export const TIMEFRAMES_BY_MARKET: Record<MarketType, string[]> = {
  futures: ['1m', '5m', '15m', '30m', '1h', '4h'],
  spot: ['15m', '30m', '1h', '4h'],
}

interface ChartControlsValue {
  symbol: string
  market: MarketType
  timeframe: string
  candleMode: CandleMode
  palette: CandlePalette
  volumeMode: VolumeMode
  compression: number
  showIndicatorsModal: boolean

  setSymbol: (symbol: string) => void
  setMarket: (market: MarketType) => void
  setTimeframe: (tf: string) => void
  setCandleMode: (mode: CandleMode) => void
  setPalette: (p: CandlePalette) => void
  setVolumeMode: (vm: VolumeMode) => void
  setCompression: (level: number) => void
  setShowIndicatorsModal: (show: boolean) => void

  getTickerConfig: () => TickerConfig
  getCompressionLevels: () => number[]
}

const STORAGE_KEY = 'procluster_chart_controls'

function loadSaved(): Partial<ChartControlsValue> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveToStorage(state: {
  symbol: string
  market: MarketType
  timeframe: string
  candleMode: CandleMode
  palette: CandlePalette
  volumeMode: VolumeMode
  compression: number
}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

const ChartControlsContext = createContext<ChartControlsValue | null>(null)

export function ChartControlsProvider({ children }: { children: ReactNode }) {
  const saved = loadSaved()

  const [symbol, setSymbolState] = useState<string>(() => saved.symbol ?? 'BTCUSDT')
  const [market, setMarketState] = useState<MarketType>(() => saved.market ?? 'futures')
  const [timeframe, setTimeframeState] = useState<string>(() => saved.timeframe ?? '1m')
  const [candleMode, setCandleModeState] = useState<CandleMode>(() => saved.candleMode ?? 'auto')
  const [palette, setPaletteState] = useState<CandlePalette>(() => saved.palette ?? 'default')
  const [volumeMode, setVolumeModeState] = useState<VolumeMode>(() => saved.volumeMode ?? 'bidask')
  const [compression, setCompressionState] = useState<number>(() => saved.compression ?? 1)
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false)

  useEffect(() => {
    saveToStorage({ symbol, market, timeframe, candleMode, palette, volumeMode, compression })
  }, [symbol, market, timeframe, candleMode, palette, volumeMode, compression])

  const setSymbol = useCallback((s: string) => {
    setSymbolState(s)
    const ticker = AVAILABLE_TICKERS.find(t => t.symbol === s)
    if (ticker) {
      const tfs = TIMEFRAMES_BY_MARKET[market]
      if (!tfs.includes(timeframe)) {
        setTimeframeState(tfs[0]!)
      }
    }
  }, [market, timeframe])

  const setMarket = useCallback((m: MarketType) => {
    setMarketState(m)
    const tfs = TIMEFRAMES_BY_MARKET[m]
    if (!tfs.includes(timeframe)) {
      setTimeframeState(tfs[0]!)
    }
  }, [timeframe])

  const setTimeframe = useCallback((tf: string) => setTimeframeState(tf), [])
  const setCandleMode = useCallback((mode: CandleMode) => setCandleModeState(mode), [])
  const setPalette = useCallback((p: CandlePalette) => setPaletteState(p), [])
  const setVolumeMode = useCallback((vm: VolumeMode) => setVolumeModeState(vm), [])
  const setCompression = useCallback((level: number) => setCompressionState(level), [])

  const getTickerConfig = useCallback((): TickerConfig => {
    return AVAILABLE_TICKERS.find(t => t.symbol === symbol) ?? AVAILABLE_TICKERS[0]!
  }, [symbol])

  const getCompressionLevels = useCallback((): number[] => {
    const ticker = getTickerConfig()
    const base = market === 'futures' ? ticker.baseFutures : ticker.baseSpot
    return Array.from({ length: 10 }, (_, i) => base * (i + 1))
  }, [getTickerConfig, market])

  return (
    <ChartControlsContext.Provider value={{
      symbol, market, timeframe, candleMode, palette, volumeMode, compression, showIndicatorsModal,
      setSymbol, setMarket, setTimeframe, setCandleMode, setPalette, setVolumeMode, setCompression, setShowIndicatorsModal,
      getTickerConfig, getCompressionLevels,
    }}>
      {children}
    </ChartControlsContext.Provider>
  )
}

export function useChartControls() {
  const ctx = useContext(ChartControlsContext)
  if (!ctx) throw new Error('useChartControls must be used within ChartControlsProvider')
  return ctx
}
