import { useEffect, useState, useCallback } from 'react'
import { motion } from 'motion/react'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { useTheme } from '@/contexts/ThemeContext'
import { apiVerifyEmail, apiResendVerification } from './api'
import { useAuthContext } from './AuthContext'

type Status = 'loading' | 'success' | 'error'

export function VerifyEmailPage() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const { user } = useAuthContext()

  const [status, setStatus] = useState<Status>('loading')
  const [errorCode, setErrorCode] = useState<string>('')
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token') ?? ''
    if (!token) {
      setStatus('error')
      setErrorCode('INVALID_TOKEN')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await apiVerifyEmail(token)
        if (!cancelled) setStatus('success')
      } catch (err: any) {
        if (cancelled) return
        setErrorCode(err?.code ?? 'GENERIC')
        setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleContinue = useCallback(() => {
    window.location.href = '/'
  }, [])

  const handleResend = useCallback(async () => {
    setResendState('sending')
    try {
      await apiResendVerification()
      setResendState('sent')
    } catch {
      setResendState('error')
    }
  }, [])

  const errorText =
    errorCode === 'TOKEN_EXPIRED' ? t('auth.verifyPageErrorExpired')
    : errorCode === 'TOKEN_USED' ? t('auth.verifyPageErrorUsed')
    : errorCode === 'INVALID_TOKEN' ? t('auth.verifyPageErrorInvalid')
    : t('auth.verifyPageErrorGeneric')

  return (
    <div className={`h-screen min-h-[100dvh] w-screen flex items-center justify-center overflow-hidden relative ${
      isLight ? 'light bg-[#cbd5e1] text-slate-900' : 'bg-[#030712]/92 text-white terminal-grid'
    }`} style={{ height: '100dvh' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className={`absolute top-[5%] left-[3%] w-[450px] h-[450px] rounded-full liquid-blob-cyan blur-[100px] ${isLight ? 'opacity-15' : 'opacity-40'}`} />
        <div className={`absolute top-[50%] right-[5%] w-[550px] h-[550px] rounded-full liquid-blob-magenta blur-[120px] ${isLight ? 'opacity-10' : 'opacity-35'}`} />
        <div className={`absolute bottom-[2%] left-[10%] w-[380px] h-[380px] rounded-full liquid-blob-gold blur-[100px] ${isLight ? 'opacity-10' : 'opacity-30'}`} />
      </div>

      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.18 }}
        className={`relative z-10 rounded-2xl p-7 w-[420px] max-w-[92vw] ${isLight ? 'bg-white border border-slate-200 shadow-2xl' : 'liquid-glass-card'}`}
      >
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-2">
            <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
            <h2 className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {t('auth.verifyPageLoading')}
            </h2>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 py-2">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            <h2 className={`text-base font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {t('auth.verifyPageSuccess')}
            </h2>
            <p className={`text-xs text-center ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {t('auth.verifyPageSuccessHint')}
            </p>
            <button
              onClick={handleContinue}
              className={`mt-2 px-4 py-2 rounded-lg text-xs font-bold border cursor-pointer ${
                isLight
                  ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                  : 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
              }`}
            >
              {t('auth.verifyPageContinue')}
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-2">
            <XCircle className="w-12 h-12 text-red-400" />
            <h2 className={`text-base font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {t('auth.verifyPageErrorTitle')}
            </h2>
            <p className={`text-xs text-center ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {errorText}
            </p>

            {user ? (
              <>
                {resendState === 'sent' ? (
                  <span className="mt-2 text-xs text-emerald-400">{t('auth.emailSent')}</span>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={resendState === 'sending'}
                    className={`mt-2 px-4 py-2 rounded-lg text-xs font-bold border cursor-pointer disabled:opacity-50 ${
                      isLight
                        ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                        : 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                    }`}
                  >
                    {resendState === 'sending' ? t('common.loading') : t('auth.verifyPageResend')}
                  </button>
                )}
                {resendState === 'error' && (
                  <span className="text-xs text-red-400">{t('auth.errorGeneric')}</span>
                )}
              </>
            ) : (
              <span className={`mt-1 text-[11px] text-center ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {t('auth.verifyPageResendNoAuth')}
              </span>
            )}

            <button
              onClick={handleContinue}
              className={`mt-1 text-[11px] underline cursor-pointer ${isLight ? 'text-slate-500 hover:text-slate-700' : 'text-slate-400 hover:text-white'}`}
            >
              {t('auth.verifyPageContinue')}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}
