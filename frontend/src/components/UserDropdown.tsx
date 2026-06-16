import { useState, useRef, useEffect } from 'react'
import { useTranslation } from '@/i18n'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuthContext } from '@/features/auth/AuthContext'
import {
  User, LogIn, LogOut, ChevronDown, Sliders,
  Send, Video, Sun, Moon, Home, HelpCircle,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface UserDropdownProps {
  onOpenProfile: () => void
  onOpenAdmin: () => void
  onOpenLogin: () => void
  onOpenHome?: () => void
}

export function UserDropdown({ onOpenProfile, onOpenAdmin, onOpenLogin, onOpenHome }: UserDropdownProps) {
  const { user, logout } = useAuthContext()
  const { t, language, setLanguage } = useTranslation()
  const { theme, toggleTheme } = useTheme()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isAdmin = user?.role === 'admin' || user?.role === 'Admin'
  const roleKey = (user?.role || 'guest').toLowerCase()
  const roleLabel = t(`roles.${roleKey}` as any)

  const handleLogout = async () => {
    setDropdownOpen(false)
    await logout()
  }

  return (
    <div ref={dropdownRef} className="flex items-center gap-1.5 sm:gap-3">
      {/* Admin button */}
      {isAdmin && (
        <button
          onClick={onOpenAdmin}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all text-xs font-bold leading-none select-none bg-red-950/20 hover:bg-red-900/40 border-red-900/30 text-red-400 shadow-inner hover:text-red-300"
          title={t('header.admin')}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('header.admin')}</span>
        </button>
      )}

      {/* Theme toggle button */}
      <button
        onClick={toggleTheme}
        className="flex items-center justify-center p-2 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all bg-slate-950/40 hover:bg-slate-900/60 border-white/5 text-yellow-400 hover:text-yellow-300 shadow-inner"
        title={theme === 'dark' ? t('header.theme') : t('header.theme')}
      >
        {theme === 'dark' ? (
          <Sun className="w-4 h-4 text-yellow-500 fill-yellow-500/10" />
        ) : (
          <Moon className="w-4 h-4 text-slate-700 font-bold" />
        )}
      </button>

      {/* User section */}
      {user ? (
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-3 py-1 rounded-xl transition-all duration-200 cursor-pointer border shadow-inner hover:scale-[1.01] active:scale-[0.99] border-white/5 bg-slate-950/40 hover:bg-slate-900/60"
          >
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-slate-950" />
            </div>
            <div className="text-left hidden md:block">
              <div className="text-[11px] font-sans font-black leading-tight text-slate-200">
                {user.nickname}
              </div>
              <div className="text-[9px] font-mono leading-none text-slate-400">
                {roleLabel}
              </div>
            </div>
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 text-slate-400 ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute right-0 mt-2.5 w-64 rounded-[28px] p-5 z-[9999] text-left select-none font-sans border border-white/[0.07] border-t-white/[0.35] border-l-white/[0.20] bg-[linear-gradient(135deg,rgba(10,15,28,0.93)_0%,rgba(5,7,12,0.96)_100%)] backdrop-blur-lg backdrop-saturate-[1.9] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.95),0_0_40px_2px_rgba(6,182,212,0.05),inset_0_1px_0px_rgba(255,255,255,0.35),inset_1px_0px_0px_rgba(255,255,255,0.15)] text-slate-100"
              >
                {/* User profile header */}
                <div className="flex items-center gap-3.5 pb-4 mb-4 border-b border-white/5">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center border-2 border-white/10">
                    <User className="w-5 h-5 text-slate-950" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-black flex items-center gap-1.5 leading-none text-slate-100">
                      {user.nickname.toLowerCase()}
                    </div>
                    <div className="text-[10px] font-mono mt-1 leading-none truncate text-slate-400">
                      {user.email.toLowerCase()}
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => { setDropdownOpen(false); onOpenProfile() }}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left text-slate-300 hover:text-white hover:bg-white/5"
                  >
                    <User className="w-4 h-4 text-slate-500" />
                    <span>{t('header.profile')}</span>
                  </button>

                  <button
                    onClick={() => { setDropdownOpen(false); if (onOpenHome) onOpenHome() }}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left text-slate-300 hover:text-white hover:bg-white/5"
                  >
                    <Home className="w-4 h-4 text-slate-500" />
                    <span>{t('header.home')}</span>
                  </button>

                  <button
                    onClick={() => { setDropdownOpen(false) }}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left text-slate-300 hover:text-white hover:bg-white/5"
                  >
                    <HelpCircle className="w-4 h-4 text-blue-500" />
                    <span>FAQ</span>
                  </button>

                  {/* Social links */}
                  <div className="my-1.5 border-t border-white/5" />
                  <div className="flex items-center justify-around gap-2 px-1">
                    <a
                      href="https://t.me/your_telegram_channel"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 flex-1 py-1.5 rounded-xl text-[10.5px] font-bold transition text-sky-400 hover:bg-[#0284c7]/10 bg-sky-500/5"
                    >
                      <Send className="w-3.5 h-3.5 hover:translate-x-0.5 hover:-translate-y-0.5 transition-transform" />
                      <span>Telegram</span>
                    </a>
                    <a
                      href="https://youtube.com/@your_youtube_channel"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 flex-1 py-1.5 rounded-xl text-[10.5px] font-bold transition text-red-400 hover:bg-[#dc2626]/10 bg-red-500/5"
                    >
                      <Video className="w-3.5 h-3.5 hover:scale-110 transition-transform" />
                      <span>YouTube</span>
                    </a>
                  </div>
                </div>

                {/* Language switcher */}
                <div className="mt-4 pt-3.5 border-t border-white/5">
                  <span className="text-[9px] font-mono font-extrabold tracking-widest uppercase block mb-2 px-1 text-slate-400">
                    {t('header.language')}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 p-[3px] rounded-2xl border shadow-inner bg-slate-950/60 border-white/5">
                    {(['RU', 'EN', 'KZ'] as const).map((lang) => {
                      const isSelected = language === lang
                      return (
                        <button
                          key={lang}
                          onClick={() => setLanguage(lang)}
                          className="py-1.5 rounded-xl text-[10.5px] font-bold font-mono cursor-pointer text-center relative border-0 outline-none"
                        >
                          {isSelected && (
                            <motion.div
                              layoutId="activeLanguage"
                              className="absolute inset-0 rounded-xl bg-slate-800 border border-white/10 shadow-md"
                              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                              style={{ zIndex: 0 }}
                            />
                          )}
                          <span className={`relative z-10 transition-colors duration-200 ${
                            isSelected ? 'text-white font-extrabold' : 'text-slate-400 hover:text-slate-200'
                          }`}>
                            {lang}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Role badge (static, no role switcher) */}
                <div className="mt-4 pt-3.5 border-t border-white/5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[9px] font-mono font-extrabold tracking-widest uppercase text-slate-400">
                      Role
                    </span>
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide leading-none bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      {roleLabel}
                    </span>
                  </div>
                </div>

                {/* Logout */}
                <div className="mt-4 pt-3.5 border-t border-white/5">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[11px] font-bold text-rose-500 hover:text-rose-600 hover:bg-rose-950/20 cursor-pointer transition duration-150 text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{t('header.logout')}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <button
          onClick={onOpenLogin}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide cursor-pointer text-yellow-500 hover:scale-[1.02] active:scale-[0.98] transition-all border liquid-glass-active"
        >
          <LogIn className="w-4 h-4 text-yellow-500" />
          {t('header.login')}
        </button>
      )}
    </div>
  )
}
