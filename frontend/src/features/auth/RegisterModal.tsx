import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Mail } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { useAuthContext } from './AuthContext'
import { apiRegister } from './api'

interface RegisterModalProps {
  open: boolean
  onClose: () => void
  onSwitchToLogin: () => void
}

export function RegisterModal({ open, onClose, onSwitchToLogin }: RegisterModalProps) {
  const { t } = useTranslation()
  const { setAccessToken, setUser } = useAuthContext()
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(false)

  useEffect(() => {
    if (!open) { setNickname(''); setEmail(''); setPassword(''); setConfirm(''); setError(''); setLoading(false); setRegistered(false) }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && open) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError(t('auth.errorPasswordsMismatch')); return }
    if (password.length < 8) { setError(t('auth.errorPasswordTooShort')); return }
    setLoading(true)
    try {
      const data = await apiRegister(email, password, nickname)
      setAccessToken(data.accessToken)
      setUser(data.user)
      setRegistered(true)
    } catch (err: any) {
      if (err.code === 'EMAIL_TAKEN') setError(t('auth.errorEmailTaken'))
      else if (err.code === 'NICKNAME_EXISTS') setError(t('auth.errorNicknameTaken'))
      else if (err.code === 'RATE_LIMITED') setError(t('auth.errorRateLimited'))
      else setError(t('auth.errorGeneric'))
    } finally {
      setLoading(false)
    }
  }, [nickname, email, password, confirm, t, setAccessToken, setUser])

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
            className="liquid-glass-card rounded-2xl p-6 w-[380px] max-w-[90vw] relative"
            onClick={e => e.stopPropagation()}
          >
            <button onClick={onClose} className="absolute top-3 right-3 text-slate-400 hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>

            {registered ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <Mail className="w-10 h-10 text-amber-400" />
                <h2 className="text-sm font-bold text-white">{t('auth.verifyEmailTitle')}</h2>
                <p className="text-xs text-slate-400 text-center">{t('auth.verifyEmailMessage')}</p>
                <button onClick={onClose} className="mt-2 px-4 py-2 rounded-lg bg-white/5 text-slate-300 text-xs font-bold border border-white/10 hover:bg-white/10 cursor-pointer">
                  {t('common.close')}
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-sm font-bold text-white mb-4">{t('auth.registerTitle')}</h2>
                {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>}
                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={nickname}
                    onChange={e => setNickname(e.target.value)}
                    placeholder={t('auth.username')}
                    required
                    minLength={2}
                    maxLength={30}
                    className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-xs outline-none focus:border-amber-500/50"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('auth.email')}
                    required
                    className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-xs outline-none focus:border-amber-500/50"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('auth.password')}
                    required
                    minLength={8}
                    className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-xs outline-none focus:border-amber-500/50"
                  />
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder={t('auth.confirmPassword')}
                    required
                    className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-xs outline-none focus:border-amber-500/50"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/30 hover:bg-amber-500/30 cursor-pointer disabled:opacity-50"
                  >
                    {loading ? t('common.loading') : t('auth.registerTitle')}
                  </button>
                </form>
                <div className="mt-4 text-center text-xs text-slate-400">
                  {t('auth.hasAccount')}{' '}
                  <button onClick={onSwitchToLogin} className="text-amber-400 hover:underline cursor-pointer">{t('header.login')}</button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
