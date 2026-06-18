import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from '@/i18n'
import { useAuthContext } from '@/features/auth/AuthContext'
import {
  useChartControls,
  AVAILABLE_TICKERS,
  TIMEFRAMES_BY_MARKET,
  type MarketType,
} from '@/contexts/ChartControlsContext'
import { useCandlePalette } from '@/contexts/CandlePaletteContext'
import type { CandleMode, VolumeMode } from '@/chart-engine'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, SlidersHorizontal, Zap, Lock, Check, Star } from 'lucide-react'
import { AutoIcon } from '@/components/icons/AutoIcon'
import { JapaneseIcon } from '@/components/icons/JapaneseIcon'
import { BarsIcon } from '@/components/icons/BarsIcon'
import { FootprintIcon } from '@/components/icons/FootprintIcon'
import { ClustersIcon } from '@/components/icons/ClustersIcon'
import { Portal } from '@/components/Portal'

import { CandlePreviewIcon } from '@/components/icons/CandlePreviewIcon'
import { useFavoritePairs } from '@/hooks/useFavoritePairs'

const CANDLE_MODES: { mode: CandleMode; icon: typeof AutoIcon; labelKey: string }[] = [
  { mode: 'auto', icon: AutoIcon, labelKey: 'chart.auto' },
  { mode: 'japanese', icon: JapaneseIcon, labelKey: 'chart.japanese' },
  { mode: 'bars', icon: BarsIcon, labelKey: 'chart.bars' },
  { mode: 'footprint', icon: FootprintIcon, labelKey: 'chart.footprint' },
  { mode: 'clusters', icon: ClustersIcon, labelKey: 'chart.clusters' },
]

const VOLUME_MODES: { mode: VolumeMode; labelKey: string }[] = [
  { mode: 'bidask', labelKey: 'chart.bidAsk' },
  { mode: 'volume', labelKey: 'chart.volume' },
  { mode: 'delta', labelKey: 'chart.delta' },
]

interface ChartHeaderProps {
  fps?: number
  showAnomalies?: boolean
  onToggleAnomalies?: () => void
}

export function ChartHeader({ fps = 0, showAnomalies = true, onToggleAnomalies }: ChartHeaderProps) {
  const { t } = useTranslation()
  const { user } = useAuthContext()
  const {
    activeSlot, getSlot,
    setSymbol, setMarket, setTimeframe, setCandleMode, setPalette: setControlsPalette,
    setVolumeMode, setCompression, setShowIndicatorsModal, showIndicatorsModal,
    getTickerConfig, getCompressionLevels,
  } = useChartControls()
  const { setActivePalette } = useCandlePalette()
  const slot = getSlot(activeSlot)
  const { symbol, market, timeframe, candleMode, palette, volumeMode, compression } = slot

  const [tickerDropdownOpen, setTickerDropdownOpen] = useState(false)
  const [compressionDropdownOpen, setCompressionDropdownOpen] = useState(false)
  const tickerRef = useRef<HTMLDivElement>(null)
  const compressionRef = useRef<HTMLDivElement>(null)
  const tickerPortalRef = useRef<HTMLDivElement>(null)
  const compressionPortalRef = useRef<HTMLDivElement>(null)
  const [tickerBtnRect, setTickerBtnRect] = useState<DOMRect | null>(null)
  const [compressionBtnRect, setCompressionBtnRect] = useState<DOMRect | null>(null)
  const [paletteDropdownOpen, setPaletteDropdownOpen] = useState(false)
  const paletteRef = useRef<HTMLDivElement>(null)
  const palettePortalRef = useRef<HTMLDivElement>(null)
  const [paletteBtnRect, setPaletteBtnRect] = useState<DOMRect | null>(null)
  const { isFavorite, toggleFavorite } = useFavoritePairs()

  const tickerConfig = getTickerConfig()
  const compressionLevels = getCompressionLevels()
  const chartCompressionLocked = user?.chartCompressionLocked ?? true
  const baseCompression = market === 'futures' ? tickerConfig.baseFutures : tickerConfig.baseSpot

  const resolvedMode = candleMode === 'auto' ? 'japanese' : candleMode

  const showVolumeMode = candleMode === 'clusters' || candleMode === 'footprint' ||
    (candleMode === 'auto' && (resolvedMode === 'clusters' || resolvedMode === 'footprint'))

  const openTickerDropdown = useCallback(() => {
    if (tickerRef.current) {
      setTickerBtnRect(tickerRef.current.getBoundingClientRect())
    }
    setTickerDropdownOpen(true)
    setCompressionDropdownOpen(false)
  }, [])

  const openCompressionDropdown = useCallback(() => {
    if (compressionRef.current) {
      setCompressionBtnRect(compressionRef.current.getBoundingClientRect())
    }
    setCompressionDropdownOpen(true)
    setTickerDropdownOpen(false)
  }, [])

  const openPaletteDropdown = useCallback(() => {
    if (paletteRef.current) {
      setPaletteBtnRect(paletteRef.current.getBoundingClientRect())
    }
    setPaletteDropdownOpen(true)
    setTickerDropdownOpen(false)
    setCompressionDropdownOpen(false)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (tickerRef.current && !tickerRef.current.contains(target) && !tickerPortalRef.current?.contains(target)) {
        setTickerDropdownOpen(false)
      }
      if (compressionRef.current && !compressionRef.current.contains(target) && !compressionPortalRef.current?.contains(target)) {
        setCompressionDropdownOpen(false)
      }
      if (paletteRef.current && !paletteRef.current.contains(target) && !palettePortalRef.current?.contains(target)) {
        setPaletteDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handlePaletteChange = useCallback((p: 'default' | 'alternative') => {
    setControlsPalette(p)
    setActivePalette(activeSlot, p)
  }, [setControlsPalette, setActivePalette, activeSlot])

  return (
    <div className="relative flex items-start gap-1 px-2 py-2.5 bg-slate-950/40 border-b border-slate-900/60 shadow-md backdrop-blur-md shrink-0 overflow-x-auto flex-wrap lg:flex-nowrap" style={{ zIndex: 1000 }}>
      {/* 1. Ticker selector */}
      <div className="shrink-0">
        <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">Active Ticker</span>
        <div className="relative" ref={tickerRef}>
        <button
          onClick={() => tickerDropdownOpen ? setTickerDropdownOpen(false) : openTickerDropdown()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none whitespace-nowrap"
        >
          <span className="text-amber-400 font-mono text-[11px]">{symbol}</span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${tickerDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 2. Market type SPOT / FUTURES */}
      <div className="shrink-0">
        <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">Market Type</span>
        <div className="flex items-center p-0.5 rounded-lg bg-slate-950/60 border border-white/5">
          {(['futures', 'spot'] as MarketType[]).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all ${
                market === m
                  ? 'bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold shadow-inner'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {m === 'spot' ? t('chart.spot') : t('chart.futures')}
            </button>
          ))}
        </div>
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 3. Timeframes */}
      <div className="shrink-0">
        <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">Interval</span>
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES_BY_MARKET[market].map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 rounded-lg text-xs font-bold font-mono cursor-pointer transition-all duration-200 h-[30px] ${
                timeframe === tf
                  ? 'liquid-glass-active text-yellow-400 font-black'
                  : 'liquid-glass-button text-slate-400 hover:text-slate-100'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 4. Candle type */}
      <div className="shrink-0">
        <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">{t('chart.candleType')}</span>
        <div className="flex items-center gap-0.5">
          {CANDLE_MODES.map(({ mode, icon: Icon, labelKey }) => (
            <button
              key={mode}
              onClick={() => setCandleMode(mode)}
              title={t(labelKey)}
              className={`flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-bold cursor-pointer transition-all h-[24px] ${
                candleMode === mode
                  ? 'bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold shadow-inner'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 4b. Anomalies toggle */}
      <div className="shrink-0">
        <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">Anomalies</span>
        <button
          onClick={onToggleAnomalies}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-all h-[30px] select-none border ${
            showAnomalies
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
              : 'text-slate-400 hover:text-slate-200 border-white/5'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${showAnomalies ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          <span>{showAnomalies ? 'On' : 'Off'}</span>
        </button>
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 5. Palette dropdown */}
      <div className="shrink-0">
        <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">{t('chart.palette')}</span>
        <div className="relative" ref={paletteRef}>
          <button
            onClick={() => paletteDropdownOpen ? setPaletteDropdownOpen(false) : openPaletteDropdown()}
            className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg text-xs cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-all min-w-[40px] h-[30px] select-none border liquid-glass-button border-white/5 text-slate-200 font-black"
          >
            <CandlePreviewIcon palette={palette} />
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 shrink-0 text-slate-400 ${paletteDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* 6. Volume mode — visible only for clusters/footprint */}
      {showVolumeMode && (
        <>
          <div className="w-px h-5 bg-white/10 mx-0.5" />
          <div className="shrink-0">
            <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">{t('chart.volumeData')}</span>
            <div className="flex items-center p-0.5 rounded-lg bg-slate-950/60 border border-white/5">
              {VOLUME_MODES.map(({ mode, labelKey }) => (
                <button
                  key={mode}
                  onClick={() => setVolumeMode(mode)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                    volumeMode === mode
                      ? 'bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold shadow-inner'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 7. Compression */}
      <div className="shrink-0">
        <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">{t('chart.compression')}</span>
        <div className="relative" ref={compressionRef}>
        <button
          onClick={() => compressionDropdownOpen ? setCompressionDropdownOpen(false) : openCompressionDropdown()}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none whitespace-nowrap ${
            chartCompressionLocked && compression > 1 ? 'opacity-60' : ''
          }`}
        >
          <span className="font-mono text-[10px] text-slate-300">
            {compression === 1 ? `×${baseCompression}` : `×${compression}`}
          </span>
          <span className="text-[10px] text-slate-500 hidden sm:inline">{t('chart.compression')}</span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${compressionDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 8. Indicators button */}
      <div className="shrink-0">
        <span className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 text-slate-400/80">Controls</span>
        <button
          onClick={() => setShowIndicatorsModal(!showIndicatorsModal)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none"
          title={t('chart.indicators')}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden md:inline">{t('chart.indicators')}</span>
        </button>
      </div>

      {/* FPS counter */}
      <div className="ml-auto flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono text-slate-500">
        <Zap className="w-3 h-3 text-emerald-500/60" />
        <span>{fps}</span>
      </div>

      {/* PORTALS: dropdowns rendered in document.body to escape canvas stacking context */}
      <Portal>
        <AnimatePresence>
          {tickerDropdownOpen && tickerBtnRect && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="muddy-glass-popover rounded-xl p-2 min-w-[200px]"
              ref={tickerPortalRef}
              style={{
                position: 'fixed',
                top: tickerBtnRect.bottom + 4,
                left: tickerBtnRect.left,
                zIndex: 99999,
              }}
            >
              <div className="text-[9px] font-bold px-2 pb-1 border-b border-white/5 mb-1.5 uppercase tracking-widest text-slate-400">
                Available Pairs
              </div>
              <div className="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto pr-1">
                {[...AVAILABLE_TICKERS]
                  .sort((a, b) => {
                    const aFav = isFavorite(a.symbol) ? 1 : 0
                    const bFav = isFavorite(b.symbol) ? 1 : 0
                    if (aFav !== bFav) return bFav - aFav
                    return a.name.localeCompare(b.name)
                  })
                  .map((ticker) => {
                  const isActive = symbol === ticker.symbol
                  const isFav = isFavorite(ticker.symbol)
                  return (
                    <div
                      key={ticker.symbol}
                      className={`flex items-center justify-between px-2 py-1 rounded-lg transition-all ${
                        isActive
                          ? 'bg-yellow-500/10 text-yellow-500 font-extrabold border border-yellow-500/25'
                          : 'text-slate-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(ticker.symbol) }}
                          className={`p-0.5 rounded cursor-pointer transition-all duration-100 active:scale-90 ${
                            isFav
                              ? 'text-yellow-400 hover:text-yellow-500'
                              : 'text-slate-600 hover:text-slate-400'
                          }`}
                          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          onClick={() => { setSymbol(ticker.symbol); setTickerDropdownOpen(false) }}
                          className="flex-1 text-left font-mono text-xs font-bold truncate cursor-pointer bg-transparent border-none p-0 outline-none"
                        >
                          {ticker.name}
                        </button>
                      </div>
                      {isActive && (
                        <Check className="w-3 h-3 shrink-0 ml-1" />
                      )}
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Portal>

      <Portal>
        <AnimatePresence>
          {compressionDropdownOpen && compressionBtnRect && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="muddy-glass-popover rounded-xl p-1.5 min-w-[160px]"
              ref={compressionPortalRef}
              style={{
                position: 'fixed',
                top: compressionBtnRect.bottom + 4,
                left: compressionBtnRect.left,
                zIndex: 99999,
              }}
            >
              {compressionLevels.map((level, idx) => {
                const isBase = level === baseCompression
                const isDisabled = chartCompressionLocked && !isBase
                return (
                  <button
                    key={level}
                    title={isDisabled ? t('chart.compressionLocked') : undefined}
                    onClick={() => {
                      if (!isDisabled) {
                        setCompression(idx + 1)
                        setCompressionDropdownOpen(false)
                      }
                    }}
                    disabled={isDisabled}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-bold text-left transition ${
                      compression === idx + 1
                        ? 'bg-amber-500/15 text-amber-400'
                        : isDisabled
                          ? 'text-slate-600 cursor-not-allowed'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white cursor-pointer'
                    }`}
                  >
                    <span className="font-mono text-[11px]">
                      {level}
                      {isBase && <span className="text-[9px] text-amber-500/70 ml-1">base</span>}
                    </span>
                    {isDisabled ? (
                      <span className="flex items-center gap-1 text-[8px] text-slate-600 max-w-[90px] text-right leading-tight">
                        <Lock className="w-2.5 h-2.5 shrink-0" />
                        {t('chart.compressionLocked')}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </Portal>

      <Portal>
        <AnimatePresence>
          {paletteDropdownOpen && paletteBtnRect && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="muddy-glass-popover rounded-xl p-1.5 min-w-[160px]"
              ref={palettePortalRef}
              style={{
                position: 'fixed',
                top: paletteBtnRect.bottom + 4,
                left: paletteBtnRect.left,
                zIndex: 99999,
              }}
            >
              <div className="flex flex-col gap-0.5">
                {([
                  { id: 'default' as const, labelKey: 'chart.classic' },
                  { id: 'alternative' as const, labelKey: 'chart.alternative' },
                ]).map(({ id, labelKey }) => {
                  const isSelected = palette === id
                  return (
                    <button
                      key={id}
                      onClick={() => { handlePaletteChange(id); setPaletteDropdownOpen(false) }}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-left cursor-pointer transition-all w-full text-xs font-bold ${
                        isSelected
                          ? 'bg-white/5 text-white font-extrabold'
                          : 'text-slate-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 select-none">
                        <CandlePreviewIcon palette={id} />
                        <span className="font-mono text-[10px] font-bold">{t(labelKey)}</span>
                      </div>
                      {isSelected && (
                        <Check className="w-3 tracking-tight ml-1 text-amber-500 shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Portal>
    </div>
  )
}
