import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useTranslation } from '@/i18n'
import { useAuthContext } from '@/features/auth/AuthContext'
import { motion, AnimatePresence } from 'motion/react'
import {
  ArrowLeft,
  Settings,
  Cpu,
  Database,
  Users,
  BarChart2,
  Activity,
} from 'lucide-react'
import { apiGetMetrics, apiGetMetricsHistory, type ServerMetrics, type MetricsHistoryPoint } from '@/features/admin/api'

type AdminTab = 'server' | 'database' | 'users' | 'stats'

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
    { key: 'stats', label: t('admin.tabs.stats'), icon: BarChart2, color: 'purple' },
  ]

  return (
    <div className={`flex-1 flex flex-col min-h-0 relative z-40 overflow-y-auto p-6 gap-6 font-sans select-none ${
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
          {activeTab === 'database' && <DatabaseTabPlaceholder isLight={isLight} />}
          {activeTab === 'users' && <UsersTabPlaceholder isLight={isLight} />}
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
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 items-stretch">
      {/* LEFT: Metrics + DB Size + Users */}
      <div className={`h-full p-5 rounded-2xl border flex flex-col gap-3 ${
        isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'
      }`}>
        <div className="flex items-center gap-2 text-xs font-bold font-mono text-slate-400 uppercase shrink-0">
          <Cpu className="w-4 h-4 animate-pulse" />
          {t('admin.server.resourceMonitoring')}
        </div>

        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <MetricCard
            isLight={isLight}
            label={t('admin.server.cpu')}
            value={metrics ? `${metrics.cpu.usagePercent.toFixed(1)}%` : '---'}
            sub={metrics ? `${metrics.cpu.usagePercent.toFixed(1)}% ${t('admin.server.load')}` : ''}
            percent={metrics?.cpu.usagePercent ?? 0}
            color="amber"
            historyData={history.map(h => h.cpuPercent)}
          />
          <MetricCard
            isLight={isLight}
            label={t('admin.server.ram')}
            value={metrics ? `${metrics.ram.percent.toFixed(1)}%` : '---'}
            sub={metrics ? `${metrics.ram.usedGB.toFixed(1)} / ${metrics.ram.totalGB.toFixed(1)} GB` : ''}
            percent={metrics?.ram.percent ?? 0}
            color="emerald"
            historyData={history.map(h => h.ramPercent)}
          />
          <MetricCard
            isLight={isLight}
            label={t('admin.server.disk')}
            value={metrics ? `${metrics.disk.usagePercent.toFixed(1)}%` : '---'}
            sub={metrics ? `${metrics.disk.usedGB.toFixed(1)} / ${metrics.disk.totalGB.toFixed(1)} GB` : ''}
            percent={metrics?.disk.usagePercent ?? 0}
            color="blue"
            historyData={history.map(h => h.diskPercent)}
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

      {/* RIGHT: Log Console (full height) */}
      <div className={`flex-1 flex flex-col min-h-[400px] lg:min-h-0 rounded-2xl p-5 border gap-3 ${
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

        <div className={`flex-1 min-h-[220px] rounded-xl p-4 font-mono text-[10.5px] overflow-y-auto leading-relaxed border select-text shadow-inner ${
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

function MetricCard({ isLight, label, value, sub, percent, color, historyData }: {
  isLight: boolean
  label: string
  value: string
  sub: string
  percent: number
  color: string
  historyData: number[]
}) {
  const barColor = {
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
  }[color] || 'bg-slate-500'

  return (
    <div className={`flex-1 min-h-0 p-3 rounded-xl border flex flex-col justify-between gap-2 transition-all ${
      isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-white/[0.01] border-white/5'
    }`}>
      <div className="flex justify-between items-center text-xs">
        <span className={`font-bold flex items-center gap-1.5 ${isLight ? 'text-slate-800' : 'text-white'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${color === 'amber' ? 'bg-amber-500 animate-ping' : color === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse'}`} />
          <span>{label}</span>
        </span>
        <span className={`font-mono font-bold ${
          color === 'amber' ? (isLight ? 'text-amber-600' : 'text-amber-500') :
          color === 'emerald' ? (isLight ? 'text-emerald-600' : 'text-emerald-500') :
          (isLight ? 'text-blue-600' : 'text-blue-400')
        }`}>{value}</span>
      </div>

      <div className={`h-2 w-full ${isLight ? 'bg-slate-200' : 'bg-slate-900'} rounded-full overflow-hidden`}>
        <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>

      <div className={`text-[10px] ${isLight ? 'text-slate-600' : 'text-slate-400'} font-mono`}>{sub}</div>

      {/* 24h Daily Chart */}
      <div className="flex flex-col gap-1 min-h-0 flex-1">
        <span className={`text-[9px] ${isLight ? 'text-slate-500' : 'text-slate-400'} font-mono uppercase tracking-wider`}>
          {historyData.length > 0 ? `${historyData.length} ${label} (24h)` : `${label} (24h)`}
        </span>
        <div className={`flex-1 w-full min-h-[40px] ${isLight ? 'bg-slate-100/80' : 'bg-black/30'} rounded-lg p-1.5 border ${isLight ? 'border-slate-300/40' : 'border-white/[0.02]'}`}>
          <DailyChart data={historyData} color={color} maxVal={100} />
        </div>
      </div>
    </div>
  )
}

function DailyChart({ data, color, maxVal }: { data: number[]; color: string; maxVal: number }) {
  if (data.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-500 font-mono">Collecting data...</div>
  }

  const w = 300
  const h = 48
  const strokeColor = { amber: '#f59e0b', emerald: '#10b981', blue: '#3b82f6' }[color] || '#94a3b8'

  if (data.length === 1) {
    const y = h - (data[0]! / maxVal) * (h - 8) - 4
    return (
      <svg className="w-full h-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={h * 0.5} x2={w} y2={h * 0.5} stroke="currentColor" className="text-slate-400/20" strokeDasharray="3 3" />
        <circle cx={w / 2} cy={y} r="3" fill={strokeColor} />
      </svg>
    )
  }

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (v / maxVal) * (h - 8) - 4
    return { x, y }
  })
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`

  return (
    <svg className="w-full h-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={h * 0.5} x2={w} y2={h * 0.5} stroke="currentColor" className="text-slate-400/20" strokeDasharray="3 3" />
      <path d={areaD} fill={`url(#grad-${color})`} />
      <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.length > 0 && <circle cx={points[points.length - 1]!.x} cy={points[points.length - 1]!.y} r="2" fill={strokeColor} />}
    </svg>
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

function DatabaseTabPlaceholder({ isLight }: { isLight: boolean }) {
  return (
    <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-emerald-500 uppercase">
        <Database className="w-4 h-4" />
        Tickers & History Loader — Coming in Phase 3
      </div>
      <p className="text-sm text-slate-500 mt-3">Add tickers, configure compressions, download history from Binance Vision.</p>
    </div>
  )
}

function UsersTabPlaceholder({ isLight }: { isLight: boolean }) {
  return (
    <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-amber-500 uppercase">
        <Users className="w-4 h-4" />
        User Management & Policies — Coming in Phase 2
      </div>
      <p className="text-sm text-slate-500 mt-3">User CRUD, tier policy editor, session limits configuration.</p>
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
