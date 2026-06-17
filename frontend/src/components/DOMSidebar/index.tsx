import { useChartControls } from '@/contexts/ChartControlsContext'
import { useDOM } from '@/hooks/useDOM'
import { FearGreedPanel } from './FearGreedPanel'
import { OrderBookTable } from './OrderBookTable'
import { useTranslation } from '@/i18n'

interface DOMSidebarProps {
  collapsed: boolean
}

export function DOMSidebar({ collapsed }: DOMSidebarProps) {
  const { t } = useTranslation()
  const { getSlot, activeSlot } = useChartControls()
  const slot = getSlot(activeSlot)

  const { levels, lastPrice, fng, connected } = useDOM({
    symbol: slot.symbol,
    market: slot.market,
  })

  return (
    <>
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
