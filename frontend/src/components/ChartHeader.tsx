import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from '@/i18n'
import { useAuth } from '@/features/auth/useAuth'
import {
  useChartControls,
  AVAILABLE_TICKERS,
  TIMEFRAMES_BY_MARKET,
  type MarketType,
} from '@/contexts/ChartControlsContext'
import { useCandlePalette } from '@/contexts/CandlePaletteContext'
import type { CandleMode, VolumeMode } from '@/chart-engine'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, SlidersHorizontal, Zap } from 'lucide-react'
import { AutoIcon } from '@/components/icons/AutoIcon'
import { JapaneseIcon } from '@/components/icons/JapaneseIcon'
import { FootprintIcon } from '@/components/icons/FootprintIcon'
import { ClustersIcon } from '@/components/icons/ClustersIcon'
import { SingleChartIcon, HorizontalSplitIcon, VerticalSplitIcon } from '@/components/icons/LayoutIcons'
import { Portal } from '@/components/Portal'
import { useLayout, type LayoutMode } from '@/contexts/LayoutContext'

const CANDLE_MODES: { mode: CandleMode; icon: typeof AutoIcon; labelKey: string }[] = [
  { mode: 'auto', icon: AutoIcon, labelKey: 'chart.auto' },
  { mode: 'japanese', icon: JapaneseIcon, labelKey: 'chart.japanese' },
  { mode: 'bars', icon: null as any, labelKey: 'chart.bars' },
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
}

export function ChartHeader({ fps = 0 }: ChartHeaderProps) {
  const { t } = useTranslation()
  const { userRole } = useAuth()
  const {
    activeSlot, setActiveSlot, getSlot,
    setSymbol, setMarket, setTimeframe, setCandleMode, setPalette: setControlsPalette,
    setVolumeMode, setCompression, setShowIndicatorsModal, showIndicatorsModal,
    getTickerConfig, getCompressionLevels,
  } = useChartControls()
  const { setActivePalette } = useCandlePalette()
  const { layoutMode, setLayoutMode } = useLayout()

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

  const tickerConfig = getTickerConfig()
  const compressionLevels = getCompressionLevels()
  const isFree = userRole === 'Free' || userRole === 'Guest'
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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (tickerRef.current && !tickerRef.current.contains(target) && !tickerPortalRef.current?.contains(target)) {
        setTickerDropdownOpen(false)
      }
      if (compressionRef.current && !compressionRef.current.contains(target) && !compressionPortalRef.current?.contains(target)) {
        setCompressionDropdownOpen(false)
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
    <div className="relative flex items-center gap-1 px-2 py-1.5 liquid-glass-card border-b border-white/5 shrink-0 overflow-x-auto" style={{ zIndex: 1000 }}>
      {/* 1. Ticker selector */}
      <div className="relative" ref={tickerRef}>
        <button
          onClick={() => tickerDropdownOpen ? setTickerDropdownOpen(false) : openTickerDropdown()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none whitespace-nowrap"
        >
          <span className="text-amber-400 font-mono text-[11px]">{symbol}</span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${tickerDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 2. Market type SPOT / FUTURES */}
      <div className="flex items-center p-0.5 rounded-lg bg-black/30 border border-white/5">
        {(['futures', 'spot'] as MarketType[]).map((m) => (
          <button
            key={m}
            onClick={() => setMarket(m)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all ${
              market === m
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
                : 'text-slate-500 hover:text-slate-300 border border-transparent'
            }`}
          >
            {m === 'spot' ? t('chart.spot') : t('chart.futures')}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 3. Timeframes */}
      <div className="flex items-center gap-0.5">
        {TIMEFRAMES_BY_MARKET[market].map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-2 py-1 rounded-md text-[10px] font-bold font-mono cursor-pointer transition-all ${
              timeframe === tf
                ? 'bg-white/15 text-white border border-white/10'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 4. Candle type */}
      <div className="flex items-center gap-0.5">
        {CANDLE_MODES.map(({ mode, icon: Icon, labelKey }) => (
          <button
            key={mode}
            onClick={() => setCandleMode(mode)}
            title={t(labelKey)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
              candleMode === mode
                ? 'bg-white/15 text-white border border-white/10'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            <span className="hidden lg:inline">{t(labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 5. Palette */}
      <div className="flex items-center p-0.5 rounded-lg bg-black/30 border border-white/5">
        <button
          onClick={() => handlePaletteChange('default')}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
            palette === 'default'
              ? 'bg-white/15 text-white border border-white/10'
              : 'text-slate-500 hover:text-slate-300 border border-transparent'
          }`}
        >
          <span className="inline-flex gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          </span>
          <span className="hidden xl:inline">{t('chart.classic')}</span>
        </button>
        <button
          onClick={() => handlePaletteChange('alternative')}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
            palette === 'alternative'
              ? 'bg-white/15 text-white border border-white/10'
              : 'text-slate-500 hover:text-slate-300 border border-transparent'
          }`}
        >
          <span className="inline-flex gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
          </span>
          <span className="hidden xl:inline">{t('chart.alternative')}</span>
        </button>
      </div>

      {/* 6. Volume mode — visible only for clusters/footprint */}
      {showVolumeMode && (
        <>
          <div className="w-px h-5 bg-white/10 mx-0.5" />
          <div className="flex items-center p-0.5 rounded-lg bg-black/30 border border-white/5">
            {VOLUME_MODES.map(({ mode, labelKey }) => (
              <button
                key={mode}
                onClick={() => setVolumeMode(mode)}
                className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                  volumeMode === mode
                    ? 'bg-white/15 text-white border border-white/10'
                    : 'text-slate-500 hover:text-slate-300 border border-transparent'
                }`}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 7. Compression */}
      <div className="relative" ref={compressionRef}>
        <button
          onClick={() => compressionDropdownOpen ? setCompressionDropdownOpen(false) : openCompressionDropdown()}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none whitespace-nowrap ${
            isFree && compression > 1 ? 'opacity-60' : ''
          }`}
        >
          <span className="font-mono text-[10px] text-slate-300">
            {compression === 1 ? `×${baseCompression}` : `×${compression}`}
          </span>
          <span className="text-[10px] text-slate-500 hidden sm:inline">{t('chart.compression')}</span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${compressionDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 8. Indicators button */}
      <button
        onClick={() => setShowIndicatorsModal(!showIndicatorsModal)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none"
        title={t('chart.indicators')}
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
        <span className="hidden md:inline">{t('chart.indicators')}</span>
      </button>

      <div className="w-px h-5 bg-white/10 mx-0.5" />

      {/* 9. Layout switcher */}
      <div className="flex items-center p-0.5 rounded-lg bg-black/30 border border-white/5">
        {([
          { mode: 'single' as LayoutMode, icon: SingleChartIcon, label: t('chart.layoutSingle'), testId: 'layout-single' },
          { mode: 'horizontal' as LayoutMode, icon: HorizontalSplitIcon, label: t('chart.layoutHorizontal'), testId: 'layout-horizontal' },
          { mode: 'vertical' as LayoutMode, icon: VerticalSplitIcon, label: t('chart.layoutVertical'), testId: 'layout-vertical' },
        ]).map(({ mode, icon: Icon, label, testId }) => (
          <button
            key={mode}
            data-testid={testId}
            onClick={() => setLayoutMode(mode)}
            title={label}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
              layoutMode === mode
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* 10. Active chart indicator (dual mode) */}
      {layoutMode !== 'single' && (
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-black/30 border border-white/5">
          {[0, 1].map((i) => (
            <button
              key={i}
              onClick={() => setActiveSlot(i as 0 | 1)}
              data-testid={`slot-${i}`}
              className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                activeSlot === i
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

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
              className="muddy-glass-popover rounded-xl p-1.5 min-w-[140px]"
              ref={tickerPortalRef}
              style={{
                position: 'fixed',
                top: tickerBtnRect.bottom + 4,
                left: tickerBtnRect.left,
                zIndex: 99999,
              }}
            >
              {AVAILABLE_TICKERS.map((ticker) => (
                <button
                  key={ticker.symbol}
                  onClick={() => { setSymbol(ticker.symbol); setTickerDropdownOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-left transition cursor-pointer ${
                    symbol === ticker.symbol
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="font-mono text-[11px]">{ticker.symbol}</span>
                  <span className="text-[10px] text-slate-500">{ticker.name}</span>
                </button>
              ))}
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
                const isDisabled = isFree && !isBase
                return (
                  <button
                    key={level}
                    onClick={() => {
                      if (!isDisabled) {
                        setCompression(idx + 1)
                        setCompressionDropdownOpen(false)
                      }
                    }}
                    disabled={isDisabled}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-bold text-left transition cursor-pointer ${
                      compression === idx + 1
                        ? 'bg-amber-500/15 text-amber-400'
                        : isDisabled
                          ? 'text-slate-600 cursor-not-allowed'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="font-mono text-[11px]">
                      {level}
                      {isBase && <span className="text-[9px] text-amber-500/70 ml-1">base</span>}
                    </span>
                    {isDisabled && (
                      <span className="text-[8px] text-slate-600 max-w-[80px] text-right leading-tight">
                        {t('chart.upgradeHint')}
                      </span>
                    )}
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </Portal>
    </div>
  )
}
