import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuthContext } from './AuthContext'
import { apiLogin } from './api'

interface LoginModalProps {
  open: boolean
  onClose: () => void
  onSwitchToRegister: () => void
}

export function LoginModal({ open, onClose, onSwitchToRegister }: LoginModalProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const { setAccessToken, setUser } = useAuthContext()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) { setEmail(''); setPassword(''); setError(''); setLoading(false) }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && open) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await apiLogin(email, password)
      setAccessToken(data.accessToken)
      setUser(data.user)
      onClose()
    } catch (err: any) {
      if (err.code === 'INVALID_CREDENTIALS') setError(t('auth.errorInvalidCredentials'))
      else if (err.code === 'ACCOUNT_LOCKED') setError(t('auth.errorAccountLocked'))
      else if (err.code === 'RATE_LIMITED') setError(t('auth.errorRateLimited'))
      else setError(t('auth.errorGeneric'))
    } finally {
      setLoading(false)
    }
  }, [email, password, t, setAccessToken, setUser, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`rounded-2xl p-6 w-[380px] max-w-[90vw] relative ${isLight ? 'bg-white border border-slate-200 shadow-2xl' : 'liquid-glass-card'}`}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={onClose} className={`absolute top-3 right-3 cursor-pointer ${isLight ? 'text-slate-400 hover:text-slate-700' : 'text-slate-400 hover:text-white'}`}>
              <X className="w-4 h-4" />
            </button>
            <h2 className={`text-sm font-bold mb-4 ${isLight ? 'text-slate-900' : 'text-white'}`}>{t('auth.loginTitle')}</h2>
            {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('auth.emailOrLogin')}
                required
                className={`px-3 py-2 rounded-lg border text-xs outline-none focus:border-amber-500/50 ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400' : 'bg-black/30 border-white/10 text-white'
                }`}
              />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('auth.password')}
                required
                className={`px-3 py-2 rounded-lg border text-xs outline-none focus:border-amber-500/50 ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400' : 'bg-black/30 border-white/10 text-white'
                }`}
              />
              <button
                type="submit"
                disabled={loading}
                className={`px-4 py-2 rounded-lg text-xs font-bold border cursor-pointer disabled:opacity-50 ${
                  isLight
                    ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                    : 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                }`}
              >
                {loading ? t('common.loading') : t('auth.loginTitle')}
              </button>
            </form>
            <div className="mt-3">
              <button disabled className={`w-full px-4 py-2 rounded-lg text-xs font-bold border cursor-not-allowed ${
                isLight ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white/5 text-slate-500 border-white/5'
              }`}>
                Google
              </button>
            </div>
            <div className={`mt-4 text-center text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {t('auth.noAccount')}{' '}
              <button onClick={onSwitchToRegister} className="text-amber-400 hover:underline cursor-pointer">{t('header.register')}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
