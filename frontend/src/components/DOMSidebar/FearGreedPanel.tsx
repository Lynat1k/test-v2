import { useTheme } from '@/contexts/ThemeContext'
import type { FNGData } from '@/types/dom'

interface FearGreedPanelProps {
  data: FNGData | null
}

function sentimentLabel(val: number): string {
  if (val <= 25) return 'Ext. Fear'
  if (val <= 45) return 'Fear'
  if (val <= 54) return 'Neutral'
  if (val <= 75) return 'Greed'
  return 'Ext. Greed'
}

function sentimentColor(val: number): string {
  if (val <= 25) return '#f43f5e'
  if (val <= 45) return '#f97316'
  if (val <= 54) return '#eab308'
  if (val <= 75) return '#10b981'
  return '#22d3ee'
}

export function FearGreedPanel({ data }: FearGreedPanelProps) {
  const { theme } = useTheme()
  const isLight = theme === 'light'

  if (!data) {
    return (
      <div className={`rounded-xl p-2 border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0c101b] border-white/5'}`}>
        <div className={`text-[10px] font-mono ${isLight ? 'text-slate-400' : 'text-white/40'}`}>Loading F&G...</div>
      </div>
    )
  }

  const value = parseInt(data.value, 10) || 0
  const color = sentimentColor(value)
  const label = sentimentLabel(value)

  const angle = -180 + (value / 100) * 180
  const rad = (angle * Math.PI) / 180
  const badgeX = 75 + 55 * Math.cos(rad)
  const badgeY = 80 + 55 * Math.sin(rad)

  const updatedDate = data.timestamp
    ? new Date(data.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className={`rounded-xl p-2 border shadow-inner ${
      isLight ? 'bg-slate-50 border-slate-200 text-slate-900' : 'bg-[#0c101b] border-white/5 text-slate-100'
    }`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-5 h-5 rounded-full bg-[#f7931a] flex items-center justify-center shadow-sm shrink-0">
          <span className="text-white font-extrabold text-[11px] italic transform -skew-x-6 select-none">₿</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`text-[13px] font-bold tracking-tight leading-none ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>
            Fear & Greed Index
          </h3>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2.5 py-0.5">
        <div className="flex flex-col justify-center shrink-0">
          <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">
            Now:
          </span>
          <span
            className="text-[13px] font-black tracking-tight mt-0.5 leading-none drop-shadow-sm"
            style={{ color }}
          >
            {label}
          </span>
          <span className="text-[10px] font-semibold mt-1.5 text-slate-400">
            Score: <span className="font-extrabold">{value}</span>
          </span>
        </div>

        <div className="flex-1 flex justify-center items-center">
          <svg viewBox="0 0 150 90" className="w-full max-w-[105px] overflow-visible select-none">
            <defs>
              <linearGradient id="fng-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#e15241" />
                <stop offset="25%" stopColor="#f0af43" />
                <stop offset="50%" stopColor="#e3cb41" />
                <stop offset="75%" stopColor="#69cc63" />
                <stop offset="100%" stopColor="#4abb50" />
              </linearGradient>
              <filter id="fng-badge-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodOpacity="0.5" />
              </filter>
            </defs>

            <path
              d="M 20,80 A 55,55 0 0,1 130,80"
              fill="none"
              stroke="rgba(255, 255, 255, 0.05)"
              strokeWidth="9.5"
              strokeLinecap="round"
            />

            <path
              d="M 20,80 A 55,55 0 0,1 130,80"
              fill="none"
              stroke="url(#fng-gradient)"
              strokeWidth="9"
              strokeLinecap="round"
            />

            <g transform={`rotate(${angle}, 75, 80)`}>
              <path
                d="M 75,76.5 L 122,80 L 75,83.5 Z"
                fill="#94a3b8"
                stroke="#0d111d"
                strokeWidth="0.8"
              />
              <circle cx="75" cy="80" r="10.5" fill="#1e293b" stroke="#475569" strokeWidth="1" />
              <circle cx="75" cy="80" r="7" fill="#f7931a" />
              <text
                x="75"
                y="80"
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-white font-extrabold text-[8px] italic"
                style={{ transform: 'skewX(-10deg)' }}
              >
                ₿
              </text>
            </g>

            <g filter="url(#fng-badge-glow)">
              <circle cx={badgeX} cy={badgeY} r="10.5" fill={color} stroke="#ffffff" strokeWidth="1.8" />
              <text
                x={badgeX}
                y={badgeY}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-white font-mono font-black text-[9px]"
              >
                {value}
              </text>
            </g>
          </svg>
        </div>
      </div>

      <div className="flex justify-between items-center text-[7.5px] font-mono select-none mt-1.5 opacity-60">
        <span>alternative.me</span>
        <span>Updated: {updatedDate}</span>
      </div>
    </div>
  )
}
