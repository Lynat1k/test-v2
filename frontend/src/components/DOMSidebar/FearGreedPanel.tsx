import type { FNGData } from '@/types/dom'
import { useTranslation } from '@/i18n'

interface FearGreedPanelProps {
  data: FNGData | null
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  'Extreme Fear': '#ef4444',
  'Fear': '#f97316',
  'Neutral': '#eab308',
  'Greed': '#22c55e',
  'Extreme Greed': '#10b981',
}

export function FearGreedPanel({ data }: FearGreedPanelProps) {
  const { t } = useTranslation()

  if (!data) {
    return (
      <div className="p-3 liquid-glass-card rounded-lg">
        <div className="text-xs text-white/40 font-mono">{t('fng.loading')}</div>
      </div>
    )
  }

  const value = parseInt(data.value, 10) || 0
  const color = CLASSIFICATION_COLORS[data.classification] || '#9ca3af'
  const pct = Math.min(100, Math.max(0, value))

  return (
    <div className="p-3 liquid-glass-card rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-white/60 uppercase tracking-wider">{t('fng.title')}</span>
        <span className="text-lg font-display font-bold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-1.5">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-[10px] font-mono text-center" style={{ color }}>
        {data.classification}
      </div>
    </div>
  )
}
