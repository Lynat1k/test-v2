import { useRef, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { useChartControls } from '@/contexts/ChartControlsContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useUserSettings } from '@/contexts/UserSettingsContext'
import { useDOM } from '@/hooks/useDOM'
import { useAuthContext } from '@/features/auth/AuthContext'
import { useTranslation } from '@/i18n'
import { FearGreedPanel } from './FearGreedPanel'
import { OrderBookTable } from './OrderBookTable'
import { buildDOMCompressionLevels, getDomBaseStep, aggregateDOMLevels } from './domCompression'

interface DOMSidebarProps {
  collapsed: boolean
}

const DOM_COMPRESSION_KEY = 'dom_compression_level'

export function DOMSidebar({ collapsed }: DOMSidebarProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const { getSlot, activeSlot, getTickerConfig } = useChartControls()
  const slot = getSlot(activeSlot)
  const { getSetting, setSetting } = useUserSettings()
  const { accessToken } = useAuthContext()

  const compressionIdx = getSetting<number>(DOM_COMPRESSION_KEY, 0)
  const tickerConfig = getTickerConfig()
  const baseStep = getDomBaseStep(tickerConfig, slot.market)
  const compressionLevels = buildDOMCompressionLevels(baseStep)
  const activeStep = compressionLevels[compressionIdx] ?? baseStep

  const { levels, lastPrice, fng, connected } = useDOM({
    symbol: slot.symbol,
    market: slot.market,
    accessToken,
  })

  // Apply client-side aggregation only when a non-base level is selected.
  const displayLevels = compressionIdx === 0
    ? levels
    : aggregateDOMLevels(levels, activeStep)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [dropdownOpen])

  function formatStep(step: number): string {
    return `$${parseFloat(step.toPrecision(8))}`
  }

  return (
    <>
      {!collapsed && (
        <div className={`w-[280px] h-full flex flex-col rounded-2xl p-4 shadow-2xl ${isLight ? 'bg-white border border-slate-200' : 'liquid-glass-card'}`}>
          {/* Top bar: label + WS dot */}
          <div className={`flex items-center justify-between px-2 py-1.5 border-b mb-2 ${isLight ? 'border-slate-200' : 'border-white/5'}`}>
            <span className={`text-[10px] font-mono uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-white/40'}`}>
              {t('terminal.dom')}
            </span>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          </div>

          <div className="shrink-0">
            <FearGreedPanel data={fng} />
          </div>

          {/* Section header: "СТАКАН" title + compression selector.
              relative z-[50] creates a stacking context above OrderBookTable (z-auto),
              so the absolute dropdown renders on top and captures pointer events. */}
          <div className="relative z-[50] flex items-center justify-between mt-2.5 mb-1 select-none px-1 shrink-0">
            <span className={`text-[10px] font-extrabold uppercase tracking-widest font-mono ${isLight ? 'text-slate-600' : 'text-amber-500/90'}`}>
              {t('terminal.dom')}
            </span>

            <div className="relative flex items-center gap-1.5" ref={dropdownRef}>
              <span className={`text-[8.5px] uppercase font-bold font-mono tracking-wide ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                {t('chart.compression')}:
              </span>
              <button
                onClick={() => setDropdownOpen(v => !v)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg liquid-glass-button text-xs font-bold cursor-pointer select-none"
              >
                <span className="font-mono text-[10px] text-slate-300">
                  {formatStep(activeStep)}
                </span>
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.12 }}
                    className={`absolute right-0 top-full mt-1 z-[99999] rounded-xl p-1.5 min-w-[120px] shadow-2xl ${
                      isLight
                        ? 'bg-white border border-slate-300 text-slate-900'
                        : 'bg-[#0d111d] border border-white/10 text-slate-100'
                    }`}
                  >
                    {compressionLevels.map((step, idx) => (
                      <button
                        key={step}
                        onClick={() => {
                          setSetting(DOM_COMPRESSION_KEY, idx)
                          setDropdownOpen(false)
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-left transition ${
                          compressionIdx === idx
                            ? 'bg-amber-500/15 text-amber-400'
                            : isLight
                              ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer'
                              : 'text-slate-300 hover:bg-white/5 hover:text-white cursor-pointer'
                        }`}
                      >
                        <span className="font-mono text-[11px]">{formatStep(step)}</span>
                        {idx === 0 && (
                          <span className="text-[9px] text-amber-500/70 ml-1">base</span>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <OrderBookTable levels={displayLevels} lastPrice={lastPrice} />
          </div>
        </div>
      )}
    </>
  )
}
