import { useState, useCallback, useRef } from 'react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { I18nProvider } from '@/i18n'
import { CandlePaletteProvider } from '@/contexts/CandlePaletteContext'
import { ChartControlsProvider, useChartControls } from '@/contexts/ChartControlsContext'
import { LayoutProvider, useLayout } from '@/contexts/LayoutContext'
import { ChartContainer } from '@/components/ChartContainer'
import { ChartPanel } from '@/components/ChartPanel'
import { ChartHeader } from '@/components/ChartHeader'
import { Splitter } from '@/components/Splitter'
import { useAuth } from '@/features/auth/useAuth'
import type { CandleMode } from '@/chart-engine'
import { AnimatePresence, motion } from 'motion/react'

type View = 'terminal' | 'admin' | 'profile'

function AppShell() {
  const { userRole } = useAuth()
  const { showIndicatorsModal, setShowIndicatorsModal, getSlot, activeSlot, setActiveSlot } = useChartControls()
  const { layoutMode, splitRatio, setSplitRatio } = useLayout()
  const [currentView, setCurrentView] = useState<View>('terminal')
  const [fps, setFps] = useState(0)
  const handleFpsChange = useCallback((f: number) => setFps(f), [])
  const handleResolvedModeChange = useCallback((_m: Exclude<CandleMode, 'auto'>) => {}, [])

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

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-black text-white">
      {/* Main app header */}
      <header className="h-12 flex items-center px-4 liquid-glass-card border-b border-white/5 shrink-0">
        <span className="font-display font-bold text-lg tracking-tight">PROCLUSTER</span>
        <span className="ml-2 text-[10px] font-mono text-amber-400/70 border border-amber-400/30 rounded px-1.5 py-0.5">BETA</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="liquid-glass-button px-3 py-1 rounded text-xs"
            onClick={() => setCurrentView('terminal')}
          >
            Terminal
          </button>
          {userRole === 'Admin' && (
            <button
              className="liquid-glass-button px-3 py-1 rounded text-xs"
              onClick={() => setCurrentView('admin')}
            >
              Admin
            </button>
          )}
          <button
            className="liquid-glass-button px-3 py-1 rounded text-xs"
            onClick={() => setCurrentView('profile')}
          >
            Profile
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {currentView === 'terminal' && (
          <div className="flex-1 flex flex-col h-full">
            {/* Chart header controls */}
            <ChartHeader fps={fps} />

            {/* Chart area */}
            <div ref={chartAreaRef} className="flex-1 relative overflow-hidden">
              {layoutMode === 'single' && (
                <div className="absolute inset-0">
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
                </div>
              )}

              {layoutMode === 'horizontal' && (
                <div className="absolute inset-0 flex">
                  <div
                    style={{ width: `${splitRatio * 100}%` }}
                    className={`h-full overflow-hidden ${activeSlot === 0 ? 'ring-1 ring-amber-500/40' : ''}`}
                    onClick={() => setActiveSlot(0)}
                  >
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
                  </div>
                  <Splitter direction="horizontal" onDrag={handleSplitterDrag} />
                  <div
                    style={{ width: `${(1 - splitRatio) * 100}%` }}
                    className={`h-full overflow-hidden ${activeSlot === 1 ? 'ring-1 ring-amber-500/40' : ''}`}
                    onClick={() => setActiveSlot(1)}
                  >
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
                  </div>
                </div>
              )}

              {layoutMode === 'vertical' && (
                <div className="absolute inset-0 flex flex-col">
                  <div
                    style={{ height: `${splitRatio * 100}%` }}
                    className={`w-full overflow-hidden ${activeSlot === 0 ? 'ring-1 ring-amber-500/40' : ''}`}
                    onClick={() => setActiveSlot(0)}
                  >
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
                  </div>
                  <Splitter direction="vertical" onDrag={handleSplitterDrag} />
                  <div
                    style={{ height: `${(1 - splitRatio) * 100}%` }}
                    className={`w-full overflow-hidden ${activeSlot === 1 ? 'ring-1 ring-amber-500/40' : ''}`}
                    onClick={() => setActiveSlot(1)}
                  >
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
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {currentView === 'admin' && (
          <div className="h-full flex items-center justify-center text-white/40 font-mono text-sm">
            <p>Admin Panel - placeholder</p>
          </div>
        )}
        {currentView === 'profile' && (
          <div className="h-full flex items-center justify-center text-white/40 font-mono text-sm">
            <p>User Profile - placeholder</p>
          </div>
        )}
      </div>

      {/* Indicators Modal */}
      <AnimatePresence>
        {showIndicatorsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowIndicatorsModal(false)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="liquid-glass-card rounded-2xl p-6 w-96 muddy-glass-popover"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-white mb-3">Indicators</h3>
              <p className="text-xs text-slate-400">Indicators modal — фаза 11 (Cluster Search, логика не трогается)</p>
              <button
                className="liquid-glass-button mt-4 px-4 py-2 rounded-lg text-xs font-bold text-white cursor-pointer"
                onClick={() => setShowIndicatorsModal(false)}
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <CandlePaletteProvider>
          <ChartControlsProvider>
            <LayoutProvider>
              <AppShell />
            </LayoutProvider>
          </ChartControlsProvider>
        </CandlePaletteProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
