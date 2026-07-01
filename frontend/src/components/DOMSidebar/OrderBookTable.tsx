import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import type { DOMLevel } from '@/types/dom'

interface OrderBookTableProps {
  levels: DOMLevel[]
  lastPrice: number
}

export function OrderBookTable({ levels, lastPrice }: OrderBookTableProps) {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoCenter, setAutoCenter] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const asks = useMemo(() => {
    return levels
      .filter((l) => l.askSize > 0)
      .sort((a, b) => b.priceLevel - a.priceLevel)
  }, [levels])

  const bids = useMemo(() => {
    return levels
      .filter((l) => l.bidSize > 0)
      .sort((a, b) => b.priceLevel - a.priceLevel)
  }, [levels])

  const maxVolume = useMemo(() => {
    let max = 0.001
    for (const l of levels) {
      if (l.askSize > max) max = l.askSize
      if (l.bidSize > max) max = l.bidSize
    }
    return max
  }, [levels])

  const resetAutoCenter = useCallback(() => {
    setAutoCenter(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setAutoCenter(true), 1000)
  }, [])

  useEffect(() => {
    if (autoCenter && containerRef.current && lastPrice > 0) {
      const container = containerRef.current
      const asksCount = asks.length
      const midElementCenter = asksCount * 18 + 28
      const visibleHeight = container.clientHeight
      if (visibleHeight <= 0) return
      const midPoint = midElementCenter - visibleHeight / 2
      container.scrollTo({ top: Math.max(0, midPoint), behavior: 'smooth' })
    }
  }, [autoCenter, asks.length, lastPrice, levels])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const priceFmt = (p: number) =>
    p.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })

  return (
    <div id="dom-ladder-container" className={`flex flex-col h-full rounded-xl border overflow-hidden ${
      isLight ? 'bg-white/90 border-slate-200' : 'bg-[#06080e]/90 border-white/5'
    }`}>
      {/* Header */}
      <div id="dom-table-header" className={`grid grid-cols-[1fr_1.2fr] gap-3 border-b py-1.5 px-2 text-[8.5px] font-mono font-black uppercase tracking-widest shrink-0 ${
        isLight ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-slate-950 border-white/5 text-slate-500'
      }`}>
        <div className="text-right pr-2">Size</div>
        <div className="text-left pl-1">Price (USDT)</div>
      </div>

      <div
        ref={containerRef}
        className={`flex-1 overflow-y-auto ${isLight ? 'scrollbar-thin-light' : 'scrollbar-thin-dark'}`}
        onScroll={resetAutoCenter}
      >
        {/* --- ASKS (high → low) --- */}
        {asks.map((level) => {
          const ratio = level.askSize / maxVolume
          const bgOpacity = 0.03 + Math.pow(ratio, 1.3) * 0.72
          const isWall = ratio > 0.45

          return (
            <div
              key={`ask-${level.priceLevel}`}
              className="grid grid-cols-[1fr_1.2fr] gap-3 font-mono text-[10.5px] relative h-[18px] items-center px-2"
            >
              <div
                className="absolute left-0 top-0 bottom-0 pointer-events-none"
                style={{
                  width: `${Math.min(100, ratio * 100)}%`,
                  backgroundColor: `rgba(244, 63, 94, ${bgOpacity})`,
                }}
              />
              <div
                className={`text-right pr-2 z-10 font-bold tracking-tight ${
                  isWall
                    ? 'text-rose-400 font-extrabold text-[11px] drop-shadow-[0_0_3px_rgba(244,63,94,0.4)]'
                    : 'text-rose-500/90'
                }`}
              >
                {Math.round(level.askSize).toLocaleString()}
              </div>
              <div
                className={`text-left pl-1 z-10 font-bold ${
                  isWall
                    ? isLight ? 'font-extrabold text-slate-800' : 'font-extrabold text-slate-200'
                    : isLight ? 'text-slate-600' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {priceFmt(level.priceLevel)}
              </div>
            </div>
          )
        })}

        {/* --- MID ROW / LAST PRICE --- */}
        <div id="dom-mid-price-row" className={`flex justify-center items-center border-y border-amber-500/25 relative z-20 shrink-0 h-14 ${isLight ? 'bg-slate-100' : 'bg-[#090b11]'}`}>
          <div
            className="font-mono text-[30px] font-black tracking-widest leading-none text-center select-all text-amber-500"
            style={{
              textShadow: '0 0 10px rgba(245, 158, 11, 0.95), 0 0 22px rgba(245, 158, 11, 0.65)',
              fontWeight: 900,
            }}
          >
            {lastPrice > 0 ? priceFmt(lastPrice) : '—'}
          </div>
        </div>

        {/* --- BIDS (high → low) --- */}
        {bids.map((level) => {
          const ratio = level.bidSize / maxVolume
          const bgOpacity = 0.03 + Math.pow(ratio, 1.3) * 0.72
          const isWall = ratio > 0.45

          return (
            <div
              key={`bid-${level.priceLevel}`}
              className="grid grid-cols-[1fr_1.2fr] gap-3 font-mono text-[10.5px] relative h-[18px] items-center px-2"
            >
              <div
                className="absolute left-0 top-0 bottom-0 pointer-events-none"
                style={{
                  width: `${Math.min(100, ratio * 100)}%`,
                  backgroundColor: `rgba(16, 185, 129, ${bgOpacity})`,
                }}
              />
              <div
                className={`text-right pr-2 z-10 font-bold tracking-tight ${
                  isWall
                    ? 'text-emerald-400 font-extrabold text-[11px] drop-shadow-[0_0_3px_rgba(16,185,129,0.4)]'
                    : 'text-emerald-500/90'
                }`}
              >
                {Math.round(level.bidSize).toLocaleString()}
              </div>
              <div
                className={`text-left pl-1 z-10 font-bold ${
                  isWall
                    ? isLight ? 'font-extrabold text-slate-800' : 'font-extrabold text-slate-200'
                    : isLight ? 'text-slate-600' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {priceFmt(level.priceLevel)}
              </div>
            </div>
          )
        })}

        {levels.length === 0 && (
          <div className={`flex items-center justify-center h-20 text-xs font-mono ${isLight ? 'text-slate-400' : 'text-white/30'}`}>
            Waiting for data...
          </div>
        )}
      </div>
    </div>
  )
}
