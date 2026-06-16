import { useState, useEffect } from 'react'
import { useChartControls } from '@/contexts/ChartControlsContext'
import { useDOM } from '@/hooks/useDOM'
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

  if (collapsed) {
    return (
      <div className="w-6 shrink-0 relative">
        <button
          onClick={() => setCollapsed(false)}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-6 h-14 flex items-center justify-center liquid-glass-card hover:bg-white/5 transition-colors z-10 rounded-r-xl border-l-0 border-white/5 cursor-pointer"
          title={t('dom.expand')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" className="text-white/40">
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="w-[264px] h-full flex flex-col border-l border-white/5 liquid-glass-card shrink-0">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCollapsed(true)}
            className="text-white/40 hover:text-white/70 transition-colors"
            title={t('dom.collapse')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
            {t('terminal.dom')}
          </span>
        </div>
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
  )
}
