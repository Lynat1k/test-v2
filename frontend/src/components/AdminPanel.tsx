import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useTranslation } from '@/i18n'
import { useAuthContext } from '@/features/auth/AuthContext'
import { apiUpdateBetaMode } from '@/features/auth/api'
import { motion, AnimatePresence } from 'motion/react'
import {
  ArrowLeft,
  Settings,
  Cpu,
  Database,
  Users,
  BarChart2,
  Activity,
  Plus,
  Trash2,
  Pencil,
  Save,
  X,
  Download,
  RefreshCw,
} from 'lucide-react'
import { apiGetMetrics, apiGetMetricsHistory, apiGetTickers, apiAddTicker, apiUpdateTicker, apiDeleteTicker, apiGetCompressions, apiUpsertCompressions, apiStartDownload, apiGetJobs, apiClearJobs, apiGetUserStats, apiListUsers, apiCreateUser, apiUpdateUserRole, apiDeleteUser, apiGetPolicies, apiUpdatePolicies, apiListIndicatorDefaults, apiPutIndicatorDefaults, apiDeleteIndicatorDefaults, type ServerMetrics, type MetricsHistoryPoint, type Ticker, type DefaultCompression, type DownloadJob, type UserListItem, type UserStats, type TierPolicy, type AdminIndicatorDefault } from '@/features/admin/api'
import { useChartControls } from '@/contexts/ChartControlsContext'
import { useIndicatorsStorage } from '@/features/indicators/IndicatorsStorageContext'

type AdminTab = 'server' | 'database' | 'users' | 'settings' | 'stats'

interface AdminPanelProps {
  onClose: () => void
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { user } = useAuthContext()
  const isLight = theme === 'light'
  const [activeTab, setActiveTab] = useState<AdminTab>('server')

  if (user?.role !== 'admin') {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40 font-mono text-sm">
        <p>Access denied — admin only</p>
      </div>
    )
  }

  const tabs: { key: AdminTab; label: string; icon: typeof Cpu; color: string }[] = [
    { key: 'server', label: t('admin.tabs.server'), icon: Cpu, color: 'blue' },
    { key: 'database', label: t('admin.tabs.database'), icon: Database, color: 'emerald' },
    { key: 'users', label: t('admin.tabs.users'), icon: Users, color: 'amber' },
    { key: 'settings', label: t('admin.tabs.settings') || 'Настройки', icon: Settings, color: 'indigo' },
    { key: 'stats', label: t('admin.tabs.stats'), icon: BarChart2, color: 'purple' },
  ]

  return (
    <div className={`admin-panel-root flex-1 flex flex-col min-h-0 relative z-40 ${activeTab === 'server' ? 'overflow-hidden' : 'overflow-y-auto'} p-6 gap-6 font-sans select-none ${
      isLight ? 'bg-slate-50 text-slate-900' : 'bg-[#060813] text-slate-100'
    }`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-500/10 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border cursor-pointer hover:scale-102 active:scale-98 transition ${
              isLight
                ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm'
                : 'bg-slate-900 border-white/5 text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('admin.backToTerminal')}</span>
          </button>
          <div className="h-5 w-px bg-slate-500/20 hidden sm:block" />
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-5 h-5 text-red-500 animate-spin" />
              {t('admin.title')}
            </h1>
            <span className={`text-[9px] px-2 py-0.5 rounded-md font-mono font-black ${
              isLight ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-red-500/10 text-red-400 border border-red-500/15'
            }`}>
              {t('admin.coreMode')}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-500/15 gap-2 pb-px shrink-0">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key
          const activeBg = isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
          const inactiveText = isLight ? 'text-slate-600 hover:bg-slate-200/40' : 'text-slate-400 hover:bg-white/[0.02]'
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2.5 rounded-t-xl text-xs font-bold tracking-wider uppercase flex items-center gap-2 border-t-2 border-x transition-all duration-150 cursor-pointer ${
                isActive
                  ? `${activeBg} border-t-${tab.color}-500 border-x-slate-200 dark:border-x-white/5 shadow-sm`
                  : `${inactiveText} border-t-transparent border-x-transparent`
              }`}
            >
              <tab.icon className={`w-4 h-4 text-${tab.color}-500`} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.15 }}
          className="flex-1 flex flex-col gap-6 min-h-0"
        >
          {activeTab === 'server' && <ServerTab isLight={isLight} />}
          {activeTab === 'database' && <DatabaseTab isLight={isLight} />}
          {activeTab === 'users' && <UsersTab isLight={isLight} />}
          {activeTab === 'settings' && <SettingsTab isLight={isLight} />}
          {activeTab === 'stats' && <StatsTabPlaceholder isLight={isLight} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// --- Server Tab (real metrics + polling) ---

function ServerTab({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation()
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null)
  const [history, setHistory] = useState<MetricsHistoryPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await apiGetMetrics()
      setMetrics(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch metrics')
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const data = await apiGetMetricsHistory()
      setHistory(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchMetrics()
    fetchHistory()
    const metricsInterval = setInterval(fetchMetrics, 3000)
    const historyInterval = setInterval(fetchHistory, 30000)
    return () => {
      clearInterval(metricsInterval)
      clearInterval(historyInterval)
    }
  }, [fetchMetrics, fetchHistory])

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [metrics?.logs])

  if (error && !metrics) {
    return (
      <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'}`}>
        <p className="text-red-500 text-sm font-mono">{t('admin.server.fetchError')}: {error}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      {/* TOP: Resource Monitoring Cards */}
      <div className={`flex-[7] min-h-0 p-5 rounded-2xl border flex flex-col gap-3 ${
        isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'
      }`}>
        <div className="flex items-center gap-2 text-xs font-bold font-mono text-slate-400 uppercase shrink-0">
          <Cpu className="w-4 h-4 animate-pulse" />
          {t('admin.server.resourceMonitoring')}
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 min-h-0">
          <MetricCard
            isLight={isLight}
            label={t('admin.server.cpu')}
            value={metrics ? `${metrics.cpu.usagePercent.toFixed(1)}%` : '---'}
            sub={metrics ? `${metrics.cpu.usagePercent.toFixed(1)}% ${t('admin.server.load')}` : ''}
            percent={metrics?.cpu.usagePercent ?? 0}
            color="amber"
            historyData={history.map(h => h.cpuPercent)}
            historyTimestamps={history.map(h => h.timestamp)}
          />
          <MetricCard
            isLight={isLight}
            label={t('admin.server.ram')}
            value={metrics ? `${metrics.ram.percent.toFixed(1)}%` : '---'}
            sub={metrics ? `${metrics.ram.usedGB.toFixed(1)} / ${metrics.ram.totalGB.toFixed(1)} GB` : ''}
            percent={metrics?.ram.percent ?? 0}
            color="emerald"
            historyData={history.map(h => h.ramPercent)}
            historyTimestamps={history.map(h => h.timestamp)}
          />
          <MetricCard
            isLight={isLight}
            label={t('admin.server.disk')}
            value={metrics ? `${metrics.disk.usagePercent.toFixed(1)}%` : '---'}
            sub={metrics ? `${metrics.disk.usedGB.toFixed(1)} / ${metrics.disk.totalGB.toFixed(1)} GB` : ''}
            percent={metrics?.disk.usagePercent ?? 0}
            color="blue"
            historyData={history.map(h => h.diskPercent)}
            historyTimestamps={history.map(h => h.timestamp)}
          />
        </div>

        {/* DB Size + Users */}
        <div className="grid grid-cols-2 gap-3 shrink-0">
          <InfoCard
            isLight={isLight}
            label={t('admin.server.database')}
            items={[
              { k: 'SQLite', v: metrics ? formatBytes(metrics.database.sqliteSizeBytes) : '---' },
              { k: 'ClickHouse', v: metrics ? formatBytes(metrics.database.clickHouseBytes) : '---' },
            ]}
          />
          <InfoCard
            isLight={isLight}
            label={t('admin.server.users')}
            items={[
              { k: t('admin.users.registered'), v: metrics?.users.registeredCount?.toString() ?? '---' },
              { k: t('admin.users.online'), v: metrics?.users.onlineCount?.toString() ?? '---' },
            ]}
          />
        </div>
      </div>

      {/* BOTTOM: Log Console */}
      <div className={`flex-[3] min-h-0 flex flex-col rounded-2xl p-5 border gap-3 ${
        isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'
      }`}>
        <div className="flex justify-between items-center text-xs shrink-0">
          <span className="font-extrabold tracking-wider font-mono text-slate-500 flex items-center gap-2 uppercase">
            <Activity className="w-4 h-4 text-slate-400 animate-pulse" />
            {t('admin.server.logs')}
          </span>
          <span className="font-mono text-[10px] bg-red-500/15 border border-red-500/15 text-red-400 px-2.5 py-0.5 rounded-full animate-pulse">
            LIVE TELEMETRY
          </span>
        </div>

        <div className={`flex-1 min-h-0 rounded-xl p-4 font-mono text-[10.5px] overflow-y-auto leading-relaxed border select-text shadow-inner ${
          isLight
            ? 'bg-slate-900 text-slate-200 border-slate-300'
            : 'bg-[#02050e] text-[#00ff66] border-white/5'
        }`}>
          <div className="flex flex-col gap-1.5">
            {metrics?.logs && metrics.logs.length > 0 ? (
              metrics.logs.map((line, i) => (
                <div key={i} className="flex gap-2.5 hover:bg-white/5 py-0.5 px-1.5 rounded transition-colors duration-100">
                  <span className="text-slate-500 shrink-0 select-none">[{i + 1}]</span>
                  <span className="whitespace-pre-wrap">{line}</span>
                </div>
              ))
            ) : (
              <div className="text-slate-500 text-center py-4">{t('admin.server.noData')}</div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono shrink-0">
          <span>{t('admin.server.liveTelemetry')}</span>
          <span>{t('admin.server.ingressCompact')}</span>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ isLight, label, value, sub, percent, color, historyData, historyTimestamps }: {
  isLight: boolean
  label: string
  value: string
  sub: string
  percent: number
  color: string
  historyData: number[]
  historyTimestamps?: string[]
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const barColor = {
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
  }[color] || 'bg-slate-500'

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch { return '' }
  }

  const hoverTime = hoveredIdx !== null && historyTimestamps?.[hoveredIdx] ? formatTime(historyTimestamps[hoveredIdx]!) : null
  const hoverValue = hoveredIdx !== null && historyData[hoveredIdx] !== undefined ? historyData[hoveredIdx] : null

  return (
    <div className={`flex-1 min-h-0 p-3 rounded-xl border flex flex-col justify-between gap-2 transition-all ${
      isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-white/[0.01] border-white/5'
    }`}>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center text-xs">
          <span className={`font-bold flex items-center gap-1.5 ${isLight ? 'text-slate-800' : 'text-white'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${color === 'amber' ? 'bg-amber-500 animate-ping' : color === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse'}`} />
            <span>{label}</span>
          </span>
          {hoverValue !== null && hoverTime !== null ? (
            <span className={`text-[9px] font-mono font-bold border px-1.5 py-0.5 rounded animate-pulse ${
              color === 'amber' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
              color === 'emerald' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
              'bg-blue-500/10 text-blue-500 border-blue-500/20'
            }`}>
              {hoverTime}: {hoverValue.toFixed(1)}%
            </span>
          ) : (
            <span className={`font-mono font-bold text-[11px] ${
              color === 'amber' ? (isLight ? 'text-amber-600' : 'text-amber-500') :
              color === 'emerald' ? (isLight ? 'text-emerald-600' : 'text-emerald-500') :
              (isLight ? 'text-blue-600' : 'text-blue-400')
            }`}>{value}</span>
          )}
        </div>

        <div className={`h-2 w-full ${isLight ? 'bg-slate-200' : 'bg-slate-900'} rounded-full overflow-hidden`}>
          <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>

        <div className={`text-[10px] ${isLight ? 'text-slate-600' : 'text-slate-400'} font-mono`}>{sub}</div>
      </div>

      {/* 24h Daily Chart */}
      <div className="flex flex-col gap-1 min-h-0 flex-1">
        <span className={`text-[9px] ${isLight ? 'text-slate-500' : 'text-slate-400'} font-mono uppercase tracking-wider`}>
          {historyData.length > 0 ? `${historyData.length} ${label} (24h)` : `${label} (24h)`}
        </span>
        <DailyChart
          data={historyData}
          {...(historyTimestamps ? { timestamps: historyTimestamps } : {})}
          color={color}
          maxVal={100}
          isLight={isLight}
          hoveredIdx={hoveredIdx}
          onHoverChange={setHoveredIdx}
        />
      </div>
    </div>
  )
}

function DailyChart({ data, timestamps, color, maxVal, isLight, hoveredIdx, onHoverChange }: {
  data: number[]
  timestamps?: string[]
  color: string
  maxVal: number
  isLight: boolean
  hoveredIdx: number | null
  onHoverChange: (idx: number | null) => void
}) {
  const width = 500
  const height = 110
  const paddingL = 10
  const paddingR = 40
  const paddingT = 8
  const paddingB = 18
  const graphW = width - paddingL - paddingR
  const graphH = height - paddingT - paddingB

  const getX = (i: number) => paddingL + (i / Math.max(data.length - 1, 1)) * graphW
  const getY = (num: number) => height - paddingB - (num / maxVal) * graphH

  const strokeColor = { amber: '#f59e0b', emerald: '#10b981', blue: '#3b82f6' }[color] || '#94a3b8'

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch { return '' }
  }

  if (data.length === 0) {
    return (
      <div className={`flex-1 w-full min-h-[95px] flex items-center justify-center text-[10px] text-slate-500 font-mono rounded-lg border border-slate-500/10 ${
        isLight ? 'bg-slate-100/90' : 'bg-black/35'
      }`}>
        Collecting data...
      </div>
    )
  }

  if (data.length === 1) {
    const y = getY(data[0]!)
    return (
      <div className={`flex-1 min-h-[95px] w-full relative rounded-lg p-1 border border-slate-500/10 ${
        isLight ? 'bg-slate-100/90' : 'bg-black/35'
      }`}>
        <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <circle cx={width / 2} cy={y} r="3" fill={strokeColor} stroke={isLight ? '#ffffff' : '#0f172a'} strokeWidth="1.5" />
        </svg>
      </div>
    )
  }

  const points = data.map((v, i) => ({ x: getX(i), y: getY(v) }))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaD = `${pathD} L ${points[points.length - 1]!.x.toFixed(1)} ${height - paddingB} L ${points[0]!.x.toFixed(1)} ${height - paddingB} Z`

  const yTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

  const xTickCount = Math.min(6, data.length)
  const xTicks = Array.from({ length: xTickCount }, (_, i) => Math.round((i / (xTickCount - 1)) * (data.length - 1)))

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(pct * (data.length - 1))))
    onHoverChange(idx)
  }

  return (
    <div className={`flex-1 min-h-[95px] w-full relative rounded-lg p-1 border border-slate-500/10 ${
      isLight ? 'bg-slate-100/90' : 'bg-black/35'
    }`}>
      {yTicks.map((tick) => (
        <div
          key={`y-${tick}`}
          style={{
            position: 'absolute',
            left: `${((width - paddingR + 5) / width) * 100}%`,
            top: `${(getY(tick) / height) * 100}%`,
            transform: 'translateY(-50%)',
          }}
          className={`text-[10px] font-mono font-bold leading-none select-none pointer-events-none ${
            isLight ? 'text-slate-500' : 'text-slate-400'
          }`}
        >
          {tick}%
        </div>
      ))}

      {xTicks.map((idx) => {
        const xPercent = (getX(idx) / width) * 100
        const alignTransform = idx === 0 ? 'none' : 'translateX(-50%)'
        return (
          <div
            key={`x-${idx}`}
            style={{
              position: 'absolute',
              left: `${xPercent}%`,
              bottom: '3px',
              transform: alignTransform,
            }}
            className={`text-[10px] font-mono font-bold leading-none select-none pointer-events-none ${
              isLight ? 'text-slate-500' : 'text-slate-400'
            }`}
          >
            {timestamps?.[idx] ? formatTime(timestamps[idx]!) : ''}
          </div>
        )
      })}

      <svg
        className="w-full h-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => onHoverChange(null)}
      >
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        <line
          x1={paddingL} y1={height - paddingB}
          x2={width - paddingR} y2={height - paddingB}
          stroke="currentColor"
          className={isLight ? 'text-slate-300' : 'text-white/[0.12]'}
        />

        <path d={areaD} fill={`url(#grad-${color})`} />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />

        {hoveredIdx !== null && (
          <g>
            <line
              x1={getX(hoveredIdx)} y1={paddingT}
              x2={getX(hoveredIdx)} y2={height - paddingB}
              stroke="#ec4899" strokeWidth="1" strokeDasharray="2 2"
            />
            <circle
              cx={getX(hoveredIdx)}
              cy={getY(data[hoveredIdx]!)}
              r="3"
              fill={strokeColor}
              stroke={isLight ? '#ffffff' : '#0f172a'}
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>
    </div>
  )
}

function InfoCard({ isLight, label, items }: {
  isLight: boolean
  label: string
  items: { k: string; v: string }[]
}) {
  return (
    <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'}`}>
      <div className="text-xs font-bold font-mono text-slate-400 uppercase mb-3">{label}</div>
      <div className="space-y-2">
        {items.map(({ k, v }) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-slate-500">{k}</span>
            <span className="font-mono font-bold">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

// --- Placeholder tabs (to be implemented in subsequent phases) ---

// --- Database Tab ---

function DatabaseTab({ isLight }: { isLight: boolean }) {
  return (
    <div className="flex-1 grid grid-cols-1 xl:grid-cols-3 gap-6 min-h-0">
      <TickerBlock isLight={isLight} />
      <CompressionBlock isLight={isLight} />
      <HistoryBlock isLight={isLight} />
    </div>
  )
}

const FUTURES_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h'] as const
const SPOT_TIMEFRAMES = ['15m', '30m', '1h', '4h'] as const

function TickerBlock({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation()
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ symbol: '', name: '', priceTickSpot: 0.01, priceTickFutures: 0.1, compressionSpot: 500, compressionFutures: 25 })
  const [editForm, setEditForm] = useState<Partial<Ticker>>({})

  const fetchTickers = useCallback(async () => {
    try {
      const data = await apiGetTickers()
      setTickers(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : JSON.stringify(e))
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchTickers() }, [fetchTickers])

  const handleAdd = async () => {
    if (!form.symbol.trim()) return
    try {
      await apiAddTicker(form)
      setForm({ symbol: '', name: '', priceTickSpot: 0.01, priceTickFutures: 0.1, compressionSpot: 500, compressionFutures: 25 })
      setError(null)
      fetchTickers()
    } catch (e: any) {
      const msg = e?.code === 'TICKER_EXISTS' ? t('admin.database.tickerExists') : (e?.message || JSON.stringify(e))
      setError(msg)
    }
  }

  const handleUpdate = async (id: string) => {
    try {
      await apiUpdateTicker(id, editForm)
      setEditing(null)
      fetchTickers()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  const handleDelete = async (id: string, symbol: string) => {
    if (!confirm(`Delete ${symbol}?`)) return
    try {
      await apiDeleteTicker(id)
      fetchTickers()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  const card = isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'
  const input = isLight
    ? 'bg-slate-50 border-slate-200 text-slate-900 focus:border-emerald-500'
    : 'bg-white/[0.03] border-white/10 text-white focus:border-emerald-500'

  return (
    <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${card}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-emerald-500 uppercase shrink-0">
        <Database className="w-4 h-4" />
        {t('admin.database.addTicker')}
      </div>

      <div className={`flex-1 overflow-y-auto rounded-xl border p-3 space-y-2 text-xs font-mono ${
        isLight ? 'border-slate-200 bg-slate-50/50' : 'border-white/5 bg-white/[0.01]'
      }`}>
        {loading ? (
          <div className="text-slate-400 text-center py-6">{t('admin.database.loading')}</div>
        ) : error ? (
          <div className="text-red-400 text-center py-6 text-xs font-mono">{t('admin.database.fetchError')}: {error}</div>
        ) : tickers.length === 0 ? (
          <div className="text-slate-400 text-center py-6">{t('admin.database.noTickers')}</div>
        ) : (
          tickers.map((tk) => (
            <div key={tk.id} className={`p-3 rounded-lg border flex flex-col gap-2 ${
              isLight ? 'bg-white border-slate-200' : 'bg-white/[0.02] border-white/5'
            }`}>
              {editing === tk.id ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <label className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>{t('admin.database.symbol')}</label>
                    <input className={`px-2 py-1 rounded border text-xs ${input}`} value={editForm.symbol ?? tk.symbol} onChange={(e) => setEditForm({ ...editForm, symbol: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className={`text-[9px] font-mono uppercase ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{t('admin.database.priceTickSpot')}</label>
                      <input className={`px-2 py-1 rounded border text-xs ${input}`} type="number" step="0.01" value={editForm.priceTickSpot ?? tk.priceTickSpot} onChange={(e) => setEditForm({ ...editForm, priceTickSpot: +e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={`text-[9px] font-mono uppercase ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{t('admin.database.priceTickFutures')}</label>
                      <input className={`px-2 py-1 rounded border text-xs ${input}`} type="number" step="0.1" value={editForm.priceTickFutures ?? tk.priceTickFutures} onChange={(e) => setEditForm({ ...editForm, priceTickFutures: +e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={`text-[9px] font-mono uppercase ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{t('admin.database.compressionSpot')}</label>
                      <input className={`px-2 py-1 rounded border text-xs ${input}`} type="number" value={editForm.compressionSpot ?? tk.compressionSpot} onChange={(e) => setEditForm({ ...editForm, compressionSpot: +e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={`text-[9px] font-mono uppercase ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{t('admin.database.compressionFutures')}</label>
                      <input className={`px-2 py-1 rounded border text-xs ${input}`} type="number" value={editForm.compressionFutures ?? tk.compressionFutures} onChange={(e) => setEditForm({ ...editForm, compressionFutures: +e.target.value })} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleUpdate(tk.id)} className="px-3 py-1 rounded-lg bg-emerald-500 text-white font-bold hover:bg-emerald-600 cursor-pointer flex items-center gap-1"><Save className="w-3 h-3" />{t('admin.database.save')}</button>
                    <button onClick={() => setEditing(null)} className={`px-3 py-1 rounded-lg border font-bold cursor-pointer flex items-center gap-1 ${isLight ? 'border-slate-200 hover:bg-slate-100' : 'border-white/10 hover:bg-white/5'}`}><X className="w-3 h-3" />{t('admin.database.cancel')}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`font-black text-sm ${isLight ? 'text-slate-900' : 'text-white'}`}>{tk.symbol}</span>
                    <div className="flex gap-1">
                      <button onClick={() => { setEditing(tk.id); setEditForm({}) }} className={`p-1 rounded cursor-pointer ${isLight ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/5 text-slate-400'}`}><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => handleDelete(tk.id, tk.symbol)} className="p-1 rounded cursor-pointer hover:bg-red-500/10 text-red-400"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                    <span className="text-slate-500">Tick Spot:</span><span className="font-bold">{tk.priceTickSpot}</span>
                    <span className="text-slate-500">Tick Futures:</span><span className="font-bold">{tk.priceTickFutures}</span>
                    <span className="text-slate-500">Comp Spot:</span><span className="font-bold">{tk.compressionSpot}</span>
                    <span className="text-slate-500">Comp Futures:</span><span className="font-bold">{tk.compressionFutures}</span>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <div className={`flex flex-col gap-2 p-3 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.01] border-white/5'}`}>
        <div className="flex items-center gap-2 text-[10px] font-bold font-mono text-slate-400 uppercase">
          <Plus className="w-3 h-3" />{t('admin.database.add')}
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              {t('admin.database.symbol')} <span className="text-slate-400 font-normal lowercase">(e.g. SOLUSDT)</span>
            </label>
            <input className={`px-2 py-1.5 rounded-lg border text-xs ${input}`} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              {t('admin.database.name')}
            </label>
            <input className={`px-2 py-1.5 rounded-lg border text-xs ${input}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              {t('admin.database.priceTickSpot')} <span className="text-slate-400 font-normal">(Tick Size)</span>
            </label>
            <input className={`px-2 py-1.5 rounded-lg border text-xs ${input}`} type="number" step="0.01" value={form.priceTickSpot} onChange={(e) => setForm({ ...form, priceTickSpot: +e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              {t('admin.database.priceTickFutures')} <span className="text-slate-400 font-normal">(Tick Size)</span>
            </label>
            <input className={`px-2 py-1.5 rounded-lg border text-xs ${input}`} type="number" step="0.1" value={form.priceTickFutures} onChange={(e) => setForm({ ...form, priceTickFutures: +e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              {t('admin.database.compressionDefaults')} — {t('admin.database.futures')} / {t('admin.database.spot')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className={`text-[9px] font-mono uppercase ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                  {t('admin.database.compressionFutures')}
                </label>
                <input className={`px-2 py-1.5 rounded-lg border text-xs ${input}`} type="number" value={form.compressionFutures} onChange={(e) => setForm({ ...form, compressionFutures: +e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={`text-[9px] font-mono uppercase ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                  {t('admin.database.compressionSpot')}
                </label>
                <input className={`px-2 py-1.5 rounded-lg border text-xs ${input}`} type="number" value={form.compressionSpot} onChange={(e) => setForm({ ...form, compressionSpot: +e.target.value })} />
              </div>
            </div>
          </div>
        </div>
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
            {error}
          </div>
        )}
        <button onClick={handleAdd} className="px-4 py-2 rounded-xl bg-emerald-500 text-white font-bold text-xs hover:bg-emerald-600 cursor-pointer transition-colors mt-1">
          {t('admin.database.add')}
        </button>
      </div>
    </div>
  )
}

function CompressionBlock({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation()
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [selected, setSelected] = useState<string>('')
  const [compressions, setCompressions] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const fetchTickers = useCallback(async () => {
    try {
      const data = await apiGetTickers()
      setTickers(data)
      if (data.length > 0 && !selected) setSelected(data[0]!.symbol)
    } catch { /* ignore */ }
  }, [selected])

  useEffect(() => { fetchTickers() }, [fetchTickers])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    setSaveMsg(null)
    setSaveErr(null)
    apiGetCompressions(selected).then((data) => {
      const tk = tickers.find((t) => t.symbol === selected)
      const futuresBase = tk?.compressionFutures ?? 25
      const spotBase = tk?.compressionSpot ?? 500
      const map: Record<string, Record<string, number>> = {
        futures: {
          '1m': futuresBase,
          '5m': futuresBase,
          '15m': futuresBase * 2,
          '30m': futuresBase * 2,
          '1h': futuresBase * 4,
          '4h': futuresBase * 4,
        },
        spot: {
          '15m': spotBase,
          '30m': spotBase,
          '1h': spotBase * 2,
          '4h': spotBase * 2,
        },
      }
      data.forEach((c) => {
        if (!map[c.market]) map[c.market] = {}
        map[c.market]![c.timeframe] = c.multiplier
      })
      setCompressions(map)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selected, tickers])

  const handleSave = async () => {
    if (!selected) return
    setSaveMsg(null)
    setSaveErr(null)
    const all: DefaultCompression[] = []
    for (const market of ['futures', 'spot'] as const) {
      const tfs = market === 'spot' ? SPOT_TIMEFRAMES : FUTURES_TIMEFRAMES
      for (const tf of tfs) {
        const val = compressions[market]?.[tf]
        if (val !== undefined && val >= 1) {
          all.push({ id: '', symbol: selected, market, timeframe: tf, multiplier: val })
        }
      }
    }
    if (all.length === 0) {
      setSaveErr(t('admin.database.noCompressions'))
      return
    }
    try {
      await apiUpsertCompressions(selected, all)
      setSaveMsg(t('admin.database.compressionsSaved'))
    } catch (e: any) {
      setSaveErr(e?.message || JSON.stringify(e))
    }
  }

  const updateMult = (market: string, tf: string, val: number) => {
    setCompressions((prev) => ({
      ...prev,
      [market]: { ...prev[market], [tf]: val },
    }))
    setSaveMsg(null)
    setSaveErr(null)
  }

  const baseComp = (market: string) => {
    const tk = tickers.find((t) => t.symbol === selected)
    return market === 'futures' ? tk?.compressionFutures ?? 25 : tk?.compressionSpot ?? 500
  }

  const card = isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'
  const input = isLight
    ? 'bg-slate-50 border-slate-200 text-slate-900 focus:border-emerald-500'
    : 'bg-white/[0.03] border-white/10 text-white focus:border-emerald-500'

  return (
    <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${card}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-blue-500 uppercase shrink-0">
        <Database className="w-4 h-4" />
        {t('admin.database.compressionDefaults')}
      </div>

      <select
        className={`px-3 py-2 rounded-xl border text-xs font-mono ${input}`}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {tickers.map((tk) => (
          <option key={tk.id} value={tk.symbol}>{tk.symbol}</option>
        ))}
      </select>

      {loading ? (
        <div className="text-slate-400 text-center py-6 text-xs font-mono">{t('admin.database.loading')}</div>
      ) : selected ? (
        <div className="flex flex-col gap-4">
          {(['futures', 'spot'] as const).map((market) => {
            const tfs = market === 'spot' ? SPOT_TIMEFRAMES : FUTURES_TIMEFRAMES
            return (
              <div key={market}>
                <div className="text-[10px] font-bold font-mono text-slate-400 uppercase mb-2">
                  {market === 'futures' ? t('admin.database.futures') : t('admin.database.spot')}
                  <span className="ml-2 text-slate-500">({t('admin.database.base')}: {baseComp(market)})</span>
                </div>
                <div className={`grid gap-2 ${market === 'spot' ? 'grid-cols-4' : 'grid-cols-3'}`}>
                  {tfs.map((tf) => {
                    const val = compressions[market]?.[tf]
                    const hasValue = val !== undefined && val >= 1
                    const belowBase = hasValue && val! < baseComp(market)
                    return (
                      <div key={tf} className={`flex flex-col gap-1 p-2 rounded-lg border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.01] border-white/5'}`}>
                        <span className="text-[10px] font-mono font-bold text-slate-500">{tf}</span>
                        <input
                          className={`px-2 py-1 rounded border text-xs font-mono ${input}`}
                          type="number"
                          min={baseComp(market)}
                          value={val ?? ''}
                          onChange={(e) => updateMult(market, tf, +e.target.value)}
                        />
                        {belowBase && (
                          <span className="text-[9px] text-red-400 font-mono">{t('admin.database.validationError')}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {saveMsg && (
            <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
              {saveMsg}
            </div>
          )}
          {saveErr && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
              {saveErr}
            </div>
          )}
          <button onClick={handleSave} className="px-4 py-2 rounded-xl bg-blue-500 text-white font-bold text-xs hover:bg-blue-600 cursor-pointer transition-colors flex items-center gap-2 justify-center">
            <Save className="w-3 h-3" />{t('admin.database.save')}
          </button>
        </div>
      ) : (
        <div className="text-slate-400 text-center py-6 text-xs font-mono">{t('admin.database.noCompressions')}</div>
      )}
    </div>
  )
}

function HistoryBlock({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation()
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [symbol, setSymbol] = useState('')
  const [market, setMarket] = useState('futures')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [startErr, setStartErr] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [clearErr, setClearErr] = useState<string | null>(null)

  const fetchTickers = useCallback(async () => {
    try {
      const data = await apiGetTickers()
      setTickers(data)
      if (data.length > 0 && !symbol) setSymbol(data[0]!.symbol)
    } catch { /* ignore */ }
  }, [symbol])

  useEffect(() => { fetchTickers() }, [fetchTickers])

  const fetchJobs = useCallback(async () => {
    try {
      const data = await apiGetJobs()
      setJobs(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const tick = () => {
      fetchJobs()
      const hasActive = jobsRef.current.some((j) => isActiveStatus(j.status))
      timeoutRef.current = setTimeout(tick, hasActive ? 1500 : 5000)
    }

    tick()

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [fetchJobs])

  const handleStart = async () => {
    if (!symbol || !startDate || !endDate) return
    setSubmitting(true)
    setStartErr(null)
    try {
      await apiStartDownload({ symbol, market, startDate, endDate })
      fetchJobs()
    } catch (e: any) {
      setStartErr(e?.message || JSON.stringify(e))
    }
    setSubmitting(false)
  }

  const statusColor = (s: string) => {
    if (s === 'completed' || s === 'done') return 'text-emerald-500'
    if (s === 'failed') return 'text-red-500'
    if (s === 'downloading' || s === 'parsing' || s === 'aggregating' || s === 'inserting' || s === 'running') return 'text-amber-500'
    return 'text-slate-400'
  }

  const isActiveStatus = (s: string) =>
    s === 'downloading' || s === 'parsing' || s === 'aggregating' || s === 'inserting' || s === 'running' || s === 'pending'

  const card = isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'
  const input = isLight
    ? 'bg-slate-50 border-slate-200 text-slate-900 focus:border-emerald-500'
    : 'bg-white/[0.03] border-white/10 text-white focus:border-emerald-500'

  return (
    <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${card}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-purple-500 uppercase shrink-0">
        <Download className="w-4 h-4" />
        {t('admin.database.historyDownload')}
      </div>

      <div className={`flex flex-col gap-3 p-3 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.01] border-white/5'}`}>
        <select className={`px-3 py-2 rounded-xl border text-xs font-mono ${input}`} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {tickers.map((tk) => <option key={tk.id} value={tk.symbol}>{tk.symbol}</option>)}
        </select>

        <div className="flex gap-2">
          <select className={`flex-1 px-3 py-2 rounded-xl border text-xs font-mono ${input}`} value={market} onChange={(e) => setMarket(e.target.value)}>
            <option value="futures">{t('admin.database.futures')}</option>
            <option value="spot">{t('admin.database.spot')}</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] font-mono text-slate-400 uppercase mb-1 block">{t('admin.database.startDate')}</span>
            <input className={`w-full px-2 py-1.5 rounded-lg border text-xs font-mono ${input}`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <span className="text-[10px] font-mono text-slate-400 uppercase mb-1 block">{t('admin.database.endDate')}</span>
            <input className={`w-full px-2 py-1.5 rounded-lg border text-xs font-mono ${input}`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <button
          onClick={handleStart}
          disabled={submitting || !symbol || !startDate || !endDate}
          className="px-4 py-2 rounded-xl bg-purple-500 text-white font-bold text-xs hover:bg-purple-600 disabled:opacity-50 cursor-pointer transition-colors flex items-center gap-2 justify-center"
        >
          <Download className="w-3 h-3" />
          {submitting ? t('admin.database.loading') : t('admin.database.startDownload')}
        </button>
        {startErr && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
            {startErr}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl border p-3 space-y-2 text-xs font-mono min-h-0 max-h-[400px] xl:max-h-none">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold font-mono text-slate-400 uppercase">{t('admin.database.jobs')}</span>
          <div className="flex items-center gap-1">
            <button onClick={fetchJobs} className={`p-1 rounded cursor-pointer ${isLight ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/5 text-slate-400'}`}>
              <RefreshCw className="w-3 h-3" />
            </button>
            <button
              onClick={async () => {
                setClearing(true)
                setClearErr(null)
                try {
                  await apiClearJobs()
                  await fetchJobs()
                } catch (e: any) {
                  setClearErr(e?.message || JSON.stringify(e))
                }
                setClearing(false)
              }}
              disabled={jobs.length === 0 || clearing || !navigator.onLine}
              className={`p-1 rounded cursor-pointer transition-colors text-xs font-bold ${
                clearing ? 'opacity-50 cursor-not-allowed' : ''
              } ${isLight ? 'hover:bg-red-100 text-red-500' : 'hover:bg-red-500/10 text-red-400'}`}
            >
              {clearing ? '...' : <Trash2 className="w-3 h-3" />}
            </button>
          </div>
        </div>
        {clearErr && (
          <div className="px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-mono mb-2">
            {clearErr}
          </div>
        )}
        {jobs.length === 0 ? (
          <div className="text-slate-400 text-center py-6">{t('admin.database.noData')}</div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className={`p-3 rounded-lg border flex flex-col gap-1.5 ${
              isLight ? 'bg-white border-slate-200' : 'bg-white/[0.02] border-white/5'
            }`}>
              <div className="flex items-center justify-between">
                <span className={`font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>{job.symbol} <span className="text-slate-400 font-normal">{job.market}</span></span>
                <span className={`text-[10px] font-bold uppercase ${statusColor(job.status)}`}>{t(`admin.database.${job.status}` as any) || job.status}</span>
              </div>
              <div className="text-[10px] text-slate-500">{job.startDate} → {job.endDate}</div>
              {isActiveStatus(job.status) && (
                <div className={`h-1.5 w-full rounded-full overflow-hidden ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`}>
                  <div className="h-full bg-amber-500 transition-all duration-300 rounded-full" style={{ width: `${Math.min(job.progress, 100)}%` }} />
                </div>
              )}
              <div className="text-[10px] text-slate-500 font-mono">{Math.round(job.progress)}%</div>
              {job.stepDetail && <div className="text-[10px] text-slate-500 truncate">{t('admin.database.stepDetail')}: {job.stepDetail}</div>}
              {job.error && <div className="text-[10px] text-red-400 truncate">{job.error}</div>}
              {job.totalTicks > 0 && <div className="text-[10px] text-slate-500">{t('admin.database.totalTicks')}: {job.totalTicks.toLocaleString()}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function UsersTab({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation()
  const { user: currentUser } = useAuthContext()

  const [stats, setStats] = useState<UserStats | null>(null)
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add user form
  const [newLogin, setNewLogin] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('free')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<UserListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Role edit per-user
  const [editRoles, setEditRoles] = useState<Record<string, string>>({})
  const [savingRoles, setSavingRoles] = useState<Record<string, boolean>>({})
  const [savedRoles, setSavedRoles] = useState<Record<string, boolean>>({})

  // Pricing
  const [pricePro, setPricePro] = useState<number>(() => {
    const saved = localStorage.getItem('procluster_price_pro')
    return saved ? Number(saved) : 19
  })
  const [priceVip, setPriceVip] = useState<number>(() => {
    const saved = localStorage.getItem('procluster_price_vip')
    return saved ? Number(saved) : 49
  })
  const [priceSuccessMsg, setPriceSuccessMsg] = useState('')

  const card = isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'
  const input = isLight
    ? 'bg-slate-50 border-slate-200 text-slate-900 focus:border-emerald-500'
    : 'bg-white/[0.03] border-white/10 text-white focus:border-emerald-500'

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsData, usersData] = await Promise.all([
        apiGetUserStats(),
        apiListUsers(200, 0),
      ])
      setStats(statsData)
      setUsers(usersData.users)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)

    const login = newLogin.trim()
    if (!login) {
      setAddError(t('admin.users.loginRequired'))
      return
    }
    if (newPassword.length < 8) {
      setAddError(t('admin.users.passwordTooShort'))
      return
    }

    setAdding(true)
    try {
      await apiCreateUser(login, newPassword, newRole, newEmail.trim() || undefined)
      setNewLogin('')
      setNewEmail('')
      setNewPassword('')
      setNewRole('free')
      await fetchData()
    } catch (e: any) {
      if (e?.code === 'LOGIN_EXISTS') {
        setAddError(t('admin.users.loginExists'))
      } else if (e?.code === 'USER_EXISTS') {
        setAddError(t('admin.users.userExists'))
      } else {
        setAddError(e?.message ?? t('admin.users.createFailed'))
      }
    } finally {
      setAdding(false)
    }
  }

  const handleRoleSave = async (userId: string) => {
    const newVal = editRoles[userId]
    if (!newVal) return

    setSavingRoles(prev => ({ ...prev, [userId]: true }))
    try {
      await apiUpdateUserRole(userId, newVal)
      setSavedRoles(prev => ({ ...prev, [userId]: true }))
      setTimeout(() => setSavedRoles(prev => ({ ...prev, [userId]: false })), 2000)
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newVal } : u))
    } catch (e: any) {
      if (e?.code === 'INVALID_ROLE') {
        setError(t('admin.users.invalidRole'))
      } else {
        setError(e?.message ?? t('admin.users.updateFailed'))
      }
    } finally {
      setSavingRoles(prev => ({ ...prev, [userId]: false }))
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiDeleteUser(deleteTarget.id)
      setDeleteTarget(null)
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id))
      const statsData = await apiGetUserStats()
      setStats(statsData)
    } catch (e: any) {
      if (e?.code === 'SELF_DELETE') {
        setDeleteError(t('admin.users.selfDelete'))
      } else {
        setDeleteError(e?.message ?? t('admin.users.deleteFailed'))
      }
    } finally {
      setDeleting(false)
    }
  }

  const roles = ['free', 'pro', 'vip', 'admin']

  if (loading && users.length === 0) {
    return (
      <div className={`p-5 rounded-2xl border ${card}`}>
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer text-red-400/70 hover:text-red-400"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Unified Monitoring & Pricing Panel */}
      <div className={`py-3 px-4 rounded-xl border flex flex-col gap-2.5 ${card}`}>
        <div className="flex flex-wrap justify-between items-center gap-2.5 border-b border-slate-200/10 pb-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
            <div>
              <h3 className={`text-xs font-black uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-white'}`}>
                {t('admin.users.monitoringTitle') || 'Мониторинг Трафика и Настройка Стоимости Статусов'}
              </h3>
              <p className="text-[10px] text-slate-400 mt-0">
                {t('admin.users.monitoringSubtitle') || 'Аналитика активности и управление тарифами PRO & VIP'}
              </p>
            </div>
          </div>
          {priceSuccessMsg && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-[9px] font-mono font-black uppercase bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow"
            >
              <span>{priceSuccessMsg}</span>
            </motion.div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Metrics */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className={`p-2.5 rounded-lg border flex items-center gap-2.5 ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.015] border-white/5'}`}>
              <div className={`p-1.5 rounded-md shrink-0 ${isLight ? 'bg-blue-100 text-blue-700 shadow-sm' : 'bg-blue-500/10 text-blue-500'}`}>
                <Users className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className={`text-[8.5px] font-mono font-extrabold block uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{t('admin.users.hosts')}</span>
                <div className="text-sm font-black tracking-tight flex items-center gap-1 mt-0">
                  <span>{stats?.hosts?.toLocaleString() ?? '---'}</span>
                  <span className={`text-[7.5px] px-1 py-0 font-mono font-black rounded ${isLight ? 'bg-emerald-600 text-white' : 'text-emerald-500 bg-emerald-500/10'}`}>LIVE</span>
                </div>
              </div>
            </div>
            <div className={`p-2.5 rounded-lg border flex items-center gap-2.5 ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.015] border-white/5'}`}>
              <div className={`p-1.5 rounded-md shrink-0 ${isLight ? 'bg-amber-100 text-amber-800 shadow-sm' : 'bg-yellow-500/10 text-yellow-500'}`}>
                <Users className="w-4 h-4 animate-pulse" />
              </div>
              <div className="min-w-0">
                <span className={`text-[8.5px] font-mono font-extrabold block uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{t('admin.users.registered')}</span>
                <div className="text-sm font-black tracking-tight mt-0">{stats?.registered?.toLocaleString() ?? '---'}</div>
              </div>
            </div>
            <div className={`p-2.5 rounded-lg border flex items-center gap-2.5 ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.015] border-white/5'}`}>
              <div className={`p-1.5 rounded-md shrink-0 ${isLight ? 'bg-emerald-100 text-emerald-800 shadow-sm' : 'bg-emerald-500/10 text-emerald-500'}`}>
                <Activity className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className={`text-[8.5px] font-mono font-extrabold block uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{t('admin.users.online')}</span>
                <div className="text-sm font-black tracking-tight flex items-center gap-1 mt-0">
                  <span>{stats?.onlineAuth ?? '---'}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block shrink-0" />
                </div>
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className={`p-2 rounded-lg border flex flex-col justify-between gap-1 ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.015] border-white/5'}`}>
              <div className="flex justify-between items-center">
                <span className="text-[8.5px] font-mono font-black uppercase tracking-wider text-amber-500">PRO</span>
                <span className="text-[8px] font-mono text-slate-400">USDT / мес</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={pricePro}
                  onChange={(e) => setPricePro(Number(e.target.value) || 0)}
                  className={`w-full rounded-md pl-2 pr-9 py-0.5 font-mono font-bold text-[11px] border focus:outline-none ${
                    isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-950 border-white/10 text-white'
                  }`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-mono font-black text-slate-400">USDT</span>
              </div>
            </div>
            <div className={`p-2 rounded-lg border flex flex-col justify-between gap-1 ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.015] border-white/5'}`}>
              <div className="flex justify-between items-center">
                <span className="text-[8.5px] font-mono font-black uppercase tracking-wider text-yellow-500">VIP</span>
                <span className="text-[8px] font-mono text-slate-400">USDT / мес</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={priceVip}
                  onChange={(e) => setPriceVip(Number(e.target.value) || 0)}
                  className={`w-full rounded-md pl-2 pr-9 py-0.5 font-mono font-bold text-[11px] border focus:outline-none ${
                    isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-950 border-white/10 text-white'
                  }`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-mono font-black text-slate-400">USDT</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-200/5 pt-1.5">
          <button
            onClick={() => {
              localStorage.setItem('procluster_price_pro', pricePro.toString())
              localStorage.setItem('procluster_price_vip', priceVip.toString())
              setPriceSuccessMsg('Цены успешно сохранены!')
              setTimeout(() => setPriceSuccessMsg(''), 3000)
            }}
            className={`py-1 px-3 rounded-md font-bold uppercase tracking-wider text-[9px] flex items-center gap-1 cursor-pointer border transition-all duration-200 active:scale-95 ${
              isLight
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700 shadow shadow-emerald-600/10'
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/25 text-emerald-400'
            }`}
          >
            <Save className="w-3 h-3" />
            {t('admin.users.savePrices') || 'Сохранить цены'}
          </button>
        </div>
      </div>

      {/* Add user form */}
      <div className={`p-4 rounded-2xl border ${card}`}>
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs font-bold font-mono uppercase tracking-wider">{t('admin.users.addUser')}</span>
        </div>
        <form onSubmit={handleAddUser} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-slate-500">{t('auth.username')}</label>
            <input
              value={newLogin}
              onChange={e => setNewLogin(e.target.value)}
              placeholder="nickname"
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono outline-none w-32 ${input}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-slate-500">{t('auth.email')} <span className="text-slate-600">({t('admin.users.optional')})</span></label>
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono outline-none w-40 ${input}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-slate-500">{t('auth.password')}</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="********"
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono outline-none w-32 ${input}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-slate-500">{t('admin.users.role')}</label>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono outline-none ${input}`}
            >
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="px-4 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold cursor-pointer hover:bg-amber-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? t('common.loading') : t('admin.users.addUserBtn')}
          </button>
        </form>
        {addError && <p className="text-[10px] text-red-400 mt-2">{addError}</p>}
      </div>

      {/* Users table */}
      <div className={`p-4 rounded-2xl border ${card}`}>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs font-bold font-mono uppercase tracking-wider">{t('admin.users.listTitle')}</span>
          <span className="text-[10px] text-slate-500 font-mono">({users.length})</span>
        </div>

        {users.length === 0 ? (
          <p className="text-xs text-slate-500">{t('admin.users.emptyList')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th className="text-left py-2 pr-3">{t('auth.username')}</th>
                  <th className="text-left py-2 pr-3">{t('auth.email')}</th>
                  <th className="text-left py-2 pr-3">{t('admin.users.role')}</th>
                  <th className="text-left py-2 pr-3">{t('admin.users.registeredDate')}</th>
                  <th className="text-right py-2">{t('admin.users.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const currentRole = editRoles[u.id] ?? u.role
                  const hasChanged = currentRole !== u.role
                  const isSelf = u.id === currentUser?.id
                  const isPlaceholder = u.email.includes('@placeholder.local')
                  return (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 pr-3 font-mono text-slate-300 max-w-[120px] truncate font-bold">{u.nickname}</td>
                      <td className="py-2 pr-3 font-mono text-slate-500 max-w-[160px] truncate">{isPlaceholder ? '—' : u.email}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1">
                          <select
                            value={currentRole}
                            onChange={e => setEditRoles(prev => ({ ...prev, [u.id]: e.target.value }))}
                            className={`px-2 py-1 rounded border text-[10px] font-mono outline-none w-20 ${input}`}
                          >
                            {roles.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <button
                            onClick={() => handleRoleSave(u.id)}
                            disabled={!hasChanged || savingRoles[u.id]}
                            className={`px-2 py-1 rounded text-[10px] font-bold font-mono transition cursor-pointer ${
                              savedRoles[u.id]
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : hasChanged
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                                  : 'text-slate-600 border border-transparent cursor-not-allowed'
                            }`}
                          >
                            {savingRoles[u.id] ? '...' : savedRoles[u.id] ? t('admin.users.saved') : t('admin.users.save')}
                          </button>
                        </div>
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-500 text-[10px]">
                        {formatDate(u.createdAt)}
                      </td>
                      <td className="py-2 text-right">
                        {isSelf ? (
                          <span className="text-[10px] text-slate-600 italic">{t('admin.users.you')}</span>
                        ) : (
                          <button
                            onClick={() => setDeleteTarget(u)}
                            className="px-2 py-1 rounded text-[10px] text-rose-400/70 hover:text-rose-400 border border-transparent hover:border-rose-500/30 transition cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !deleting && setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.12 }}
              className={`p-5 rounded-2xl border max-w-sm w-full mx-4 ${card}`}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <Trash2 className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-bold font-mono uppercase tracking-wider">{t('admin.users.deleteTitle')}</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                {t('admin.users.deleteConfirm').replace('{email}', deleteTarget.email)}
              </p>
              {deleteError && <p className="text-[10px] text-red-400 mb-3">{deleteError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError(null) }}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 text-slate-400 hover:text-white cursor-pointer transition disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:bg-rose-500/30 cursor-pointer transition disabled:opacity-50"
                >
                  {deleting ? t('common.loading') : t('admin.users.deleteBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return dateStr
  }
}

type TierGroup = 'guest' | 'free' | 'pro' | 'vip' | 'admin'

const TIER_COLORS: Record<TierGroup, { active: string; badge: string }> = {
  guest: { active: 'bg-purple-600 text-white shadow-md border-purple-700', badge: 'text-purple-400' },
  free: { active: 'bg-slate-600 text-white shadow-md border-slate-700', badge: 'text-slate-400' },
  pro: { active: 'bg-blue-600 text-white shadow-md border-blue-700', badge: 'text-blue-400' },
  vip: { active: 'bg-amber-600 text-white shadow-md border-amber-700', badge: 'text-amber-400' },
  admin: { active: 'bg-rose-600 text-white shadow-md border-rose-700', badge: 'text-rose-300' },
}

const TIER_LABELS: Record<TierGroup, string> = {
  guest: 'GUEST ГОСТЬ',
  free: 'FREE тариф',
  pro: 'PRO тариф',
  vip: 'VIP тариф',
  admin: 'ADMIN права',
}

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h'] as const

function TierPoliciesBlock({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation()
  const [selectedGroup, setSelectedGroup] = useState<TierGroup>('guest')
  const [policies, setPolicies] = useState<Record<string, TierPolicy> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const fetchPolicies = useCallback(async () => {
    try {
      const data = await apiGetPolicies()
      setPolicies(data)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load policies')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])

  const updateField = (tier: string, field: string, value: any) => {
    setPolicies(prev => {
      if (!prev) return prev
      const tierP = prev[tier]
      if (!tierP) return prev
      return { ...prev, [tier]: { ...tierP, [field]: value } }
    })
    setSaveMsg(null)
  }

  const updateHistoryTf = (tier: string, tf: string, value: number) => {
    setPolicies(prev => {
      if (!prev) return prev
      const tierP = prev[tier]
      if (!tierP) return prev
      return {
        ...prev,
        [tier]: {
          ...tierP,
          historyDaysPerTf: { ...tierP.historyDaysPerTf, [tf]: value },
        },
      }
    })
    setSaveMsg(null)
  }

  const handleSave = async () => {
    if (!policies) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await apiUpdatePolicies(policies)
      setSaveMsg('Политики лимитов сохранены!')
      setTimeout(() => setSaveMsg(null), 3000)
      await fetchPolicies()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save')
    }
    setSaving(false)
  }

  const card = isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'
  const subcard = isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.02] border-white/5'
  const input = isLight
    ? 'bg-white border-slate-300 text-slate-900'
    : 'bg-slate-950 border-white/10 text-white'

  const current = policies?.[selectedGroup]

  if (loading) {
    return (
      <div className={`p-5 rounded-2xl border ${card}`}>
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer"><X className="w-3 h-3" /></button>
        </div>
      )}

      <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${card}`}>
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-500 animate-spin" />
            <div>
              <h3 className={`text-sm font-black uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-white'}`}>
                {t('admin.policies.title') || 'Настройки Лимитов & Политик Групп'}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('admin.policies.subtitle') || 'Управление правами доступа, лимитами истории, рендером и оповещениями'}
              </p>
            </div>
          </div>

          {saveMsg && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-[10px] font-mono font-black uppercase bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1 rounded-full flex items-center gap-1.5"
            >
              <span>{saveMsg}</span>
            </motion.div>
          )}
        </div>

        {/* Tier tabs */}
        <div className={`flex flex-wrap gap-1.5 p-1 rounded-xl ${isLight ? 'bg-slate-100 border border-slate-200/80 shadow-inner' : 'bg-slate-950/20 border border-white/5'}`}>
          {(Object.keys(TIER_LABELS) as TierGroup[]).map(g => (
            <button
              key={g}
              onClick={() => setSelectedGroup(g)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider cursor-pointer transition border ${
                selectedGroup === g
                  ? `${TIER_COLORS[g].active} border`
                  : isLight
                    ? 'bg-white border-slate-300/80 text-slate-700 hover:text-slate-900 hover:bg-slate-50 shadow-sm'
                    : 'bg-transparent border-transparent text-slate-400 hover:bg-white/[0.02]'
              }`}
            >
              {TIER_LABELS[g]}
            </button>
          ))}
        </div>

        {current && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-2">
            {/* Card 1: History per TF */}
            <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 md:col-span-2 lg:col-span-3 ${subcard}`}>
              <div>
                <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  1. {t('admin.policies.maxHistoryPerTf') || 'Макс. история по таймфреймам (дни)'}
                </span>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                  {t('admin.policies.maxHistoryPerTfDesc') || 'Лимит истории свечей для каждого таймфрейма. -1 = безлимит.'}
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3.5 mt-2">
                {TIMEFRAMES.map(tf => {
                  const v = current.historyDaysPerTf?.[tf] ?? 1
                  const isUnlimited = v === -1
                  return (
                    <div key={tf} className="flex flex-col gap-1">
                      <span className={`text-[10px] font-mono font-bold uppercase ${isLight ? 'text-amber-800' : 'text-amber-500'}`}>{tf}</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="-1"
                          max="10000"
                          value={v}
                          onChange={e => updateHistoryTf(current.tier, tf, parseInt(e.target.value) || 0)}
                          className={`w-full rounded-lg px-2.5 py-1.5 font-mono font-black text-xs border ${input}`}
                        />
                        <span className={`text-[9px] font-mono ${isUnlimited ? 'text-emerald-500 font-bold' : 'text-slate-400'}`}>
                          {isUnlimited ? 'безлимит' : 'дн.'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Card 2: Compression max */}
            <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${subcard}`}>
              <div>
                <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  2. {t('admin.policies.compressionMax') || 'Уровни сжатия графика'}
                </span>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                  {t('admin.policies.compressionMaxDesc') || 'Макс. количество шагов кластеризации. 1..10.'}
                </p>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="-1"
                    max="10"
                    value={current.compressionMax}
                    onChange={e => updateField(current.tier, 'compressionMax', parseInt(e.target.value) || 0)}
                    className={`w-full h-1.5 rounded-full appearance-none cursor-pointer ${isLight ? 'bg-slate-300 accent-blue-600' : 'bg-slate-800 accent-blue-500'}`}
                  />
                  <span className={`text-xs font-mono font-black shrink-0 select-none min-w-[32px] text-center ${isLight ? 'text-amber-800' : 'text-amber-500'}`}>
                    {current.compressionMax}x
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => (
                    <button
                      key={val}
                      onClick={() => updateField(current.tier, 'compressionMax', val)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition ${
                        current.compressionMax === val
                          ? 'bg-blue-500/15 border-blue-500 text-blue-400'
                          : isLight ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600 shadow-sm' : 'bg-slate-900 hover:bg-slate-800 border-white/5 text-slate-400'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Card 3: Max indicators */}
            <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${subcard}`}>
              <div>
                <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  3. {t('admin.policies.maxIndicators') || 'Индикаторов на графике'}
                </span>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                  {t('admin.policies.maxIndicatorsDesc') || 'Макс. количество активных индикаторов. -1 = безлимит.'}
                </p>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="-1"
                    max="10000"
                    value={current.maxIndicators}
                    onChange={e => updateField(current.tier, 'maxIndicators', parseInt(e.target.value) || 0)}
                    className={`w-full max-w-[90px] rounded-lg px-3 py-1.5 font-mono font-black text-xs border ${input}`}
                  />
                  <span className={`text-[11px] font-mono font-bold ${isLight ? 'text-teal-700 font-extrabold' : 'text-teal-400'}`}>активных</span>
                </div>
              </div>
            </div>

            {/* Card 4: Custom indicator settings */}
            <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${subcard}`}>
              <div>
                <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  4. {t('admin.policies.customIndicatorSettings') || 'Кастомные настройки индикаторов'}
                </span>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                  {t('admin.policies.customIndicatorSettingsDesc') || 'Разрешить пользователю менять настройки индикаторов.'}
                </p>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer mt-2 select-none">
                <input
                  type="checkbox"
                  checked={current.customIndicatorSettings === 1}
                  onChange={e => updateField(current.tier, 'customIndicatorSettings', e.target.checked ? 1 : 0)}
                  className={`w-4 h-4 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer ${isLight ? 'bg-white border-slate-300 text-blue-600' : 'bg-slate-900 border-white/10 text-blue-500'}`}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                  {current.customIndicatorSettings === 1 ? 'РАЗРЕШЕНО (ACTIVE)' : 'ЗАБЛОКИРОВАНО'}
                </span>
              </label>
            </div>

            {/* Card 5: Telegram */}
            <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${subcard}`}>
              <div>
                <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  5. {t('admin.policies.telegramEnabled') || 'Telegram-уведомления'}
                </span>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                  {t('admin.policies.telegramEnabledDesc') || 'Уведомления в Telegram о фильтрациях Cluster Search.'}
                </p>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer mt-2 select-none">
                <input
                  type="checkbox"
                  checked={current.telegramEnabled === 1}
                  onChange={e => updateField(current.tier, 'telegramEnabled', e.target.checked ? 1 : 0)}
                  className={`w-4 h-4 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer ${isLight ? 'bg-white border-slate-300 text-blue-600' : 'bg-slate-900 border-white/10 text-blue-500'}`}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                  {current.telegramEnabled === 1 ? 'ВКЛЮЧЕНО (TELEGRAM)' : 'ОТКЛЮЧЕНО'}
                </span>
              </label>
            </div>

            {/* Card 6: Workspaces */}
            <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${subcard}`}>
              <div>
                <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  6. {t('admin.policies.workspacesCount') || 'Рабочие пространства'}
                </span>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                  {t('admin.policies.workspacesCountDesc') || 'Количество одновременных рабочих пространств. 1 или 2.'}
                </p>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <input
                  type="number"
                  min="-1"
                  max="10000"
                  value={current.workspacesCount}
                  onChange={e => updateField(current.tier, 'workspacesCount', parseInt(e.target.value) || 0)}
                  className={`w-full max-w-[90px] rounded-lg px-3 py-1.5 font-mono font-black text-xs border ${input}`}
                />
                <span className={`text-[11px] font-mono font-bold ${isLight ? 'text-teal-700 font-extrabold' : 'text-teal-400'}`}>
                  {current.workspacesCount === -1 ? 'безлимит' : current.workspacesCount === 1 ? 'пространство' : 'пространства'}
                </span>
              </div>
            </div>

            {/* Card 7: Anomalies */}
            <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${subcard}`}>
              <div>
                <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  7. {t('admin.policies.anomaliesEnabled') || 'Отображение Аномалий (Cluster Search)'}
                </span>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                  {t('admin.policies.anomaliesEnabledDesc') || 'Разрешить пользователям включать опцию аномалий на графике.'}
                </p>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer mt-2 select-none">
                <input
                  type="checkbox"
                  checked={current.anomaliesEnabled === 1}
                  onChange={e => updateField(current.tier, 'anomaliesEnabled', e.target.checked ? 1 : 0)}
                  className={`w-4 h-4 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer ${isLight ? 'bg-white border-slate-300 text-blue-600' : 'bg-slate-900 border-white/10 text-blue-500'}`}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                  {current.anomaliesEnabled === 1 ? 'РАЗРЕШЕНО (ACTIVE)' : 'ЗАБЛОКИРОВАНО'}
                </span>
              </label>
            </div>

            {/* Card 8: Session limit */}
            <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${subcard}`}>
              <div>
                <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  8. {t('admin.policies.sessionLimit') || 'Лимит сессий'}
                </span>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                  {t('admin.policies.sessionLimitDesc') || 'Макс. одновременных WS-сессий. -1 = безлимит.'}
                </p>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                <input
                  type="number"
                  min="-1"
                  max="10000"
                  value={current.sessionLimit}
                  onChange={e => updateField(current.tier, 'sessionLimit', parseInt(e.target.value) || 0)}
                  className={`w-full max-w-[120px] rounded-lg px-3 py-1.5 font-mono font-black text-xs border ${input}`}
                />
                <span className={`text-[10px] font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {current.sessionLimit < 0 ? 'Безлимит' : `${current.sessionLimit} сессий`}
                </span>
              </div>
            </div>

            {/* Save button */}
            <div className="flex items-end justify-start">
              <button
                onClick={handleSave}
                disabled={saving}
                className={`w-full py-3 px-4 rounded-xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 cursor-pointer border transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 ${
                  isLight
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700 shadow-md shadow-indigo-600/10'
                    : 'bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                }`}
              >
                <Save className="w-4 h-4" />
                {saving ? t('common.loading') : t('admin.policies.saveAll') || 'Сохранить все лимиты'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SiteSettingsBlock({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation()
  const { betaMode, setBetaMode } = useAuthContext()
  const [error, setError] = useState<string | null>(null)

  const card = isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'

  return (
    <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${card}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-indigo-500 uppercase shrink-0">
        <Settings className="w-4 h-4" />
        {t('admin.policies.betaMode') || 'Закрытый бета-тест'}
      </div>

      {error && (
        <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer"><X className="w-3 h-3" /></button>
        </div>
      )}

      <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.02] border-white/5'}`}>
        <div>
          <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
            {t('admin.policies.betaModeDesc') || 'Сайт доступен только авторизованным пользователям. Неавторизованные видят гейт с формой входа.'}
          </span>
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer mt-2 select-none">
          <input
            type="checkbox"
            checked={betaMode}
            onChange={async (e) => {
              const newVal = e.target.checked
              const prev = betaMode
              setBetaMode(newVal)
              setError(null)
              try {
                await apiUpdateBetaMode(newVal)
              } catch {
                setBetaMode(prev)
                setError('Ошибка сохранения beta-режима')
              }
            }}
            className={`w-4 h-4 rounded focus:ring-amber-500 focus:ring-2 cursor-pointer ${isLight ? 'bg-white border-slate-300 text-amber-600' : 'bg-slate-900 border-white/10 text-amber-500'}`}
          />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${betaMode ? 'text-amber-500' : 'text-indigo-400'}`}>
            {betaMode ? 'БЕТА ВКЛЮЧЕНА (GATE ACTIVE)' : 'БЕТА ОТКЛЮЧЕНА'}
          </span>
        </label>
      </div>
    </div>
  )
}

function SettingsTab({ isLight }: { isLight: boolean }) {
  return (
    <div className="flex-1 flex flex-col gap-6 min-h-0 w-full overflow-y-auto">
      <SiteSettingsBlock isLight={isLight} />
      <TierPoliciesBlock isLight={isLight} />
      <AdminIndicatorDefaultsBlock isLight={isLight} />
    </div>
  )
}

function AdminIndicatorDefaultsBlock({ isLight }: { isLight: boolean }) {
  const { getSlot, activeSlot } = useChartControls()
  const slot = getSlot(activeSlot)
  const store = useIndicatorsStorage()
  const [symbol, setSymbol] = useState(slot.symbol)
  const [rows, setRows] = useState<AdminIndicatorDefault[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async (sym: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiListIndicatorDefaults(sym)
      setRows(data)
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      setError(err.message ?? 'failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(symbol) }, [symbol, load])

  const flash = (m: string) => {
    setMessage(m)
    setTimeout(() => setMessage(null), 2500)
  }

  const saveFromActiveSlot = async (scope: 'tf' | 'all-tf') => {
    const tf = scope === 'all-tf' ? '*' : slot.timeframe
    const current = store.getForKey(slot.symbol, slot.market, slot.timeframe)
    // Re-narrow the hydrated array back to the wire shape. We can't reuse
    // dehydrateForSave from the indicators package without a circular import,
    // and the projection is trivial enough to inline here.
    const stored = current.indicators.map((i) => ({
      id: i.id,
      isActive: i.isActive,
      ...(i.isVisible === undefined ? {} : { isVisible: i.isVisible }),
      settings: i.settings,
    }))
    try {
      await apiPutIndicatorDefaults(slot.symbol, slot.market, tf, stored)
      flash(`Сохранено: ${slot.symbol} / ${slot.market} / ${tf} (${stored.length} индикаторов)`)
      void load(symbol)
    } catch (e: unknown) {
      const err = e as { message?: string }
      setError(err.message ?? 'save failed')
    }
  }

  const handleDelete = async (row: AdminIndicatorDefault) => {
    if (!confirm(`Удалить дефолт ${row.symbol}/${row.market}/${row.timeframe}?`)) return
    try {
      await apiDeleteIndicatorDefaults(row.symbol, row.market, row.timeframe)
      flash(`Удалено: ${row.symbol}/${row.market}/${row.timeframe}`)
      void load(symbol)
    } catch (e: unknown) {
      const err = e as { message?: string }
      setError(err.message ?? 'delete failed')
    }
  }

  return (
    <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-indigo-500 uppercase mb-3">
        <Activity className="w-4 h-4" />
        Индикаторы по умолчанию
      </div>
      <p className={`text-[11px] mb-4 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
        Эти настройки увидят пользователи, которые ещё не задавали свои собственные на этой паре/рынке/ТФ.
        Каскад: своя запись юзера → этот админ-дефолт → системный пустой.
      </p>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <label className={`text-[11px] font-mono uppercase ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>Символ:</label>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          className={`text-xs font-mono px-2 py-1 rounded border ${isLight ? 'bg-white border-slate-300' : 'bg-slate-900/40 border-white/10 text-slate-100'}`}
        />
        <button
          onClick={() => void saveFromActiveSlot('tf')}
          className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
          title={`Сохранить активный график (${slot.symbol}/${slot.market}/${slot.timeframe}) как дефолт для этого ТФ`}
        >
          <Save className="w-3 h-3" />
          Сохранить из графика — этот ТФ
        </button>
        <button
          onClick={() => void saveFromActiveSlot('all-tf')}
          className="px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
          title={`Сохранить активный график (${slot.symbol}/${slot.market}) как scope=all-tf дефолт`}
        >
          <Save className="w-3 h-3" />
          Сохранить из графика — все ТФ
        </button>
      </div>

      {message && <div className="text-emerald-500 text-[11px] mb-2 font-mono">{message}</div>}
      {error && <div className="text-rose-500 text-[11px] mb-2 font-mono">{error}</div>}
      {loading ? (
        <div className="text-slate-400 text-center py-6 text-xs">Загрузка...</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-400 text-center py-6 text-xs italic">Нет админ-дефолтов для {symbol}</div>
      ) : (
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className={`text-left uppercase ${isLight ? 'text-slate-600' : 'text-slate-400'} border-b ${isLight ? 'border-slate-200' : 'border-white/5'}`}>
              <th className="py-2 pr-3">Рынок</th>
              <th className="py-2 pr-3">ТФ</th>
              <th className="py-2 pr-3">Кол-во</th>
              <th className="py-2 pr-3">Обновлено</th>
              <th className="py-2 pr-3 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.symbol}/${row.market}/${row.timeframe}/${i}`}
                  className={`border-b ${isLight ? 'border-slate-100' : 'border-white/5'}`}>
                <td className="py-2 pr-3">{row.market}</td>
                <td className="py-2 pr-3 font-bold">{row.timeframe === '*' ? <span className="text-indigo-500">all-tf</span> : row.timeframe}</td>
                <td className="py-2 pr-3">{row.indicators.length}</td>
                <td className="py-2 pr-3 text-slate-500">{row.updatedAt}</td>
                <td className="py-2 pr-3 text-right">
                  <button
                    onClick={() => void handleDelete(row)}
                    className="px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/40 text-rose-500 cursor-pointer"
                    title="Удалить дефолт"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function StatsTabPlaceholder({ isLight }: { isLight: boolean }) {
  return (
    <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-purple-500 uppercase">
        <BarChart2 className="w-4 h-4" />
        Billing & Subscriptions — Coming in Phase 4
      </div>
      <p className="text-sm text-slate-500 mt-3">Revenue analytics, payment records, subscription management.</p>
    </div>
  )
}
