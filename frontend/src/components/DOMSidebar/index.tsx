import { useState, useEffect } from 'react'
import { useChartControls } from '@/contexts/ChartControlsContext'
import { useDOM } from '@/hooks/useDOM'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { FearGreedPanel } from './FearGreedPanel'
import { OrderBookTable } from './OrderBookTable'
import { useTranslation } from '@/i18n'

const STORAGE_KEY = 'procluster_dom_collapsed'

export function DOMSidebar() {
  const { t } = useTranslation()
  const { getSlot, activeSlot } = useChartControls()
  const slot = getSlot(activeSlot)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const { levels, lastPrice, fng, connected } = useDOM({
    symbol: slot.symbol,
    market: slot.market,
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed))
    } catch {
      // ignore
    }
  }, [collapsed])

  return (
    <>
      {/* Collapse button — always on desktop, absolute within DOM wrapper (App.tsx:502) */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="hidden lg:flex absolute top-1/2 -translate-y-1/2 -left-3 z-50 items-center justify-center w-6 h-12 rounded-lg border transition-all duration-200 cursor-pointer liquid-glass-card hover:bg-white/5 border-white/5 text-white/40 hover:text-white/70"
        title={collapsed ? t('dom.expand') : t('dom.collapse')}
      >
        {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Card content — hidden when collapsed */}
      {!collapsed && (
        <div className="w-[280px] h-full flex flex-col rounded-2xl p-4 shadow-2xl liquid-glass-card">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/5">
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
              {t('terminal.dom')}
            </span>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            </div>
          </div>

          <div className="shrink-0">
            <FearGreedPanel data={fng} />
          </div>

          <div className="flex-1 min-h-0">
            <OrderBookTable levels={levels} lastPrice={lastPrice} />
          </div>
        </div>
      )}
    </>
  )
}
