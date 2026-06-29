import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from '@/i18n'
import { useUserLimits } from '@/contexts/LimitsContext'
import {
  useChartControls,
  AVAILABLE_TICKERS,
  TIMEFRAMES_BY_MARKET,
  type MarketType,
} from '@/contexts/ChartControlsContext'
import { useCandlePalette } from '@/contexts/CandlePaletteContext'
import { useTheme } from '@/contexts/ThemeContext'
import type { CandleMode, VolumeMode } from '@/chart-engine'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, SlidersHorizontal, Lock, Check, Star } from 'lucide-react'
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
  showAnomalies?: boolean
  onToggleAnomalies?: () => void
}

export function ChartHeader({ showAnomalies = true, onToggleAnomalies }: ChartHeaderProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const { limits } = useUserLimits()
  const {
    activeSlot, getSlot,
    setSymbol, setMarket, setTimeframe, setCandleMode, setPalette: setControlsPalette,
    setVolumeMode, setCompression, setShowIndicatorsModal, showIndicatorsModal,
    getTickerConfig, getCompressionLevels, getAdminDefaultCompression,
    serverTickers,
  } = useChartControls()
  // Selector list is server-driven; fall back to hardcoded list until the server responds.
  const tickerList = serverTickers.length > 0 ? serverTickers : AVAILABLE_TICKERS
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
  const compressionMax = limits.compressionMax ?? 1
  const chartCompressionLocked = compressionMax < 10
  const baseCompression = market === 'futures' ? tickerConfig.baseFutures : tickerConfig.baseSpot

  const showVolumeMode = candleMode === 'clusters' || candleMode === 'footprint' || candleMode === 'auto'

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
    <div className={`relative flex items-start gap-1 px-2 py-1.5 border-b shadow-md shrink-0 overflow-x-auto flex-wrap lg:flex-nowrap transition-all duration-300 ${
      isLight
        ? 'bg-slate-200/90 border-slate-300 shadow-sm'
        : 'bg-slate-950/40 border-slate-900/60 backdrop-blur-md'
    }`} style={{ zIndex: 1000 }}>
      {/* 1. Ticker selector */}
      <div className="shrink-0">
        <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>{t('chart.ticker')}</span>
        <div className="relative" ref={tickerRef}>
        <button
          onClick={() => tickerDropdownOpen ? setTickerDropdownOpen(false) : openTickerDropdown()}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none whitespace-nowrap h-[30px] ${
            isLight ? 'text-slate-900' : ''
          }`}
        >
          <span className={`font-mono text-[11px] ${isLight ? 'text-slate-800' : 'text-amber-400'}`}>{symbol}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${isLight ? 'text-slate-600' : 'text-slate-400'} ${tickerDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      </div>

      <div className={`w-px h-5 mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-white/10'}`} />

      {/* 2. Market type SPOT / FUTURES */}
      <div className="shrink-0">
        <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>{t('chart.market')}</span>
        <div className={`flex items-center p-0.5 rounded-lg border h-[30px] ${isLight ? 'bg-slate-200 border-slate-300' : 'bg-slate-950/60 border-white/5'}`}>
          {(['futures', 'spot'] as MarketType[]).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all ${
                market === m
                  ? isLight
                    ? 'bg-white text-slate-900 font-extrabold border border-slate-300 shadow-sm'
                    : 'bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold shadow-inner'
                  : isLight
                    ? 'text-slate-500 hover:text-slate-900 border border-transparent'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {m === 'spot' ? t('chart.spot') : t('chart.futures')}
            </button>
          ))}
        </div>
      </div>

      <div className={`w-px h-5 mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-white/10'}`} />

      {/* 3. Timeframes */}
      <div className="shrink-0">
        <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>{t('chart.interval')}</span>
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES_BY_MARKET[market].map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 rounded-lg text-xs font-bold font-mono cursor-pointer transition-all duration-200 h-[30px] ${
                timeframe === tf
                  ? 'liquid-glass-active text-yellow-400 font-black'
                  : isLight
                    ? 'liquid-glass-button text-slate-600 hover:text-slate-900'
                    : 'liquid-glass-button text-slate-400 hover:text-slate-100'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className={`w-px h-5 mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-white/10'}`} />

      {/* 4. Candle type */}
      <div className="shrink-0">
        <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>{t('chart.candleType')}</span>
        <div className="flex items-center gap-0.5">
          {CANDLE_MODES.map(({ mode, icon: Icon, labelKey }) => (
            <button
              key={mode}
              onClick={() => setCandleMode(mode)}
              title={t(labelKey)}
              className={`flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-bold cursor-pointer transition-all h-[30px] ${
                candleMode === mode
                  ? 'bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold shadow-inner'
                  : isLight
                    ? 'text-slate-500 hover:text-slate-900 border border-transparent'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      </div>

      <div className={`w-px h-5 mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-white/10'}`} />

      {/* 4b. Anomalies toggle */}
      <div className="shrink-0">
        <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>{t('chart.anomalies')}</span>
        <button
          onClick={limits.anomaliesEnabled ? onToggleAnomalies : undefined}
          disabled={!limits.anomaliesEnabled}
          title={!limits.anomaliesEnabled ? t('chart.compressionLocked') : undefined}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold transition-all h-[30px] select-none border ${
            !limits.anomaliesEnabled
              ? 'opacity-40 cursor-not-allowed text-slate-600 border-white/5'
              : showAnomalies
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 cursor-pointer'
                : 'text-slate-400 hover:text-slate-200 border-white/5 cursor-pointer'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${showAnomalies ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          <span>{showAnomalies ? t('common.on') : t('common.off')}</span>
        </button>
      </div>

      <div className={`w-px h-5 mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-white/10'}`} />

      {/* 5. Palette dropdown */}
      <div className="shrink-0">
        <span aria-hidden className="text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 invisible">.</span>
        <div className="relative" ref={paletteRef}>
          <button
            onClick={() => paletteDropdownOpen ? setPaletteDropdownOpen(false) : openPaletteDropdown()}
            className="flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-xs cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-all h-[30px] min-w-[40px] select-none border liquid-glass-button border-white/5 text-slate-200 font-black whitespace-nowrap"
          >
            <CandlePreviewIcon palette={palette} />
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 shrink-0 text-slate-400 ${paletteDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* 6. Volume mode — visible only for clusters/footprint */}
      {showVolumeMode && (
        <>
          <div className={`w-px h-5 mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-white/10'}`} />
          <div className="shrink-0">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>{t('chart.volumeData')}</span>
            <div className={`flex items-center p-0.5 rounded-lg border h-[30px] ${isLight ? 'bg-slate-200 border-slate-300' : 'bg-slate-950/60 border-white/5'}`}>
              {VOLUME_MODES.map(({ mode, labelKey }) => (
                <button
                  key={mode}
                  onClick={() => setVolumeMode(mode)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                    volumeMode === mode
                      ? isLight
                        ? 'bg-white text-slate-900 font-extrabold border border-slate-300 shadow-sm'
                        : 'bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold shadow-inner'
                      : isLight
                        ? 'text-slate-500 hover:text-slate-900 border border-transparent'
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

      <div className={`w-px h-5 mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-white/10'}`} />

      {/* 7. Compression */}
      <div className="shrink-0">
        <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>{t('chart.compression')}</span>
        <div className="relative" ref={compressionRef}>
        <button
          onClick={() => compressionDropdownOpen ? setCompressionDropdownOpen(false) : openCompressionDropdown()}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none whitespace-nowrap h-[30px] ${
            chartCompressionLocked && compression > 1 ? 'opacity-60' : ''
          }`}
        >
          <span className="font-mono text-[10px] text-slate-300">
            {compression * baseCompression}
          </span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${compressionDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      </div>

      <div className={`w-px h-5 mx-0.5 ${isLight ? 'bg-slate-300' : 'bg-white/10'}`} />

      {/* 8. Indicators button */}
      <div className="shrink-0">
        <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>{t('chart.controls')}</span>
        <button
          onClick={() => setShowIndicatorsModal(!showIndicatorsModal)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none h-[30px]"
          title={t('chart.indicators')}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden md:inline">{t('chart.indicators')}</span>
        </button>
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
              className={`rounded-xl p-2 min-w-[200px] ${isLight ? 'bg-white border border-slate-300 text-slate-900 shadow-2xl' : 'muddy-glass-popover text-slate-100'}`}
              ref={tickerPortalRef}
              style={{
                position: 'fixed',
                top: tickerBtnRect.bottom + 4,
                left: tickerBtnRect.left,
                zIndex: 99999,
              }}
            >
              <div className={`text-[9px] font-bold px-2 pb-1 border-b mb-1.5 uppercase tracking-widest ${isLight ? 'text-slate-500 border-slate-100' : 'text-slate-400 border-white/5'}`}>
                {t('chart.availablePairs')}
              </div>
              <div className="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto pr-1">
                {[...tickerList]
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
                          ? isLight
                            ? 'bg-amber-50 text-amber-700 font-extrabold border border-amber-200/50 shadow-sm'
                            : 'bg-yellow-500/10 text-yellow-500 font-extrabold border border-yellow-500/25'
                          : isLight
                            ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
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
                              : isLight
                                ? 'text-slate-300 hover:text-slate-500'
                                : 'text-slate-600 hover:text-slate-400'
                          }`}
                          title={isFav ? t('chart.removeFavorite') : t('chart.addFavorite')}
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
              className={`rounded-xl p-1.5 min-w-[160px] ${isLight ? 'bg-white border border-slate-300 text-slate-900 shadow-2xl' : 'muddy-glass-popover text-slate-100'}`}
              ref={compressionPortalRef}
              style={{
                position: 'fixed',
                top: compressionBtnRect.bottom + 4,
                left: compressionBtnRect.left,
                zIndex: 99999,
              }}
            >
              {(() => {
                const adminAbsolute = getAdminDefaultCompression(market, timeframe)
                return compressionLevels.map((level, idx) => {
                  const isBase = level === baseCompression
                  const isRecommended = adminAbsolute !== undefined && level === adminAbsolute
                  const isDisabled = compressionMax < 10 && (idx + 1) > compressionMax
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
                            ? isLight ? 'text-slate-400 cursor-not-allowed' : 'text-slate-600 cursor-not-allowed'
                            : isLight
                              ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer'
                              : 'text-slate-300 hover:bg-white/5 hover:text-white cursor-pointer'
                      }`}
                    >
                      <span className="font-mono text-[11px] flex items-center gap-1">
                        {level}
                        {isBase && <span className="text-[9px] text-amber-500/70">{t('chart.compressionBase')}</span>}
                        {isRecommended && (
                          <span className="relative group">
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 leading-none cursor-help">
                              {t('chart.compressionRecommended')}
                            </span>
                            <div className={`absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-50 hidden group-hover:block w-56 p-2.5 rounded-xl shadow-2xl border backdrop-blur-md pointer-events-none text-[10px] font-mono font-bold leading-tight ${
                              isLight ? "bg-white border-slate-300 text-slate-700" : "bg-[#090d16]/98 border-white/10 text-slate-300"
                            }`}>
                              {t('chart.compressionRecommendedTooltip')}
                            </div>
                          </span>
                        )}
                      </span>
                      {isDisabled ? (
                        <span className="flex items-center gap-1 text-[8px] text-slate-600 max-w-[90px] text-right leading-tight">
                          <Lock className="w-2.5 h-2.5 shrink-0" />
                          {t('chart.compressionLocked')}
                        </span>
                      ) : null}
                    </button>
                  )
                })
              })()}
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
              className={`rounded-xl p-1.5 min-w-[160px] ${isLight ? 'bg-white border border-slate-300 text-slate-900 shadow-2xl' : 'muddy-glass-popover text-slate-100'}`}
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
                          ? isLight
                            ? 'bg-slate-100 text-slate-900 font-extrabold'
                            : 'bg-white/5 text-white font-extrabold'
                          : isLight
                            ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
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
