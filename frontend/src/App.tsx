import { useState } from 'react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { I18nProvider } from '@/i18n'
import { CandlePaletteProvider } from '@/contexts/CandlePaletteContext'
import { ChartContainer } from '@/components/ChartContainer'
import { useAuth } from '@/features/auth/useAuth'
import { useIndicators } from '@/features/indicators/useIndicators'
import { useChartConfig } from '@/features/terminal/useChartConfig'
import { useWorkspace } from '@/features/terminal/useWorkspace'

type View = 'terminal' | 'admin' | 'profile'

function AppShell() {
  const { userRole } = useAuth()
  useIndicators()
  useChartConfig()
  useWorkspace()
  const [currentView, setCurrentView] = useState<View>('terminal')
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false)
  const [showRoadmapModal, setShowRoadmapModal] = useState(false)

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-black text-white">
      {/* Header placeholder - will be replaced in Step 10 */}
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
          <div className="flex-1 flex h-full">
            {/* Left panel placeholder for drawing tools */}
            <div className="w-12 bg-gray-900 border-r border-gray-700 flex flex-col items-center py-2 gap-2">
              {/* TODO: Drawing tools will be implemented in Phase 7 */}
              <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
                🖊
              </div>
              <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
                📏
              </div>
              <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
                🔲
              </div>
            </div>

            {/* Chart area */}
            <div className="flex-1 relative">
              <ChartContainer
                symbol="BTCUSDT"
                market="futures"
                timeframe="1m"
                chartIndex={0}
              />
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

      {/* Modals placeholder */}
      {showIndicatorsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowIndicatorsModal(false)}>
          <div className="liquid-glass-card rounded-xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <p>Indicators Modal - placeholder</p>
            <button className="liquid-glass-button mt-4 px-4 py-2 rounded text-xs" onClick={() => setShowIndicatorsModal(false)}>Close</button>
          </div>
        </div>
      )}
      {showRoadmapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowRoadmapModal(false)}>
          <div className="liquid-glass-card rounded-xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <p>Roadmap Modal - placeholder</p>
            <button className="liquid-glass-button mt-4 px-4 py-2 rounded text-xs" onClick={() => setShowRoadmapModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <CandlePaletteProvider>
          <AppShell />
        </CandlePaletteProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
