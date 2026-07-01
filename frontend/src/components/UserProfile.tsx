import { useState, useEffect } from 'react'
import { useAuthContext } from '@/features/auth/AuthContext'
import { apiGetMe, apiUpdateProfile, apiChangePassword } from '@/features/auth/api'
import { useTheme } from '@/contexts/ThemeContext'
import { useTiers } from '@/contexts/TiersContext'
import { ChartLoader } from '@/components/ChartLoader'
import { PlanCard } from '@/components/plans/PlanCards'
import { useTranslation } from '@/i18n'
import { ArrowLeft, Check, ShieldCheck, CreditCard, Award } from 'lucide-react'
import { motion } from 'motion/react'

const AVATAR_PRESETS = [
  { key: 'avatar-1', label: '1', gradient: 'from-emerald-400 to-cyan-500' },
  { key: 'avatar-2', label: '2', gradient: 'from-blue-400 to-indigo-500' },
  { key: 'avatar-3', label: '3', gradient: 'from-amber-400 to-orange-500' },
  { key: 'avatar-4', label: '4', gradient: 'from-rose-400 to-pink-500' },
  { key: 'avatar-5', label: '5', gradient: 'from-violet-400 to-purple-500' },
]

interface ProfileData {
  id: string
  email: string
  nickname: string
  role: string
  emailVerified: boolean
  avatar: string
  createdAt: string
  subscriptionStatus: string
  subscriptionPaidAt: string
  subscriptionExpiresAt: string
  daysLeft: number
}

interface Props {
  onClose: () => void
}

export function UserProfile({ onClose }: Props) {
  const { user, setUser } = useAuthContext()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isLight = theme === 'light'

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [customAvatarUrl, setCustomAvatarUrl] = useState('')
  const [notification, setNotification] = useState('')
  const [error, setError] = useState('')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')

  const pricePro = Number(localStorage.getItem('procluster_price_pro')) || 19
  const priceVip = Number(localStorage.getItem('procluster_price_vip')) || 49

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiGetMe()
        if (cancelled) return
        setProfile(data)
        setNickname(data.nickname || user?.nickname || '')
        setAvatar(data.avatar || user?.avatar || '')
      } catch {
        if (!cancelled) {
          setProfile({
            id: user?.id || '',
            email: user?.email || '',
            nickname: user?.nickname || '',
            role: user?.role || 'free',
            emailVerified: user?.emailVerified || false,
            avatar: user?.avatar || '',
            createdAt: '',
            subscriptionStatus: user?.subscriptionStatus || 'active',
            subscriptionPaidAt: user?.subscriptionPaidAt || '',
            subscriptionExpiresAt: user?.subscriptionExpiresAt || '',
            daysLeft: 0,
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setNotification('')
    const finalAvatar = customAvatarUrl.trim() || avatar
    try {
      await apiUpdateProfile(nickname.trim(), finalAvatar)
      // Update auth context with new nickname/avatar
      if (user) {
        setUser({ ...user, nickname: nickname.trim(), avatar: finalAvatar })
      }
      setNotification(t('profile.savedSuccess'))
      setTimeout(() => setNotification(''), 3000)
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : 'Error'
      setError(msg)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    setPwSuccess('')
    if (newPassword !== confirmPassword) {
      setPwError(t('auth.errorPasswordsMismatch'))
      return
    }
    if (newPassword.length < 8) {
      setPwError(t('auth.errorPasswordTooShort'))
      return
    }
    try {
      await apiChangePassword(currentPassword, newPassword)
      setPwSuccess(t('profile.passwordChanged'))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      // Force re-login after 2s
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : ''
      if (code === 'INVALID_PASSWORD') {
        setPwError(t('profile.wrongPassword'))
      } else {
        setPwError(t('auth.errorGeneric'))
      }
    }
  }

  const tier = (profile?.role || user?.role || 'free') as string
  const tierDisplay = tier === 'vip' ? 'VIP' : tier === 'pro' ? 'Pro' : tier === 'admin' ? 'Admin' : 'Free'
  const { tiers, loading: tiersLoading, error: tiersError } = useTiers()

  if (loading) {
    return (
      <div className={`flex-1 min-h-0 flex items-center justify-center font-mono text-sm ${isLight ? 'text-slate-400' : 'text-white/40'}`}>
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full max-w-7xl mx-auto px-6 py-10 relative z-40 flex flex-col gap-8 select-text">
        {/* Nav header */}
      <div className="flex items-center justify-between shrink-0">
        <button
          onClick={onClose}
          className="group flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide cursor-pointer transition border liquid-glass-button hover:scale-[1.02] active:scale-[0.98]"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500 group-hover:-translate-x-1 transition-transform" />
          <span>{t('profile.backToTerminal')}</span>
        </button>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs font-black uppercase bg-emerald-500/10 border border-emerald-500/35 text-emerald-500 px-5 py-2.5 rounded-2xl flex items-center gap-2 shadow-lg"
          >
            <Check className="w-4 h-4" />
            <span>{notification}</span>
          </motion.div>
        )}
      </div>

      {/* Hero Section */}
      <div className={`shrink-0 py-8 px-6 rounded-[24px] relative overflow-hidden flex flex-col md:flex-row items-center gap-6 ${isLight ? 'bg-white border border-slate-200 shadow-lg' : 'liquid-glass-card'}`}>
        <div className={`absolute top-0 right-0 w-85 h-64 rounded-full blur-[80px] pointer-events-none ${
          tier === 'vip' ? 'bg-amber-500/10' : tier === 'pro' ? 'bg-blue-500/10' : 'bg-slate-500/5'
        }`} />

        <div className="relative group select-none shrink-0">
          <AvatarDisplay avatar={avatar} customUrl={customAvatarUrl} nickname={nickname} tier={tier} />
          <div className={`absolute -bottom-1 -right-1 p-2 rounded-full border shadow ${
            tier === 'vip' ? 'bg-amber-500 border-amber-600 text-slate-900'
              : tier === 'pro' ? 'bg-blue-500 border-blue-600 text-white'
                : 'bg-slate-500 border-slate-600 text-white'
          }`}>
            <Award className="w-5 h-5 animate-bounce" />
          </div>
        </div>

        <div className="flex-1 text-center md:text-left min-w-0">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mb-2">
            <h1 className={`text-2xl sm:text-3xl font-black font-sans leading-none truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {nickname}
            </h1>
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest leading-none border ${
              tier === 'vip' ? 'bg-amber-500/15 border-amber-500/35 text-amber-500 shadow animate-pulse'
                : tier === 'pro' ? 'bg-blue-500/15 border-blue-500/35 text-blue-400 shadow'
                  : 'bg-slate-500/15 border-slate-500/35 text-slate-400'
            }`}>
              {tierDisplay}
            </span>
          </div>
          <p className={`text-xs sm:text-sm max-w-xl ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            {t('profile.personalInfo')}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center md:justify-start gap-x-6 gap-y-2 font-mono text-[11px]">
            <span className={isLight ? 'text-slate-700' : 'text-slate-300'}>{profile?.email || user?.email}</span>
            <span className={isLight ? 'text-slate-500' : 'text-slate-400'}>{t('profile.regDate')}: {(profile?.createdAt || '').slice(0, 10) || '—'}</span>
          </div>
        </div>
      </div>

      {/* Two-Column Grid: Form + Subscription */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
        {/* Profile Form */}
        <div className={`lg:col-span-2 p-6 rounded-[28px] flex flex-col gap-5 ${isLight ? 'bg-white border border-slate-200 shadow-lg' : 'liquid-glass-card'}`}>
          <h2 className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
            {t('profile.personalInfo')}
          </h2>
          <form onSubmit={handleSaveProfile} className="flex flex-col gap-4 font-sans text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={`text-[10px] font-mono font-black block mb-1 uppercase ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {t('profile.username')}
                </label>
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className={`w-full rounded-xl px-4 py-2.5 text-xs font-black border ${isLight ? 'bg-slate-50 border-slate-300 text-slate-900' : 'bg-slate-950/60 border-white/10 text-slate-200'} focus:border-emerald-500/50`}
                />
              </div>
              <div>
                <label className={`text-[10px] font-mono font-black block mb-1 uppercase ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {t('profile.email')}
                </label>
                <input
                  type="email"
                  readOnly
                  value={profile?.email || user?.email || ''}
                  className={`w-full rounded-xl px-4 py-2.5 text-xs font-black border cursor-not-allowed ${isLight ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-slate-950/30 border-white/5 text-slate-500'}`}
                />
              </div>
            </div>

            {/* Avatar selection */}
            <div>
              <label className={`text-[10px] font-mono font-black block mb-1 uppercase ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {t('profile.avatarSelect')}
              </label>
              <div className="flex flex-wrap gap-2 mb-3">
                {AVATAR_PRESETS.map((preset) => {
                  const isSelected = avatar === preset.key && !customAvatarUrl.trim()
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => { setAvatar(preset.key); setCustomAvatarUrl('') }}
                      className={`relative w-12 h-12 rounded-full cursor-pointer overflow-hidden border-2 transition-transform duration-200 hover:scale-110 active:scale-95 ${
                        isSelected ? 'border-emerald-500 scale-105' : 'border-white/10'
                      }`}
                    >
                      <div className={`w-full h-full bg-gradient-to-br ${preset.gradient} flex items-center justify-center`}>
                        <span className="text-white text-sm font-bold">{preset.label}</span>
                      </div>
                      {isSelected && (
                        <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white drop-shadow" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              <label className={`text-[9px] font-mono font-bold block mb-1 uppercase ${isLight ? 'text-slate-500' : 'text-slate-400/80'}`}>
                {t('profile.orCustomUrl')}
              </label>
              <input
                type="url"
                placeholder="https://example.com/avatar.png"
                value={customAvatarUrl}
                onChange={(e) => setCustomAvatarUrl(e.target.value)}
                className={`w-full rounded-xl px-4 py-2.5 text-xs font-semibold border ${isLight ? 'bg-slate-50 border-slate-300 text-slate-900' : 'bg-slate-950/60 border-white/10 text-slate-200'} focus:border-emerald-500/50`}
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 font-bold">{error}</p>
            )}

            <button
              type="submit"
              className="mt-2 py-3 px-5 rounded-xl font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-2 cursor-pointer border transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
            >
              <ShieldCheck className="w-4 h-4" />
              {t('profile.saveChanges')}
            </button>
          </form>
        </div>

        {/* Subscription Info Card */}
        <div className={`p-6 rounded-[28px] flex flex-col justify-between gap-5 ${isLight ? 'bg-white border border-slate-200 shadow-lg' : 'liquid-glass-card'}`}>
          <div className="flex flex-col gap-5">
            <h2 className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
              <CreditCard className="w-4 h-4 text-amber-500" />
              {t('profile.subInfo')}
            </h2>
            <div className="flex flex-col gap-3 font-mono text-xs">
              {/* Tier badge */}
              <div className="p-3.5 rounded-2xl flex items-center justify-between border bg-white/[0.02] border-white/5">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t('profile.tierStatus')}</span>
                <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide leading-none ${
                  tier === 'vip' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                    : tier === 'pro' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                }`}>
                  {tierDisplay}
                </span>
              </div>

              <InfoRow label={t('profile.paymentDate')} value={profile?.subscriptionPaidAt || '—'} />
              <InfoRow label={t('profile.expiryDate')} value={profile?.subscriptionExpiresAt || (tier === 'free' ? t('profile.daysRemaining') : '—')} highlight={tier === 'free'} />
              <InfoRow label={t('profile.daysRemaining')} value={profile && profile.daysLeft > 0 ? `${profile.daysLeft}d` : (tier === 'free' ? t('profile.daysRemaining') : '0d')} highlight={tier === 'free'} amber={!!(profile && profile.daysLeft > 0 && profile.daysLeft <= 7)} />
              <div className="flex items-center justify-between py-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Status</span>
                <span className="flex items-center gap-1.5 text-[11px] font-black text-emerald-500">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{t('profile.statusActive')}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="text-[9px] font-mono text-slate-500 leading-normal text-center bg-slate-500/5 p-2.5 rounded-xl border border-white/[0.02]">
            {t('profile.propsCharts')}: {tier === 'vip' ? '2' : tier === 'pro' ? '2' : '1'} | {t('profile.propsIndicators')}: {tier === 'vip' ? t('profile.yes') : tier === 'pro' ? '3' : '1'}
          </div>
        </div>
      </div>

      {/* Change Password Section */}
      <div className={`p-6 rounded-[28px] ${isLight ? 'bg-white border border-slate-200 shadow-lg' : 'liquid-glass-card'}`}>
        <h2 className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 mb-4 ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
          {t('profile.changePassword')}
        </h2>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4 font-sans text-xs max-w-lg">
          <div>
            <label className={`text-[10px] font-mono font-black block mb-1 uppercase ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {t('profile.currentPassword')}
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={`w-full rounded-xl px-4 py-2.5 text-xs font-black border ${isLight ? 'bg-slate-50 border-slate-300 text-slate-900' : 'bg-slate-950/60 border-white/10 text-slate-200'} focus:border-emerald-500/50`}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={`text-[10px] font-mono font-black block mb-1 uppercase ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {t('profile.newPassword')}
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full rounded-xl px-4 py-2.5 text-xs font-black border ${isLight ? 'bg-slate-50 border-slate-300 text-slate-900' : 'bg-slate-950/60 border-white/10 text-slate-200'} focus:border-emerald-500/50`}
              />
            </div>
            <div>
              <label className={`text-[10px] font-mono font-black block mb-1 uppercase ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {t('profile.confirmPassword')}
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full rounded-xl px-4 py-2.5 text-xs font-black border ${isLight ? 'bg-slate-50 border-slate-300 text-slate-900' : 'bg-slate-950/60 border-white/10 text-slate-200'} focus:border-emerald-500/50`}
              />
            </div>
          </div>
          {pwError && <p className="text-xs text-red-400 font-bold">{pwError}</p>}
          {pwSuccess && <p className="text-xs text-emerald-400 font-bold">{pwSuccess}</p>}
          <button
            type="submit"
            className="mt-1 py-3 px-5 rounded-xl font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-2 cursor-pointer border transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-400"
          >
            {t('profile.changePassword')}
          </button>
        </form>
      </div>

      {/* Plans Comparison — driven by public tier policies (useTiers) */}
      {tiersLoading ? (
        <div className={`p-8 sm:p-12 rounded-[32px] flex flex-col gap-10 relative overflow-hidden ${isLight ? 'bg-white border border-slate-200 shadow-lg' : 'liquid-glass-card'}`}>
          <div className="text-center space-y-2 z-10">
            <h2 className={`text-3xl sm:text-4xl font-extrabold tracking-tight font-sans ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {t('profile.choosePlan')}
            </h2>
          </div>
          <div className="min-h-[240px] flex items-center justify-center z-10">
            <ChartLoader theme={theme} />
          </div>
        </div>
      ) : tiersError || !tiers ? null : (
        <div className={`p-8 sm:p-12 rounded-[32px] flex flex-col gap-10 relative overflow-hidden ${isLight ? 'bg-white border border-slate-200 shadow-lg' : 'liquid-glass-card'}`}>
          <div className="absolute top-0 right-1/4 w-[350px] h-[350px] bg-[#1CD5A6]/5 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute bottom-0 left-1/4 w-[350px] h-[350px] bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />

          <div className="text-center space-y-2 z-10">
            <h2 className={`text-3xl sm:text-4xl font-extrabold tracking-tight font-sans ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {t('profile.choosePlan')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mx-auto z-10">
            <PlanCard
              name="Free" price="$0" desc={t('profile.planFreeDesc')} isActive={tier === 'free'}
              policy={tiers.free} userRole={tier} t={t} isLight={isLight}
            />
            <PlanCard
              name="Pro" price={`$${pricePro}`} desc={t('profile.planProDesc')} isActive={tier === 'pro'} popular
              policy={tiers.pro} userRole={tier} t={t} isLight={isLight}
            />
            <PlanCard
              name="VIP" price={`$${priceVip}`} desc={t('profile.planVipDesc')} isActive={tier === 'vip'}
              policy={tiers.vip} userRole={tier} t={t} isLight={isLight}
            />
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

// --- Sub-components ---

function AvatarDisplay({ avatar, customUrl, nickname, tier }: { avatar: string; customUrl: string; nickname: string; tier: string }) {
  const displayUrl = customUrl.trim() || ''
  const preset = AVATAR_PRESETS.find(p => p.key === avatar)

  if (displayUrl) {
    return (
      <img
        src={displayUrl}
        alt={nickname}
        referrerPolicy="no-referrer"
        className={`w-[84px] h-[84px] md:w-[100px] md:h-[100px] rounded-full object-cover border-4 shadow-xl transition-transform duration-300 group-hover:scale-105 ${
          tier === 'vip' ? 'border-amber-500/40 shadow-amber-500/10'
            : tier === 'pro' ? 'border-blue-500/40 shadow-blue-500/10'
              : 'border-slate-400/20'
        }`}
      />
    )
  }

  if (preset) {
    return (
      <div className={`w-[84px] h-[84px] md:w-[100px] md:h-[100px] rounded-full border-4 shadow-xl bg-gradient-to-br ${preset.gradient} flex items-center justify-center transition-transform duration-300 group-hover:scale-105 ${
        tier === 'vip' ? 'border-amber-500/40 shadow-amber-500/10'
          : tier === 'pro' ? 'border-blue-500/40 shadow-blue-500/10'
            : 'border-slate-400/20'
      }`}>
        <span className="text-white text-2xl font-bold">{preset.label}</span>
      </div>
    )
  }

  // Default: initials from nickname
  const initials = (nickname || 'U').slice(0, 2).toUpperCase()
  return (
    <div className={`w-[84px] h-[84px] md:w-[100px] md:h-[100px] rounded-full border-4 shadow-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center transition-transform duration-300 group-hover:scale-105 ${
      tier === 'vip' ? 'border-amber-500/40 shadow-amber-500/10'
        : tier === 'pro' ? 'border-blue-500/40 shadow-blue-500/10'
          : 'border-slate-400/20'
    }`}>
      <span className="text-white text-2xl font-bold">{initials}</span>
    </div>
  )
}

function InfoRow({ label, value, highlight, amber }: { label: string; value: string; highlight?: boolean; amber?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</span>
      <span className={`text-[11px] font-bold ${
        highlight ? 'text-emerald-500' : amber ? 'text-amber-500' : 'text-slate-200'
      }`}>
        {value}
      </span>
    </div>
  )
}
