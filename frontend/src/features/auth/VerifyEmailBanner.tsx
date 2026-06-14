import { useAuthContext } from './AuthContext'
import { useTranslation } from '@/i18n'
import { apiResendVerification } from './api'
import { useState, useCallback } from 'react'

export function VerifyEmailBanner() {
  const { user } = useAuthContext()
  const { t } = useTranslation()
  const [sent, setSent] = useState(false)

  const handleResend = useCallback(async () => {
    try {
      await apiResendVerification()
      setSent(true)
    } catch { /* ignore */ }
  }, [])

  if (!user || user.emailVerified) return null

  return (
    <div className="fixed top-12 left-0 right-0 z-[99998] flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs">
      <span>{t('auth.verifyEmailBanner')}</span>
      {!sent ? (
        <button onClick={handleResend} className="underline font-bold hover:text-amber-300 cursor-pointer">
          {t('auth.resendEmail')}
        </button>
      ) : (
        <span className="text-amber-500/60">{t('auth.emailSent')}</span>
      )}
    </div>
  )
}
