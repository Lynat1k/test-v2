import { useState } from 'react'
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
} from 'lucide-react'

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
          {activeTab === 'server' && <ServerTabPlaceholder isLight={isLight} />}
          {activeTab === 'database' && <DatabaseTabPlaceholder isLight={isLight} />}
          {activeTab === 'users' && <UsersTabPlaceholder isLight={isLight} />}
          {activeTab === 'stats' && <StatsTabPlaceholder isLight={isLight} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// --- Placeholder tabs (to be implemented in subsequent phases) ---

function ServerTabPlaceholder({ isLight }: { isLight: boolean }) {
  return (
    <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200' : 'liquid-glass-card'}`}>
      <div className="flex items-center gap-2 text-xs font-bold font-mono text-slate-400 uppercase">
        <Cpu className="w-4 h-4 animate-pulse" />
        Server Metrics — Coming in Phase 1
      </div>
      <p className="text-sm text-slate-500 mt-3">Real-time CPU, RAM, Disk metrics with gopsutil. Diagnostic logs.</p>
    </div>
  )
}

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
