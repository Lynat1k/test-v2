import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { CandleMode, VolumeMode } from '@/chart-engine'

export type MarketType = 'futures' | 'spot'
export type CandlePalette = 'default' | 'alternative'

export interface TickerConfig {
  symbol: string
  name: string
  baseFutures: number
  baseSpot: number
  futurePriceTick: number
  spotPriceTick: number
}

// TODO: тянуть base/priceTick тикеров из /api/v1/tickers (источник — БД/админка).
// Значения ниже — fallback-заглушка на случай недоступности API.
export const AVAILABLE_TICKERS: TickerConfig[] = [
  { symbol: 'BTCUSDT', name: 'BTC/USDT', baseFutures: 25, baseSpot: 500, futurePriceTick: 0.1,  spotPriceTick: 0.01 },
  { symbol: 'ETHUSDT', name: 'ETH/USDT', baseFutures: 1,  baseSpot: 10,  futurePriceTick: 0.01, spotPriceTick: 0.01 },
]

export const TIMEFRAMES_BY_MARKET: Record<MarketType, string[]> = {
  futures: ['1m', '5m', '15m', '30m', '1h', '4h'],
  spot: ['15m', '30m', '1h', '4h'],
}

export interface ChartSlot {
  symbol: string
  market: MarketType
  timeframe: string
  candleMode: CandleMode
  palette: CandlePalette
  volumeMode: VolumeMode
  compression: number
}

const DEFAULT_SLOT: ChartSlot = {
  symbol: 'BTCUSDT',
  market: 'futures',
  timeframe: '1m',
  candleMode: 'auto',
  palette: 'default',
  volumeMode: 'bidask',
  compression: 1,
}

// Shape returned by GET /api/v1/tickers — only the fields we care about here.
interface ServerTicker {
  symbol: string
  name?: string
  futurePriceTick: number
  spotPriceTick: number
  compressionFutures: number
  compressionSpot: number
}

interface ChartControlsValue {
  activeSlot: 0 | 1
  setActiveSlot: (i: 0 | 1) => void
  getSlot: (i: 0 | 1) => ChartSlot
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

interface SavedState {
  slots?: [ChartSlot, ChartSlot]
  activeSlot?: 0 | 1
  // legacy single-slot fields
  symbol?: string
  market?: MarketType
  timeframe?: string
  candleMode?: CandleMode
  palette?: CandlePalette
  volumeMode?: VolumeMode
  compression?: number
}

function loadSaved(): { slots: [ChartSlot, ChartSlot]; activeSlot: 0 | 1 } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data: SavedState = JSON.parse(raw)
      if (data.slots) {
        return {
          slots: [
            { ...DEFAULT_SLOT, ...data.slots[0] },
            { ...DEFAULT_SLOT, ...data.slots[1] },
          ],
          activeSlot: data.activeSlot ?? 0,
        }
      }
      // Legacy migration: single slot → slots[0]
      if (data.symbol) {
        const slot: ChartSlot = {
          symbol: data.symbol ?? DEFAULT_SLOT.symbol,
          market: data.market ?? DEFAULT_SLOT.market,
          timeframe: data.timeframe ?? DEFAULT_SLOT.timeframe,
          candleMode: data.candleMode ?? DEFAULT_SLOT.candleMode,
          palette: data.palette ?? DEFAULT_SLOT.palette,
          volumeMode: data.volumeMode ?? DEFAULT_SLOT.volumeMode,
          compression: data.compression ?? DEFAULT_SLOT.compression,
        }
        return { slots: [slot, { ...DEFAULT_SLOT }], activeSlot: 0 }
      }
    }
  } catch {}
  return { slots: [{ ...DEFAULT_SLOT }, { ...DEFAULT_SLOT }], activeSlot: 0 }
}

function saveToStorage(slots: [ChartSlot, ChartSlot], activeSlot: 0 | 1) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots, activeSlot }))
  } catch {}
}

const ChartControlsContext = createContext<ChartControlsValue | null>(null)

export function ChartControlsProvider({ children }: { children: ReactNode }) {
  const saved = loadSaved()

  const [slots, setSlots] = useState<[ChartSlot, ChartSlot]>(saved.slots)
  const [activeSlot, setActiveSlotState] = useState<0 | 1>(saved.activeSlot)
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false)
  // Overrides fetched from /api/v1/tickers — keyed by symbol.
  const [tickerOverrides, setTickerOverrides] = useState<Record<string, Partial<TickerConfig>>>({})
  const fetchedRef = useRef(false)

  useEffect(() => {
    saveToStorage(slots, activeSlot)
  }, [slots, activeSlot])

  // Fetch ticker params from the server once on mount.
  // Falls back silently to AVAILABLE_TICKERS hardcoded values if the call fails.
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    fetch('/api/v1/tickers')
      .then(r => r.json())
      .then((json: { ok: boolean; data?: ServerTicker[] }) => {
        if (!json.ok || !Array.isArray(json.data)) return
        const overrides: Record<string, Partial<TickerConfig>> = {}
        for (const t of json.data) {
          overrides[t.symbol] = {
            futurePriceTick: t.futurePriceTick,
            spotPriceTick: t.spotPriceTick,
            baseFutures: t.compressionFutures,
            baseSpot: t.compressionSpot,
            name: t.name ?? t.symbol,
          }
        }
        setTickerOverrides(overrides)
      })
      .catch(() => { /* silent fallback to hardcoded values */ })
  }, [])

  const updateSlot = useCallback((index: 0 | 1, patch: Partial<ChartSlot>) => {
    setSlots(prev => {
      const next: [ChartSlot, ChartSlot] = [{ ...prev[0] }, { ...prev[1] }]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }, [])

  const setActiveSlot = useCallback((i: 0 | 1) => {
    setActiveSlotState(i)
  }, [])

  const getSlot = useCallback((i: 0 | 1): ChartSlot => slots[i], [slots])

  const active = slots[activeSlot]

  const setSymbol = useCallback((s: string) => {
    const ticker = AVAILABLE_TICKERS.find(t => t.symbol === s)
    const patch: Partial<ChartSlot> = { symbol: s }
    if (ticker) {
      const tfs = TIMEFRAMES_BY_MARKET[active.market]
      if (!tfs.includes(active.timeframe)) {
        patch.timeframe = tfs[0]!
      }
    }
    updateSlot(activeSlot, patch)
  }, [activeSlot, active.market, active.timeframe, updateSlot])

  const setMarket = useCallback((m: MarketType) => {
    const tfs = TIMEFRAMES_BY_MARKET[m]
    const patch: Partial<ChartSlot> = { market: m }
    if (!tfs.includes(active.timeframe)) {
      patch.timeframe = tfs[0]!
    }
    updateSlot(activeSlot, patch)
  }, [activeSlot, active.timeframe, updateSlot])

  const setTimeframe = useCallback((tf: string) => {
    updateSlot(activeSlot, { timeframe: tf })
  }, [activeSlot, updateSlot])

  const setCandleMode = useCallback((mode: CandleMode) => {
    updateSlot(activeSlot, { candleMode: mode })
  }, [activeSlot, updateSlot])

  const setPalette = useCallback((p: CandlePalette) => {
    updateSlot(activeSlot, { palette: p })
  }, [activeSlot, updateSlot])

  const setVolumeMode = useCallback((vm: VolumeMode) => {
    updateSlot(activeSlot, { volumeMode: vm })
  }, [activeSlot, updateSlot])

  const setCompression = useCallback((level: number) => {
    updateSlot(activeSlot, { compression: level })
  }, [activeSlot, updateSlot])

  // Returns ticker config for active symbol, merging API overrides on top of hardcoded fallback.
  // Never returns undefined — falls back to AVAILABLE_TICKERS[0] as last resort.
  const getTickerConfig = useCallback((): TickerConfig => {
    const base = AVAILABLE_TICKERS.find(t => t.symbol === active.symbol) ?? AVAILABLE_TICKERS[0]!
    const override = tickerOverrides[active.symbol]
    return override ? { ...base, ...override } : base
  }, [active.symbol, tickerOverrides])

  const getCompressionLevels = useCallback((): number[] => {
    const ticker = getTickerConfig()
    const base = active.market === 'futures' ? ticker.baseFutures : ticker.baseSpot
    return Array.from({ length: 10 }, (_, i) => base * (i + 1))
  }, [getTickerConfig, active.market])

  return (
    <ChartControlsContext.Provider value={{
      activeSlot, setActiveSlot, getSlot, showIndicatorsModal,
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
