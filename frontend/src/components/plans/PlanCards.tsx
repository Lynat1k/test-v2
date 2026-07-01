import type { PublicTierPolicy } from '@/features/auth/api'

// Extracted from UserProfile.tsx unchanged so the profile page and the
// upgrade modal (PlansModal) share one implementation. Behavior is 1:1.

export function formatHistoryValue(days: number | undefined, t: (key: string) => string): number | string {
  if (days === undefined) return '—'
  if (days < 0) return days  // LimitRow renders < 0 numbers as 'Безлимитно' (no suffix)
  return `${days} ${t('profile.historyDaySuffix')}`
}

export function LimitRow({ label, value, t }: {
  label: string; value: number | string | boolean; t: (key: string) => string
}) {
  let display: string
  let color: string

  if (typeof value === 'boolean') {
    display = value ? t('profile.yes') : t('profile.no')
    color = value ? 'text-[#10B981]' : 'text-[#EF4444]'
  } else if (typeof value === 'number') {
    if (value < 0) {
      display = t('profile.unlimited')
      color = 'text-[#10B981]'
    } else {
      display = String(value)
      color = ''
    }
  } else {
    display = value
    color = ''
  }

  return (
    <div className="flex justify-between py-1 border-b border-current/[0.06]">
      <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">{label}</span>
      <span className={`font-extrabold ${color}`}>{display}</span>
    </div>
  )
}

export function PlanCard({
  name, price, desc, isActive, popular,
  policy, userRole, t, isLight,
}: {
  name: string; price: string; desc: string; isActive: boolean; popular?: boolean
  policy: PublicTierPolicy
  userRole: string; t: (key: string) => string; isLight?: boolean
}) {
  const isPro = name === 'Pro'
  const isVIP = name === 'VIP'

  const baseCard = `p-6 rounded-[24px] flex flex-col justify-between gap-6 transition-all duration-300 group relative ${isLight ? 'text-slate-900' : 'text-white'}`
  const glassOrWhite = isLight ? 'bg-white shadow-lg' : 'liquid-glass-card'
  let cardStyle: string
  if (isActive) {
    if (isVIP) cardStyle = `${baseCard} ${glassOrWhite} border border-amber-500/30 shadow-[0_0_35px_rgba(245,158,11,0.32)] scale-[1.035] -translate-y-1`
    else if (isPro) cardStyle = `${baseCard} ${glassOrWhite} border border-[#2FD3B2]/30 shadow-[0_0_35px_rgba(45,212,178,0.32)] scale-[1.035] -translate-y-1`
    else cardStyle = `${baseCard} ${glassOrWhite} border border-emerald-500/20 shadow-[0_0_35px_rgba(16,185,129,0.24)] scale-[1.035] -translate-y-1`
  } else {
    if (isLight) {
      if (isVIP) cardStyle = `${baseCard} ${glassOrWhite} border border-slate-200 hover:border-amber-400 hover:shadow-[0_0_25px_rgba(245,158,11,0.15)] hover:scale-[1.03] hover:-translate-y-1`
      else if (isPro) cardStyle = `${baseCard} ${glassOrWhite} border border-slate-200 hover:border-[#2FD3B2] hover:shadow-[0_0_25px_rgba(45,212,178,0.15)] hover:scale-[1.03] hover:-translate-y-1`
      else cardStyle = `${baseCard} ${glassOrWhite} border border-slate-200 hover:border-slate-300 hover:shadow-lg hover:scale-[1.03] hover:-translate-y-1`
    } else {
      if (isVIP) cardStyle = `${baseCard} liquid-glass-card border border-white/[0.06] hover:border-amber-500/40 hover:shadow-[0_0_35px_rgba(245,158,11,0.28)] hover:bg-amber-500/[0.02] hover:scale-[1.03] hover:-translate-y-1`
      else if (isPro) cardStyle = `${baseCard} liquid-glass-card border border-white/[0.06] hover:border-[#2FD3B2]/40 hover:shadow-[0_0_35px_rgba(45,212,178,0.28)] hover:bg-[#2FD3B2]/[0.02] hover:scale-[1.03] hover:-translate-y-1`
      else cardStyle = `${baseCard} liquid-glass-card border border-white/[0.06] hover:border-white/20 hover:shadow-[0_0_25px_rgba(255,255,255,0.06)] hover:scale-[1.03] hover:-translate-y-1`
    }
  }

  return (
    <div className={cardStyle}>
      {/* Inner ambient top glow */}
      {isPro && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-20 bg-gradient-to-b from-[#2FD3B2]/15 to-transparent blur-xl pointer-events-none rounded-full transition-all duration-500 group-hover:from-[#2FD3B2]/40 group-hover:scale-130" />
      )}
      {isVIP && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-20 bg-gradient-to-b from-amber-500/10 to-transparent blur-xl pointer-events-none rounded-full transition-all duration-500 group-hover:from-amber-500/35 group-hover:scale-130" />
      )}

      {/* MOST POPULAR badge — only on Pro */}
      {popular && (
        <div className={`absolute -top-3 right-6 px-3 py-1 rounded-full text-[9px] font-extrabold uppercase tracking-wider shadow-md z-10 ${
          isLight ? 'bg-white border border-[#2FD3B2]/40 text-[#2FD3B2]' : 'bg-[#10191B] border border-[#2FD3B2]/30 text-[#2FD3B2]'
        }`}>
          {t('profile.popular')}
        </div>
      )}

      <div className="flex flex-col gap-5 relative z-10">
        <div>
          <span className={`text-sm font-bold tracking-normal block ${isVIP ? (isLight ? 'text-amber-700' : 'text-amber-200') : isPro ? '' : (isLight ? 'text-slate-700' : 'text-slate-300')}`}>
            {name}
          </span>
          <p className={`text-[9px] mt-1 uppercase tracking-wider font-mono ${isVIP ? (isLight ? 'text-amber-600/60' : 'text-amber-200/60') : isPro ? 'text-[#A6E8DB]' : (isLight ? 'text-slate-400' : 'text-slate-400')}`}>
            Billed monthly
          </p>
        </div>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-4xl font-black tracking-tight">{price}</span>
          <span className={`text-xs font-medium ml-1 ${isLight ? 'text-slate-500' : 'text-[#8B949E]'}`}>/ month</span>
        </div>
        <p className={`text-[11.5px] leading-relaxed min-h-[32px] ${isLight ? 'text-slate-500' : 'text-[#8B949E]'}`}>{desc}</p>
        <div className={`flex flex-col gap-2 font-mono text-[11px] pt-4 mt-2 border-t ${isLight ? 'border-slate-200' : 'border-white/[0.06]'}`}>
          <LimitRow label={t('profile.propsMaxHistory')} value={formatHistoryValue(policy.historyDaysPerTf?.['4h'], t)} t={t} />
          <LimitRow label={t('profile.propsCharts')} value={policy.workspacesCount} t={t} />
          <LimitRow label={t('profile.propsIndicators')} value={policy.maxIndicators} t={t} />
          <LimitRow label={t('profile.propsCustomSettings')} value={policy.customIndicatorSettings === 1} t={t} />
          <LimitRow label={t('profile.propsCompression')} value={policy.compressionMax} t={t} />
          <LimitRow label={t('profile.propsAnomalies')} value={policy.anomaliesEnabled === 1} t={t} />
          <LimitRow label={t('profile.propsSessionLimit')} value={policy.sessionLimit} t={t} />
          <LimitRow label={t('profile.propsTelegram')} value={policy.telegramEnabled === 1} t={t} />
        </div>
      </div>

      <div className="relative z-10 w-full">
        {isActive ? (
          <div className="w-full text-center py-2.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-500/10 text-slate-500 border border-slate-500/20">
            {t('profile.currentPlan')}
          </div>
        ) : (
          <button
            onClick={() => alert(t('profile.activateSoon'))}
            className={`w-full text-center py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer active:scale-95 ${
              isVIP
                ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-black shadow-md shadow-amber-500/20'
                : isPro
                  ? 'bg-[#1CD5A6] hover:bg-[#20ebd6] hover:scale-[1.01] text-slate-950 font-black shadow-[0_4px_25px_rgba(28,213,166,0.3)]'
                  : isLight
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300'
                    : 'bg-[#1F2228] hover:bg-[#282B33] text-white border border-white/10'
            }`}
          >
            {userRole === 'admin' || !isPro && !isVIP ? t('profile.activateFree') : t('profile.activate')}
          </button>
        )}
      </div>
    </div>
  )
}
