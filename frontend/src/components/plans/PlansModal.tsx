import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { X, Sparkles } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useTranslation } from '@/i18n'
import { useTiers } from '@/contexts/TiersContext'
import { useUserLimits } from '@/contexts/LimitsContext'
import { ChartLoader } from '@/components/ChartLoader'
import { PlanCard } from '@/components/plans/PlanCards'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/**
 * Global upgrade modal. Reuses the exact tier cards from the profile page
 * (PlanCard) and mirrors its loading/error handling (spinner / quietly empty).
 * Rendered into document.body at a very high z-index so it sits above every
 * other modal — including IndicatorsModal (z-[1200]) which can open it.
 */
export function PlansModal({ isOpen, onClose }: Props) {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const { t } = useTranslation()
  const { tiers, loading, error } = useTiers()
  const { limits } = useUserLimits()
  const tier = limits.tier

  // Esc closes.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const pricePro = Number(localStorage.getItem('procluster_price_pro')) || 19
  const priceVip = Number(localStorage.getItem('procluster_price_vip')) || 49

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: 'spring', duration: 0.4 }}
        className={`w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[32px] border relative flex flex-col shadow-2xl ${
          isLight ? 'bg-white border-slate-200 text-slate-900' : 'liquid-glass-card border-white/10 text-white'
        }`}
      >
        <div className="absolute top-0 right-1/4 w-[350px] h-[350px] bg-[#1CD5A6]/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-1/4 w-[350px] h-[350px] bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />

        {/* Header */}
        <div className="relative z-10 flex items-start justify-between gap-4 p-6 sm:p-8 pb-0">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-[#1CD5A6]/10 text-[#1CD5A6] border border-[#1CD5A6]/20 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className={`text-xl sm:text-2xl font-black tracking-tight font-sans ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {t('plans.modalTitle')}
              </h2>
              <p className={`text-[11px] sm:text-xs font-medium leading-snug mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {t('plans.modalSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className={`p-2 rounded-xl transition duration-200 cursor-pointer border shrink-0 ${
              isLight ? 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-500 hover:text-slate-700' : 'bg-white/5 hover:bg-white/10 border-white/5 text-slate-400 hover:text-slate-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — loading spinner / quietly empty on error / 3 tier cards */}
        <div className="relative z-10 p-6 sm:p-8">
          {loading ? (
            <div className="min-h-[240px] flex items-center justify-center">
              <ChartLoader theme={theme} />
            </div>
          ) : error || !tiers ? null : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mx-auto">
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
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
