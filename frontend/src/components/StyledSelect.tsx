import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface StyledSelectOption {
  value: string
  label: string
}

interface StyledSelectProps {
  value: string
  options: StyledSelectOption[]
  onChange: (v: string) => void
  isLight: boolean
  className?: string
}

export function StyledSelect({ value, options, onChange, isLight, className }: StyledSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const selectedOpt = options.find((o) => o.value === value)
  const triggerLabel = selectedOpt ? selectedOpt.label : value

  useEffect(() => {
    if (!open) return
    function handleDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleDocDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDocDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const triggerThemed = isLight
    ? `bg-slate-50 text-slate-900 ${open ? 'border-emerald-500' : 'border-slate-200'}`
    : `bg-white/[0.03] text-white ${open ? 'border-emerald-500' : 'border-white/10'}`

  const popoverThemed = isLight
    ? 'bg-white border border-slate-200 text-slate-900 shadow-2xl'
    : 'muddy-glass-popover text-slate-100'

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-mono cursor-pointer select-none transition-colors ${triggerThemed}`}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
            isLight ? 'text-slate-500' : 'text-slate-400'
          } ${open ? 'rotate-180' : ''}`}
        />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className={`absolute left-0 right-0 mt-1.5 z-[9999] rounded-xl p-1.5 max-h-60 overflow-y-auto ${popoverThemed}`}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value
              const itemThemed = isSelected
                ? isLight
                  ? 'bg-slate-100 text-slate-900 font-bold'
                  : 'bg-white/5 text-white font-bold'
                : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`flex items-center justify-between gap-2 w-full px-3 py-1.5 rounded-lg text-left text-xs font-mono cursor-pointer transition-all ${itemThemed}`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check className="w-3 text-amber-500 shrink-0" />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default StyledSelect
