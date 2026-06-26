import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { CandleMode, VolumeMode } from '@/chart-engine'
import { useUserSettings } from '@/contexts/UserSettingsContext'
import { apiGetCompressionDefaults } from '@/features/auth/api'
import { useAuthContext } from '@/features/auth/AuthContext'

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
  // Per-slot mirror of user choices, keyed `${market}_${tf}` → level (1..N).
  // Canonical source is UserSettings (`chartCompression_${symbol}`); this is a fallback
  // for legacy localStorage and for when settings haven't hydrated yet.
  compressionByTf: Record<string, number>
}

const DEFAULT_SLOT: ChartSlot = {
  symbol: 'BTCUSDT',
  market: 'futures',
  timeframe: '1m',
  candleMode: 'auto',
  palette: 'alternative',
  volumeMode: 'bidask',
  compression: 1,
  compressionByTf: {},
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
  // Absolute admin-default multiplier for the active slot's symbol + given market+tf, or undefined.
  getAdminDefaultCompression: (market: MarketType, tf: string) => number | undefined
  // Drop the cached admin-defaults entry for a symbol — the fetch effect will
  // re-request it on next render. Called after the admin saves new defaults.
  invalidateAdminDefaults: (symbol: string) => void
}

const STORAGE_KEY = 'procluster_chart_controls'

interface SavedState {
  slots?: Array<Partial<ChartSlot> & { compressionByTf?: Record<string, number> }>
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

function normalizeByTf(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
  }
  return out
}

function buildSlotFromSaved(src: Partial<ChartSlot> & { compressionByTf?: Record<string, number> } | undefined): ChartSlot {
  const merged: ChartSlot = { ...DEFAULT_SLOT, ...(src ?? {}) }
  let byTf = normalizeByTf(src?.compressionByTf)
  // Seed the mirror for legacy LS where compressionByTf is absent — preserves the
  // last-session compression for the slot's current (market, timeframe).
  if (Object.keys(byTf).length === 0 && merged.compression > 0) {
    byTf = { [`${merged.market}_${merged.timeframe}`]: merged.compression }
  }
  merged.compressionByTf = byTf
  return merged
}

function loadSaved(): { slots: [ChartSlot, ChartSlot]; activeSlot: 0 | 1 } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data: SavedState = JSON.parse(raw)
      if (data.slots && Array.isArray(data.slots)) {
        return {
          slots: [
            buildSlotFromSaved(data.slots[0]),
            buildSlotFromSaved(data.slots[1]),
          ],
          activeSlot: data.activeSlot ?? 0,
        }
      }
      // Legacy migration: single slot → slots[0]
      if (data.symbol) {
        const legacy: Partial<ChartSlot> = { symbol: data.symbol }
        if (data.market !== undefined) legacy.market = data.market
        if (data.timeframe !== undefined) legacy.timeframe = data.timeframe
        if (data.candleMode !== undefined) legacy.candleMode = data.candleMode
        if (data.palette !== undefined) legacy.palette = data.palette
        if (data.volumeMode !== undefined) legacy.volumeMode = data.volumeMode
        if (data.compression !== undefined) legacy.compression = data.compression
        const slot = buildSlotFromSaved(legacy)
        return { slots: [slot, { ...DEFAULT_SLOT, compressionByTf: {} }], activeSlot: 0 }
      }
    }
  } catch {}
  return {
    slots: [
      { ...DEFAULT_SLOT, compressionByTf: {} },
      { ...DEFAULT_SLOT, compressionByTf: {} },
    ],
    activeSlot: 0,
  }
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
  // Admin compression defaults per symbol: { symbol → { `${market}_${tf}` → absolute multiplier } }.
  // A value of {} (empty object) means "fetched, nothing configured" — not "not yet fetched".
  const [adminDefaults, setAdminDefaults] = useState<Record<string, Record<string, number>>>({})
  // Per-session explicit user picks of (symbol, market, tf). Protects against late
  // admin/server overrides from overwriting an in-session manual choice.
  const explicitChoiceRef = useRef<Set<string>>(new Set())
  const fetchedTickersRef = useRef(false)
  const adminFetchInflightRef = useRef<Set<string>>(new Set())

  const { settings, getSetting, setSetting } = useUserSettings()
  const { accessToken } = useAuthContext()

  useEffect(() => {
    saveToStorage(slots, activeSlot)
  }, [slots, activeSlot])

  // Fetch ticker params from the server once on mount.
  useEffect(() => {
    if (fetchedTickersRef.current) return
    fetchedTickersRef.current = true
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

  // Fetch admin compression defaults for every symbol currently held by a slot.
  // Each symbol fetched exactly once; an empty result is cached as {} (not undefined).
  useEffect(() => {
    const symbols = Array.from(new Set([slots[0].symbol, slots[1].symbol]))
    for (const sym of symbols) {
      if (adminDefaults[sym] !== undefined) continue
      if (adminFetchInflightRef.current.has(sym)) continue
      adminFetchInflightRef.current.add(sym)
      apiGetCompressionDefaults(sym)
        .then(rows => {
          const map: Record<string, number> = {}
          for (const r of rows ?? []) {
            if (typeof r.multiplier === 'number' && r.multiplier > 0) {
              map[`${r.market}_${r.timeframe}`] = r.multiplier
            }
          }
          setAdminDefaults(prev => prev[sym] !== undefined ? prev : { ...prev, [sym]: map })
        })
        .catch(() => {
          // не кэшируем — повторим при смене accessToken
        })
        .finally(() => { adminFetchInflightRef.current.delete(sym) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots[0].symbol, slots[1].symbol, accessToken])

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

  // Single source of truth for compression resolution.
  // Priority: user-saved (UserSettings: server > LS) → slot-local mirror → admin default → 1.
  const resolveCompression = useCallback(
    (symbol: string, market: MarketType, tf: string, slotByTf?: Record<string, number>): number => {
      const tfKey = `${market}_${tf}`
      // 1. User-saved value (server for auth, localStorage for guest, via UserSettings).
      const saved = getSetting<Record<string, number>>(`chartCompression_${symbol}`, {})
      const savedVal = saved && typeof saved === 'object' ? saved[tfKey] : undefined
      if (typeof savedVal === 'number' && savedVal > 0) return savedVal
      // 2. Slot-local mirror — used when settings hasn't hydrated yet, or for legacy LS.
      const mirrorVal = slotByTf ? slotByTf[tfKey] : undefined
      if (typeof mirrorVal === 'number' && mirrorVal > 0) return mirrorVal
      // 3. Admin default — stored as absolute multiplier; convert to level via current base.
      const absolute = adminDefaults[symbol]?.[tfKey]
      if (typeof absolute === 'number' && absolute > 0) {
        const baseTicker = AVAILABLE_TICKERS.find(t => t.symbol === symbol) ?? AVAILABLE_TICKERS[0]!
        const override = tickerOverrides[symbol]
        const merged = override ? { ...baseTicker, ...override } : baseTicker
        const base = market === 'futures' ? merged.baseFutures : merged.baseSpot
        if (base > 0) return Math.max(1, Math.round(absolute / base))
      }
      // 4. Fallback.
      return 1
    },
    [getSetting, adminDefaults, tickerOverrides]
  )

  // Re-resolve compression when admin defaults or user settings arrive (or symbol/market/tf
  // changes). Skip slots where the user has already made an explicit pick in this session.
  // Deps deliberately reference primitive accessors only — slot object refs would loop.
  useEffect(() => {
    setSlots(prev => {
      let changed = false
      const next: [ChartSlot, ChartSlot] = [prev[0], prev[1]]
      for (let i = 0; i < 2; i++) {
        const idx = i as 0 | 1
        const slot = prev[idx]
        const tfKey = `${slot.market}_${slot.timeframe}`
        const choiceKey = `${slot.symbol}_${tfKey}`
        if (explicitChoiceRef.current.has(choiceKey)) continue
        const lvl = resolveCompression(slot.symbol, slot.market, slot.timeframe, slot.compressionByTf)
        if (lvl !== slot.compression) {
          next[idx] = { ...slot, compression: lvl }
          changed = true
        }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resolveCompression,
    settings,
    adminDefaults,
    slots[0].symbol, slots[0].market, slots[0].timeframe,
    slots[1].symbol, slots[1].market, slots[1].timeframe,
  ])

  const setSymbol = useCallback((s: string) => {
    setSlots(prev => {
      const slot = prev[activeSlot]
      const tfs = TIMEFRAMES_BY_MARKET[slot.market]
      const tf = tfs.includes(slot.timeframe) ? slot.timeframe : tfs[0]!
      // Rebuild the slot's per-TF mirror from settings for the new symbol — previous
      // symbol's cache is irrelevant.
      const savedForNew = getSetting<Record<string, number>>(`chartCompression_${s}`, {})
      const byTf = normalizeByTf(savedForNew)
      const lvl = resolveCompression(s, slot.market, tf, byTf)
      const next: [ChartSlot, ChartSlot] = [{ ...prev[0] }, { ...prev[1] }]
      next[activeSlot] = {
        ...slot,
        symbol: s,
        timeframe: tf,
        compression: lvl,
        compressionByTf: byTf,
      }
      return next
    })
  }, [activeSlot, getSetting, resolveCompression])

  const setMarket = useCallback((m: MarketType) => {
    setSlots(prev => {
      const slot = prev[activeSlot]
      const tfs = TIMEFRAMES_BY_MARKET[m]
      const tf = tfs.includes(slot.timeframe) ? slot.timeframe : tfs[0]!
      const lvl = resolveCompression(slot.symbol, m, tf, slot.compressionByTf)
      const next: [ChartSlot, ChartSlot] = [{ ...prev[0] }, { ...prev[1] }]
      next[activeSlot] = { ...slot, market: m, timeframe: tf, compression: lvl }
      return next
    })
  }, [activeSlot, resolveCompression])

  const setTimeframe = useCallback((tf: string) => {
    setSlots(prev => {
      const slot = prev[activeSlot]
      const lvl = resolveCompression(slot.symbol, slot.market, tf, slot.compressionByTf)
      const next: [ChartSlot, ChartSlot] = [{ ...prev[0] }, { ...prev[1] }]
      next[activeSlot] = { ...slot, timeframe: tf, compression: lvl }
      return next
    })
  }, [activeSlot, resolveCompression])

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
    const slot = slots[activeSlot]
    const symbol = slot.symbol
    const tfKey = `${slot.market}_${slot.timeframe}`
    explicitChoiceRef.current.add(`${symbol}_${tfKey}`)
    const existing = getSetting<Record<string, number>>(`chartCompression_${symbol}`, {})
    const nextSaved = { ...normalizeByTf(existing), [tfKey]: level }
    setSetting(`chartCompression_${symbol}`, nextSaved)
    updateSlot(activeSlot, {
      compression: level,
      compressionByTf: { ...slot.compressionByTf, [tfKey]: level },
    })
  }, [activeSlot, slots, updateSlot, getSetting, setSetting])

  // Returns ticker config for active symbol, merging API overrides on top of hardcoded fallback.
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

  const getAdminDefaultCompression = useCallback(
    (market: MarketType, tf: string): number | undefined => {
      const map = adminDefaults[active.symbol]
      if (!map) return undefined
      const v = map[`${market}_${tf}`]
      return typeof v === 'number' && v > 0 ? v : undefined
    },
    [active.symbol, adminDefaults]
  )

  const invalidateAdminDefaults = useCallback((symbol: string) => {
    const sym = symbol.toUpperCase()
    adminFetchInflightRef.current.delete(sym)
    setAdminDefaults(prev => {
      if (prev[sym] === undefined) return prev
      const next = { ...prev }
      delete next[sym]
      return next
    })
  }, [])

  return (
    <ChartControlsContext.Provider value={{
      activeSlot, setActiveSlot, getSlot, showIndicatorsModal,
      setSymbol, setMarket, setTimeframe, setCandleMode, setPalette, setVolumeMode, setCompression, setShowIndicatorsModal,
      getTickerConfig, getCompressionLevels, getAdminDefaultCompression, invalidateAdminDefaults,
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
