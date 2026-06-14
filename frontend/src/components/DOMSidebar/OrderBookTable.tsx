import { useRef, useEffect, useState, useCallback } from 'react'
import type { DOMLevel } from '@/types/dom'
import { useTranslation } from '@/i18n'

interface OrderBookTableProps {
  levels: DOMLevel[]
  lastPrice: number
}

export function OrderBookTable({ levels, lastPrice }: OrderBookTableProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoCenter, setAutoCenter] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const maxVolume = Math.max(
    ...levels.map((l) => Math.max(l.bidSize, l.askSize)),
    0.001,
  )

  const resetAutoCenter = useCallback(() => {
    setAutoCenter(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setAutoCenter(true), 1000)
  }, [])

  useEffect(() => {
    if (autoCenter && containerRef.current && lastPrice > 0) {
      const container = containerRef.current
      const centerIdx = levels.findIndex((l) => l.priceLevel >= lastPrice)
      if (centerIdx >= 0) {
        const rowH = 24
        const scrollTarget = centerIdx * rowH - container.clientHeight / 2
        container.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' })
      }
    }
  }, [autoCenter, levels, lastPrice])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const sorted = [...levels].sort((a, b) => b.priceLevel - a.priceLevel)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-2 py-1 border-b border-white/5">
        <span className="flex-1 text-[10px] font-mono text-green-400">{t('dom.bidSize')}</span>
        <span className="flex-1 text-[10px] font-mono text-white/60 text-center">{t('dom.price')}</span>
        <span className="flex-1 text-[10px] font-mono text-red-400 text-right">{t('dom.askSize')}</span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto scrollbar-thin-dark"
        onScroll={resetAutoCenter}
      >
        {sorted.map((level, i) => {
          const isCurrentPrice = Math.abs(level.priceLevel - lastPrice) < 0.01
          const bidPct = maxVolume > 0 ? (level.bidSize / maxVolume) * 100 : 0
          const askPct = maxVolume > 0 ? (level.askSize / maxVolume) * 100 : 0

          return (
            <div
              key={`${level.priceLevel}-${i}`}
              className={`flex items-center h-6 px-2 relative ${
                isCurrentPrice ? 'bg-amber-500/10 border-y border-amber-500/30' : ''
              }`}
            >
              {level.bidSize > 0 && (
                <div
                  className="absolute left-0 top-0 h-full bg-green-500/10"
                  style={{ width: `${bidPct}%` }}
                />
              )}
              {level.askSize > 0 && (
                <div
                  className="absolute right-0 top-0 h-full bg-red-500/10"
                  style={{ width: `${askPct}%` }}
                />
              )}

              <span className="flex-1 text-[11px] font-mono text-green-400 relative z-10">
                {level.bidSize > 0 ? level.bidSize.toFixed(1) : ''}
              </span>
              <span
                className={`flex-1 text-[11px] font-mono text-center relative z-10 ${
                  isCurrentPrice ? 'text-amber-400 font-bold' : 'text-white/70'
                }`}
              >
                {level.priceLevel.toFixed(1)}
              </span>
              <span className="flex-1 text-[11px] font-mono text-red-400 text-right relative z-10">
                {level.askSize > 0 ? level.askSize.toFixed(1) : ''}
              </span>
            </div>
          )
        })}

        {levels.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-white/30 font-mono">
            {t('dom.noData')}
          </div>
        )}
      </div>
    </div>
  )
}
