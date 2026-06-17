import { useState, useCallback, useRef, useEffect } from 'react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { I18nProvider, useTranslation } from '@/i18n'
import { CandlePaletteProvider } from '@/contexts/CandlePaletteContext'
import { ChartControlsProvider, useChartControls, AVAILABLE_TICKERS, TIMEFRAMES_BY_MARKET } from '@/contexts/ChartControlsContext'
import type { MarketType } from '@/contexts/ChartControlsContext'
import { LayoutProvider, useLayout } from '@/contexts/LayoutContext'
import { UserSettingsProvider } from '@/contexts/UserSettingsContext'
import { AuthProvider } from '@/features/auth/AuthContext'
import { LoginModal } from '@/features/auth/LoginModal'
import { RegisterModal } from '@/features/auth/RegisterModal'
import { VerifyEmailBanner } from '@/features/auth/VerifyEmailBanner'
import { UserProfile } from '@/components/UserProfile'
import { AdminPanel } from '@/components/AdminPanel'
import { ChartContainer } from '@/components/ChartContainer'
import { ChartPanel } from '@/components/ChartPanel'
import { ChartContainer2 } from '@/chart2d/ChartContainer2'
import { ChartHeader } from '@/components/ChartHeader'
import { Logo } from '@/components/Logo'
import IndicatorsModal from '@/components/IndicatorsModal'
import { useIndicators } from '@/features/indicators/useIndicators'
import { UserDropdown } from '@/components/UserDropdown'
import RoadmapModal from '@/components/RoadmapModal'
import { Splitter } from '@/components/Splitter'
import { DOMSidebar } from '@/components/DOMSidebar'
import type { CandleMode, VolumeMode } from '@/chart-engine'
import { Sparkles, Sliders, X, Layers, ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

type View = 'terminal' | 'admin' | 'profile'

function AppShell() {
  const { showIndicatorsModal, setShowIndicatorsModal, getSlot, activeSlot, setActiveSlot, setSymbol, setMarket, setTimeframe, setCandleMode, setVolumeMode, setPalette, setCompression, getTickerConfig } = useChartControls()
  const { layoutMode, setLayoutMode, splitRatio, setSplitRatio } = useLayout()
  const useCanvas2d = import.meta.env['VITE_USE_CANVAS2D'] === 'true'
  const { indicators, activeIndicators, handleIndicatorToggle, handleIndicatorDeactivate, handleIndicatorVisibility, handleApplyIndicators } = useIndicators()
  const [currentView, setCurrentView] = useState<View>('terminal')
  const [fps, setFps] = useState(0)
  const [focusIndicatorId, setFocusIndicatorId] = useState<string | null>(null)
  const handleFpsChange = useCallback((f: number) => setFps(f), [])
  const handleResolvedModeChange = useCallback((_m: Exclude<CandleMode, 'auto'>) => {}, [])
  const onToggleIndicator = useCallback((id: string) => handleIndicatorToggle(id), [handleIndicatorToggle])
  const onToggleVisibility = useCallback((id: string) => handleIndicatorVisibility(id), [handleIndicatorVisibility])
  const onRemoveIndicator = useCallback((id: string) => handleIndicatorDeactivate(id), [handleIndicatorDeactivate])
  const onShowIndicatorsSettings = useCallback((id?: string) => {
    if (id) setFocusIndicatorId(id); else setFocusIndicatorId(null)
    setShowIndicatorsModal(true)
  }, [setShowIndicatorsModal])
  const [loginOpen, setLoginOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [isRoadmapOpen, setIsRoadmapOpen] = useState(false)
  const [activeMobileTab, setActiveMobileTab] = useState<'chart' | 'dom'>('chart')
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false)
  const [domCollapsed, setDomCollapsed] = useState(() => {
    try { return localStorage.getItem('procluster_dom_collapsed') === 'true' } catch { return false }
  })
  const toggleDomCollapsed = useCallback(() => {
    setDomCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('procluster_dom_collapsed', String(next)) } catch {}
      return next
    })
  }, [])
  const { language, t } = useTranslation()

  const chartAreaRef = useRef<HTMLDivElement>(null)

  const handleSplitterDrag = useCallback((delta: number) => {
    if (!chartAreaRef.current) return
    const rect = chartAreaRef.current.getBoundingClientRect()
    if (layoutMode === 'horizontal') {
      setSplitRatio(splitRatio + delta / rect.width)
    } else {
      setSplitRatio(splitRatio + delta / rect.height)
    }
  }, [layoutMode, splitRatio, setSplitRatio])

  const slot0 = getSlot(0)
  const slot1 = getSlot(1)

  useEffect(() => {
    if (layoutMode === 'single') setActiveSlot(0);
  }, [layoutMode, setActiveSlot]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#030712]/92 text-white terminal-grid">
      {/* Dynamic Drifting Liquid Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[5%] left-[3%] w-[450px] h-[450px] rounded-full liquid-blob-cyan blur-[100px] opacity-40" />
        <div className="absolute top-[50%] right-[5%] w-[550px] h-[550px] rounded-full liquid-blob-magenta blur-[120px] opacity-35" />
        <div className="absolute top-[30%] left-[45%] -translate-x-1/2 w-[420px] h-[420px] rounded-full liquid-blob-emerald blur-[90px] opacity-20" />
        <div className="absolute bottom-[2%] left-[10%] w-[380px] h-[380px] rounded-full liquid-blob-gold blur-[100px] opacity-30" />
      </div>
      <VerifyEmailBanner />

      {/* Main app header */}
      <header className="shrink-0 relative z-[1100] bg-slate-950/45 backdrop-blur-md">
        {/* First row */}
        <div className="flex items-center justify-between px-2 py-2 sm:px-6 sm:py-3 border-b border-white/10">
          <div className="flex items-center gap-2 relative z-10">
            <Logo />
            <button
              onClick={() => setIsRoadmapOpen(true)}
              className="ml-1 hidden lg:flex group items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest cursor-pointer transition-all duration-300 hover:scale-105 active:scale-98 select-none bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-500 shadow-md shadow-amber-500/5 animate-pulse"
              style={{ animationDuration: '2.5s' }}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 group-hover:rotate-12 transition-transform duration-300" />
              <span>BETA</span>
            </button>
          </div>
          <div className="flex items-center gap-2 relative z-10">
            {currentView !== 'terminal' && (
              <button
                className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all text-xs font-bold leading-none select-none bg-slate-950/40 hover:bg-slate-900/60 border-white/5 text-slate-300 hover:text-white shadow-inner"
                onClick={() => setCurrentView('terminal')}
              >
                Terminal
              </button>
            )}
            <UserDropdown
              onOpenProfile={() => setCurrentView('profile')}
              onOpenAdmin={() => setCurrentView('admin')}
              onOpenLogin={() => setLoginOpen(true)}
              onOpenHome={() => setCurrentView('terminal')}
            />
          </div>
        </div>

        {/* Mobile second row: settings toggle + Chart/DOM tabs */}
        <div className="flex lg:hidden w-full items-center justify-between gap-2.5 px-2 sm:px-6 pb-2 pt-1.5 border-t border-white/5 relative z-10">
          <button
            onClick={() => setIsMobileSettingsOpen(!isMobileSettingsOpen)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all duration-200 select-none ${
              isMobileSettingsOpen
                ? 'bg-yellow-500 text-slate-950 border-yellow-500 shadow-sm'
                : 'bg-yellow-500/10 hover:bg-yellow-500/15 border-yellow-500/20 text-yellow-400 shadow-inner'
            }`}
          >
            {isMobileSettingsOpen ? <X className="w-3.5 h-3.5" /> : <Sliders className="w-3.5 h-3.5" />}
            <span>{language === 'RU' ? 'Настройки' : language === 'KZ' ? 'Реттеу' : 'Params'}</span>
          </button>

          <div className="flex items-center p-0.5 rounded-lg border text-[10px] font-bold select-none gap-0.5 bg-slate-900/60 border-white/5">
            <button
              onClick={() => setActiveMobileTab('chart')}
              className={`px-3 py-1 rounded-md transition-all duration-200 cursor-pointer flex items-center gap-1 ${
                activeMobileTab === 'chart'
                  ? 'bg-yellow-500/25 border border-yellow-500/30 text-yellow-500 font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="font-bold">{language === 'RU' ? 'ГРАФИК' : language === 'KZ' ? 'ГРАФИКА' : 'CHART'}</span>
            </button>
            <button
              onClick={() => setActiveMobileTab('dom')}
              className={`px-3 py-1 rounded-md transition-all duration-200 cursor-pointer flex items-center gap-1 ${
                activeMobileTab === 'dom'
                  ? 'bg-yellow-500/25 border border-yellow-500/30 text-yellow-500 font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="font-bold">{language === 'RU' ? 'СТАКАН' : language === 'KZ' ? 'СТАКАН' : 'DOM'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile settings panel */}
      <AnimatePresence>
        {isMobileSettingsOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="lg:hidden border-b z-40 relative backdrop-blur-xl overflow-hidden select-none shadow-2xl bg-slate-950/95 border-slate-900/60 text-slate-100"
          >
            <div className="p-4 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-yellow-500" />
                  <span>{language === 'RU' ? 'Настройки графика' : language === 'KZ' ? 'График реттеулері' : 'Chart settings'}</span>
                </span>
                <button
                  onClick={() => setIsMobileSettingsOpen(false)}
                  className="p-1.5 rounded-lg border transition hover:bg-white/10 border-white/5 text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
                {(() => {
                  const active = getSlot(activeSlot)
                  const tickerInfo = getTickerConfig()
                  const base = active.market === 'futures' ? tickerInfo.baseFutures : tickerInfo.baseSpot
                  return (
                    <>
                      {/* Ticker */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-slate-400/80">
                          {language === 'EN' ? 'Active Ticker' : 'Пара (Ticker)'}
                        </span>
                        <select
                          value={active.symbol}
                          onChange={(e) => setSymbol(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono cursor-pointer h-[35px] border focus:outline-none transition-all duration-200 outline-none w-full bg-slate-900 border-white/5 text-yellow-500"
                        >
                          {AVAILABLE_TICKERS.map((p) => (
                            <option key={p.symbol} value={p.symbol} className="bg-slate-950 text-slate-100">
                              {p.symbol}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Market Type */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-slate-400/80">
                          {language === 'EN' ? 'Market Type' : 'Тип рынка (Market)'}
                        </span>
                        <div className="grid grid-cols-2 gap-0.5 p-[2px] rounded-lg h-[35px] items-center select-none border bg-slate-950/60 border-white/5">
                          {(['SPOT', 'FUTURES'] as const).map((type) => {
                            const mkt: MarketType = type === 'SPOT' ? 'spot' : 'futures'
                            return (
                              <button
                                key={type}
                                onClick={() => setMarket(mkt)}
                                className={`py-1 rounded-md text-[10px] font-bold font-mono transition-colors duration-200 cursor-pointer text-center leading-none h-[29px] ${
                                  active.market === mkt
                                    ? 'bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold shadow-inner'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {type}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Interval */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-slate-400/80">
                          {language === 'EN' ? 'Interval' : 'Таймфрейм / Interval'}
                        </span>
                        <select
                          value={active.timeframe}
                          onChange={(e) => setTimeframe(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono cursor-pointer h-[35px] border focus:outline-none transition-all duration-200 outline-none w-full bg-slate-900 border-white/5 text-slate-300 liquid-glass-button"
                        >
                          {TIMEFRAMES_BY_MARKET[active.market].map((item) => (
                            <option key={item} value={item} className="bg-slate-950 text-slate-100">
                              {item}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Candle Type */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-slate-400/80">
                          {language === 'EN' ? 'Candle Type' : 'Тип Свечей'}
                        </span>
                        <select
                          value={active.candleMode}
                          onChange={(e) => setCandleMode(e.target.value as any)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-sans cursor-pointer h-[35px] border focus:outline-none transition-all duration-200 outline-none w-full bg-slate-900 border-white/5 text-slate-300 liquid-glass-button"
                        >
                          <option value="auto" className="bg-slate-950 text-slate-100">{language === 'EN' ? 'Auto' : 'Автоматический / Auto'}</option>
                          <option value="japanese" className="bg-slate-950 text-slate-100">{language === 'EN' ? 'Japanese' : 'Японские / Japanese'}</option>
                          <option value="bars" className="bg-slate-950 text-slate-100">{language === 'EN' ? 'Bars' : 'Бары / Bars'}</option>
                          <option value="footprint" className="bg-slate-950 text-slate-100">{language === 'EN' ? 'Footprint' : 'Футпринт / Footprint'}</option>
                          <option value="clusters" className="bg-slate-950 text-slate-100">{language === 'EN' ? 'Clusters' : 'Кластера / Clusters'}</option>
                        </select>
                      </div>

                      {/* Palette */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-slate-400/80">
                          {language === 'EN' ? 'Palette' : 'Палитра'}
                        </span>
                        <select
                          value={active.palette}
                          onChange={(e) => setPalette(e.target.value as any)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-sans cursor-pointer h-[35px] border focus:outline-none transition-all duration-200 outline-none w-full bg-slate-900 border-white/5 text-slate-300 liquid-glass-button"
                        >
                          <option value="default" className="bg-slate-950 text-slate-100">{language === 'EN' ? 'Default' : 'Стандарт / Default'}</option>
                          <option value="alternative" className="bg-slate-950 text-slate-100">{language === 'EN' ? 'Alternative' : 'Альт / Alternative'}</option>
                        </select>
                      </div>

                      {/* Candle Data (Volume Mode) */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-slate-400/80">
                          {language === 'EN' ? 'Candle Data' : 'Данные свечей'}
                        </span>
                        <select
                          value={active.volumeMode}
                          onChange={(e) => setVolumeMode(e.target.value as VolumeMode)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-sans cursor-pointer h-[35px] border focus:outline-none transition-all duration-200 outline-none w-full bg-slate-900 border-white/5 text-slate-300 liquid-glass-button"
                        >
                          <option value="bidask" className="bg-slate-950 text-slate-100">Bid Ask</option>
                          <option value="volume" className="bg-slate-950 text-slate-100">{language === 'EN' ? 'Volume' : 'Объем / Volume'}</option>
                          <option value="delta" className="bg-slate-950 text-slate-100">Delta</option>
                        </select>
                      </div>

                      {/* Compression */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-slate-400/80">
                          {language === 'EN' ? 'Compression' : 'Сжатие шага'}
                        </span>
                        <select
                          value={active.compression}
                          onChange={(e) => setCompression(parseInt(e.target.value))}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono cursor-pointer h-[35px] border focus:outline-none transition-all duration-200 outline-none w-full bg-slate-900 border-white/5 text-slate-300 liquid-glass-button"
                        >
                          {[1, 2, 3, 4, 5, 6].map((multiplier) => {
                            const actualValue = base * multiplier
                            return (
                              <option key={multiplier} value={multiplier} className="bg-slate-950 text-slate-100">
                                {multiplier}x ({actualValue})
                              </option>
                            )
                          })}
                        </select>
                      </div>

                      {/* Indicators trigger */}
                      <div className="flex flex-col gap-1 justify-end">
                        <button
                          onClick={() => {
                            setShowIndicatorsModal(true)
                            setIsMobileSettingsOpen(false)
                          }}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-black text-xs cursor-pointer h-[35px] hover:scale-[1.01] active:scale-[0.99] transition-all border liquid-glass-button text-slate-300 hover:text-white border-white/5"
                        >
                          <Layers className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                          <span>{language === 'EN' ? 'Indicators' : 'Индикаторы'}</span>
                        </button>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col pt-0 pl-1 sm:pl-2 pr-0 pb-1 sm:pb-2 gap-1.5 sm:gap-2">
        {currentView === 'terminal' && (
          <div className="flex-1 flex flex-col h-full gap-1 sm:gap-2">
            {/* Chart header controls */}
            <div className="hidden lg:block">
              <ChartHeader fps={fps} />
            </div>

            {/* Chart area */}
              <div ref={chartAreaRef} className="flex-1 flex relative overflow-hidden gap-3 lg:gap-5">
                <div className={`flex-1 relative overflow-hidden min-h-0 min-w-0 ${activeMobileTab === 'dom' ? 'hidden lg:flex' : ''}`}>
                  {layoutMode === 'single' && (
                    <div className="absolute inset-0">
                      {useCanvas2d ? (
                        <ChartContainer2
                          symbol={slot0.symbol}
                          market={slot0.market}
                          timeframe={slot0.timeframe}
                          chartIndex={0}
                          mode={slot0.candleMode}
                          volumeMode={slot0.volumeMode}
                          compression={slot0.compression}
                          palette={slot0.palette}
                          layoutMode={layoutMode}
                          indicators={indicators}
                          activeIndicators={activeIndicators}
                            onToggleIndicator={onToggleIndicator}
                            onToggleVisibility={onToggleVisibility}
                            onRemoveIndicator={onRemoveIndicator}
                          onShowIndicatorsSettings={onShowIndicatorsSettings}
                          onLayoutChange={setLayoutMode}
                        />
                      ) : (
                        <ChartContainer
                          symbol={slot0.symbol}
                          market={slot0.market}
                          timeframe={slot0.timeframe}
                          chartIndex={0}
                          mode={slot0.candleMode}
                          volumeMode={slot0.volumeMode}
                          compression={slot0.compression}
                          palette={slot0.palette}
                          onFpsChange={handleFpsChange}
                          onResolvedModeChange={handleResolvedModeChange}
                        />
                      )}
                    </div>
                  )}

                  {layoutMode === 'horizontal' && (
                    <div className="absolute inset-0 flex">
                      <div
                        style={{ width: `${splitRatio * 100}%` }}
                        className={`relative h-full overflow-hidden border-2 transition-all duration-150 ${
                          activeSlot === 0
                            ? 'border-yellow-500/50 shadow-md shadow-yellow-500/5 bg-slate-900/10'
                            : 'border-transparent'
                        }`}
                        onClick={() => setActiveSlot(0)}
                      >
                        {useCanvas2d ? (
                          <ChartContainer2
                            symbol={slot0.symbol}
                            market={slot0.market}
                            timeframe={slot0.timeframe}
                            chartIndex={0}
                            mode={slot0.candleMode}
                            volumeMode={slot0.volumeMode}
                            compression={slot0.compression}
                            palette={slot0.palette}
                            layoutMode={layoutMode}
                            indicators={indicators}
                            activeIndicators={activeIndicators}
                            onToggleIndicator={onToggleIndicator}
                            onToggleVisibility={onToggleVisibility}
                            onRemoveIndicator={onRemoveIndicator}
                            onShowIndicatorsSettings={onShowIndicatorsSettings}
                            onLayoutChange={setLayoutMode}
                          />
                        ) : (
                          <ChartPanel
                            symbol={slot0.symbol}
                            market={slot0.market}
                            timeframe={slot0.timeframe}
                            chartIndex={0}
                            mode={slot0.candleMode}
                            volumeMode={slot0.volumeMode}
                            compression={slot0.compression}
                            palette={slot0.palette}
                            onFpsChange={handleFpsChange}
                            onResolvedModeChange={handleResolvedModeChange}
                          />
                        )}
                        {activeSlot === 0 && (
                          <div className="absolute top-2 right-2.5 z-45 bg-yellow-500 text-slate-950 text-[8px] font-black uppercase px-2 py-0.5 rounded shadow-md tracking-widest leading-none select-none">
                            {language === 'RU' ? 'Активен' : language === 'KZ' ? 'Белсенді' : 'Active'}
                          </div>
                        )}
                      </div>
                      <Splitter direction="horizontal" onDrag={handleSplitterDrag} />
                      <div
                        style={{ width: `${(1 - splitRatio) * 100}%` }}
                        className={`relative h-full overflow-hidden border-2 transition-all duration-150 ${
                          activeSlot === 1
                            ? 'border-yellow-500/50 shadow-md shadow-yellow-500/5 bg-slate-900/10'
                            : 'border-transparent'
                        }`}
                        onClick={() => setActiveSlot(1)}
                      >
                        {useCanvas2d ? (
                          <ChartContainer2
                            symbol={slot1.symbol}
                            market={slot1.market}
                            timeframe={slot1.timeframe}
                            chartIndex={1}
                            mode={slot1.candleMode}
                            volumeMode={slot1.volumeMode}
                            compression={slot1.compression}
                            palette={slot1.palette}
                            layoutMode={layoutMode}
                            indicators={indicators}
                            activeIndicators={activeIndicators}
                            onToggleIndicator={onToggleIndicator}
                            onToggleVisibility={onToggleVisibility}
                            onRemoveIndicator={onRemoveIndicator}
                            onShowIndicatorsSettings={onShowIndicatorsSettings}
                            onLayoutChange={setLayoutMode}
                          />
                        ) : (
                          <ChartPanel
                            symbol={slot1.symbol}
                            market={slot1.market}
                            timeframe={slot1.timeframe}
                            chartIndex={1}
                            mode={slot1.candleMode}
                            volumeMode={slot1.volumeMode}
                            compression={slot1.compression}
                            palette={slot1.palette}
                            onFpsChange={handleFpsChange}
                            onResolvedModeChange={handleResolvedModeChange}
                          />
                        )}
                        {activeSlot === 1 && (
                          <div className="absolute top-2 right-2.5 z-45 bg-yellow-500 text-slate-950 text-[8px] font-black uppercase px-2 py-0.5 rounded shadow-md tracking-widest leading-none select-none">
                            {language === 'RU' ? 'Активен' : language === 'KZ' ? 'Белсенді' : 'Active'}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {layoutMode === 'vertical' && (
                    <div className="absolute inset-0 flex flex-col">
                      <div
                        style={{ height: `${splitRatio * 100}%` }}
                        className={`relative w-full overflow-hidden border-2 transition-all duration-150 ${
                          activeSlot === 0
                            ? 'border-yellow-500/50 shadow-md shadow-yellow-500/5 bg-slate-900/10'
                            : 'border-transparent'
                        }`}
                        onClick={() => setActiveSlot(0)}
                      >
                        {useCanvas2d ? (
                          <ChartContainer2
                            symbol={slot0.symbol}
                            market={slot0.market}
                            timeframe={slot0.timeframe}
                            chartIndex={0}
                            mode={slot0.candleMode}
                            volumeMode={slot0.volumeMode}
                            compression={slot0.compression}
                            palette={slot0.palette}
                            layoutMode={layoutMode}
                            indicators={indicators}
                            activeIndicators={activeIndicators}
                            onToggleIndicator={onToggleIndicator}
                            onToggleVisibility={onToggleVisibility}
                            onRemoveIndicator={onRemoveIndicator}
                            onShowIndicatorsSettings={onShowIndicatorsSettings}
                            onLayoutChange={setLayoutMode}
                          />
                        ) : (
                          <ChartPanel
                            symbol={slot0.symbol}
                            market={slot0.market}
                            timeframe={slot0.timeframe}
                            chartIndex={0}
                            mode={slot0.candleMode}
                            volumeMode={slot0.volumeMode}
                            compression={slot0.compression}
                            palette={slot0.palette}
                            onFpsChange={handleFpsChange}
                            onResolvedModeChange={handleResolvedModeChange}
                          />
                        )}
                        {activeSlot === 0 && (
                          <div className="absolute top-2 right-2.5 z-45 bg-yellow-500 text-slate-950 text-[8px] font-black uppercase px-2 py-0.5 rounded shadow-md tracking-widest leading-none select-none">
                            {language === 'RU' ? 'Активен' : language === 'KZ' ? 'Белсенді' : 'Active'}
                          </div>
                        )}
                      </div>
                      <Splitter direction="vertical" onDrag={handleSplitterDrag} />
                      <div
                        style={{ height: `${(1 - splitRatio) * 100}%` }}
                        className={`relative w-full overflow-hidden border-2 transition-all duration-150 ${
                          activeSlot === 1
                            ? 'border-yellow-500/50 shadow-md shadow-yellow-500/5 bg-slate-900/10'
                            : 'border-transparent'
                        }`}
                        onClick={() => setActiveSlot(1)}
                      >
                        {useCanvas2d ? (
                          <ChartContainer2
                            symbol={slot1.symbol}
                            market={slot1.market}
                            timeframe={slot1.timeframe}
                            chartIndex={1}
                            mode={slot1.candleMode}
                            volumeMode={slot1.volumeMode}
                            compression={slot1.compression}
                            palette={slot1.palette}
                            layoutMode={layoutMode}
                            indicators={indicators}
                            activeIndicators={activeIndicators}
                            onToggleIndicator={onToggleIndicator}
                            onToggleVisibility={onToggleVisibility}
                            onRemoveIndicator={onRemoveIndicator}
                            onShowIndicatorsSettings={onShowIndicatorsSettings}
                            onLayoutChange={setLayoutMode}
                          />
                        ) : (
                          <ChartPanel
                            symbol={slot1.symbol}
                            market={slot1.market}
                            timeframe={slot1.timeframe}
                            chartIndex={1}
                            mode={slot1.candleMode}
                            volumeMode={slot1.volumeMode}
                            compression={slot1.compression}
                            palette={slot1.palette}
                            onFpsChange={handleFpsChange}
                            onResolvedModeChange={handleResolvedModeChange}
                          />
                        )}
                        {activeSlot === 1 && (
                          <div className="absolute top-2 right-2.5 z-45 bg-yellow-500 text-slate-950 text-[8px] font-black uppercase px-2 py-0.5 rounded shadow-md tracking-widest leading-none select-none">
                            {language === 'RU' ? 'Активен' : language === 'KZ' ? 'Белсенді' : 'Active'}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div
                  className={`relative flex min-h-0 flex-col transition-all duration-300 ease-in-out shrink-0 min-w-[24px] ${activeMobileTab === 'chart' ? 'hidden lg:block' : 'max-lg:flex-1 lg:shrink-0 max-lg:[&>div]:!w-full'}`}
                >
                  <DOMSidebar collapsed={domCollapsed} />
                </div>

                {/* DOMSidebar collapse chip — absolute inside chart row, overflow-hidden won't clip (chip within bounds) */}
                <button
                  onClick={toggleDomCollapsed}
                  className={`hidden lg:flex absolute top-1/2 -translate-y-1/2 z-50 items-center justify-center w-6 h-12 rounded-lg border transition-all duration-200 cursor-pointer liquid-glass-card hover:bg-white/5 border-white/5 text-white/40 hover:text-white/70 ${domCollapsed ? 'right-0' : 'right-[268px]'}`}
                  title={domCollapsed ? t('dom.expand') : t('dom.collapse')}
                >
                  {domCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
          </div>
        )}
        {currentView === 'admin' && (
          <AdminPanel onClose={() => setCurrentView('terminal')} />
        )}
        {currentView === 'profile' && (
          <UserProfile onClose={() => setCurrentView('terminal')} />
        )}
      </div>

      <IndicatorsModal
        isOpen={showIndicatorsModal}
        onClose={() => { setShowIndicatorsModal(false); setFocusIndicatorId(null) }}
        symbol={slot0.symbol}
        indicators={indicators}
        focusIndicatorId={focusIndicatorId}
        onApplyIndicators={handleApplyIndicators}
      />

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSwitchToRegister={() => { setLoginOpen(false); setRegisterOpen(true) }} />
      <RegisterModal open={registerOpen} onClose={() => setRegisterOpen(false)} onSwitchToLogin={() => { setRegisterOpen(false); setLoginOpen(true) }} />
      <RoadmapModal isOpen={isRoadmapOpen} onClose={() => setIsRoadmapOpen(false)} language={language} />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <UserSettingsProvider>
            <CandlePaletteProvider>
              <ChartControlsProvider>
                <LayoutProvider>
                  <AppShell />
                </LayoutProvider>
              </ChartControlsProvider>
            </CandlePaletteProvider>
          </UserSettingsProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
