import { useState, useRef, useEffect } from 'react'
import { useTranslation } from '@/i18n'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuthContext } from '@/features/auth/AuthContext'
import {
  User, LogIn, LogOut, ChevronDown, ChevronUp, Sliders,
  Send, Video, Sun, Moon, Home, HelpCircle, Check,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface UserDropdownProps {
  onOpenProfile: () => void
  onOpenAdmin: () => void
  onOpenLogin: () => void
  onOpenHome?: () => void
  onToggleHeaderCollapse: () => void
}

export function UserDropdown({ onOpenProfile, onOpenAdmin, onOpenLogin, onToggleHeaderCollapse }: UserDropdownProps) {
  const { user, logout } = useAuthContext()
  const { t, language, setLanguage } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'

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

  const [langDropdownOpen, setLangDropdownOpen] = useState(false)
  const langDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false)
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
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all text-xs font-bold leading-none select-none ${
            isLight
              ? 'bg-red-50 hover:bg-red-100 border-red-200 text-red-700 shadow-sm'
              : 'bg-red-950/20 hover:bg-red-900/40 border-red-900/30 text-red-400 shadow-inner hover:text-red-300'
          }`}
          title={t('header.admin')}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('header.admin')}</span>
        </button>
      )}

      {/* Collapse header button — left of theme toggle */}
      <button
        onClick={onToggleHeaderCollapse}
        className={`flex items-center justify-center p-1.5 sm:p-2 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all ${
          isLight
            ? 'bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-800 shadow-sm'
            : 'bg-slate-950/40 hover:bg-slate-900/60 border-white/5 text-slate-300 hover:text-white shadow-inner'
        }`}
        title={language === 'RU' ? 'Свернуть шапку' : 'Collapse header'}
      >
        <ChevronUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {/* Theme toggle button */}
      <button
        onClick={toggleTheme}
        className={`flex items-center justify-center p-2 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all ${
          isLight
            ? 'bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-800 shadow-sm'
            : 'bg-slate-950/40 hover:bg-slate-900/60 border-white/5 text-yellow-400 hover:text-yellow-300 shadow-inner'
        }`}
        title={t('header.theme')}
      >
        {theme === 'dark' ? (
          <Sun className="w-4 h-4 text-yellow-500 fill-yellow-500/10" />
        ) : (
          <Moon className="w-4 h-4 text-slate-700 font-bold" />
        )}
      </button>

      {/* Language switcher */}
      <div className="relative" ref={langDropdownRef}>
        <button
          onClick={() => setLangDropdownOpen(v => !v)}
          className={`flex items-center justify-center gap-1 px-2 py-2 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all ${
            isLight
              ? 'bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-800 shadow-sm'
              : 'bg-slate-950/40 hover:bg-slate-900/60 border-white/5 text-slate-200 shadow-inner'
          }`}
          title={t('header.language')}
        >
          <span className="text-[10px] font-mono font-bold">{language}</span>
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${
            isLight ? 'text-slate-700' : 'text-slate-400'
          } ${langDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {langDropdownOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className={`absolute right-0 mt-1.5 z-[9999] rounded-xl p-1.5 min-w-[120px] ${
                isLight
                  ? 'bg-white border border-slate-300 text-slate-900 shadow-2xl'
                  : 'muddy-glass-popover text-slate-100'
              }`}
            >
              {(['RU', 'EN', 'KZ'] as const).map((lang) => {
                const isSelected = language === lang
                return (
                  <button
                    key={lang}
                    onClick={() => { setLanguage(lang); setLangDropdownOpen(false) }}
                    className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-left cursor-pointer transition-all w-full text-xs font-bold ${
                      isSelected
                        ? isLight
                          ? 'bg-slate-100 text-slate-900 font-extrabold'
                          : 'bg-white/5 text-white font-extrabold'
                        : isLight
                          ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                          : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className="font-mono text-[10px] font-bold">{lang}</span>
                    {isSelected && (
                      <Check className="w-3 tracking-tight ml-1 text-amber-500 shrink-0" />
                    )}
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* User section */}
      {user ? (
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className={`flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-3 py-1 rounded-xl transition-all duration-200 cursor-pointer border shadow-inner hover:scale-[1.01] active:scale-[0.99] ${
              isLight
                ? 'border-slate-300 bg-slate-200 hover:bg-slate-300'
                : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/60'
            }`}
          >
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-slate-950" />
            </div>
            <div className="text-left hidden md:block">
              <div className={`text-[11px] font-sans font-black leading-tight ${
                isLight ? 'text-slate-900' : 'text-slate-200'
              }`}>
                {user.nickname}
              </div>
              <div className={`text-[9px] font-mono leading-none ${
                isLight ? 'text-slate-600 font-bold' : 'text-slate-400'
              }`}>
                {roleLabel}
              </div>
            </div>
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${
              isLight ? 'text-slate-700' : 'text-slate-400'
            } ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className={`absolute right-0 mt-2.5 w-64 rounded-[28px] p-5 z-[9999] text-left select-none font-sans border ${
                  isLight
                    ? 'bg-white border-slate-200 text-slate-800 shadow-2xl'
                    : 'border-white/[0.07] border-t-white/[0.35] border-l-white/[0.20] bg-[linear-gradient(135deg,rgba(10,15,28,0.93)_0%,rgba(5,7,12,0.96)_100%)] backdrop-blur-lg backdrop-saturate-[1.9] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.95),0_0_40px_2px_rgba(6,182,212,0.05),inset_0_1px_0px_rgba(255,255,255,0.35),inset_1px_0px_0px_rgba(255,255,255,0.15)] text-slate-100'
                }`}
              >
                {/* User profile header */}
                <div className={`flex items-center gap-3.5 pb-4 mb-4 border-b ${
                  isLight ? 'border-slate-100' : 'border-white/5'
                }`}>
                  <div className={`w-11 h-11 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center border-2 ${
                    isLight ? 'border-slate-200' : 'border-white/10'
                  }`}>
                    <User className="w-5 h-5 text-slate-950" />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[14px] font-black flex items-center gap-1.5 leading-none ${
                      isLight ? 'text-slate-800' : 'text-slate-100'
                    }`}>
                      {user.nickname.toLowerCase()}
                    </div>
                    <div className={`text-[10px] font-mono mt-1 leading-none truncate ${
                      isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}>
                      {user.email.toLowerCase()}
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => { setDropdownOpen(false); onOpenProfile() }}
                    className={`flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left ${
                      isLight ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <User className="w-4 h-4 text-slate-500" />
                    <span>{t('header.profile')}</span>
                  </button>

                  <button
                    onClick={() => { setDropdownOpen(false); window.location.href = 'https://procluster.online' }}
                    className={`flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left ${
                      isLight ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Home className="w-4 h-4 text-slate-500" />
                    <span>{t('header.home')}</span>
                  </button>

                  <button
                    onClick={() => { setDropdownOpen(false) }}
                    className={`flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left ${
                      isLight ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <HelpCircle className="w-4 h-4 text-blue-500" />
                    <span>FAQ</span>
                  </button>

                  {/* Social links */}
                  <div className={`my-1.5 border-t ${isLight ? 'border-slate-100' : 'border-white/5'}`} />
                  <div className="flex items-center justify-around gap-2 px-1">
                    <a
                      href="https://t.me/PROCLUSTER"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2 flex-1 py-1.5 rounded-xl text-[10.5px] font-bold transition ${
                        isLight ? 'text-sky-600 hover:bg-sky-50 bg-sky-50/30' : 'text-sky-400 hover:bg-[#0284c7]/10 bg-sky-500/5'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5 hover:translate-x-0.5 hover:-translate-y-0.5 transition-transform" />
                      <span>Telegram</span>
                    </a>
                    <a
                      href="https://www.youtube.com/@PRO_CLSTR"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2 flex-1 py-1.5 rounded-xl text-[10.5px] font-bold transition ${
                        isLight ? 'text-red-600 hover:bg-red-50 bg-red-50/30' : 'text-red-400 hover:bg-[#dc2626]/10 bg-red-500/5'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5 hover:scale-110 transition-transform" />
                      <span>YouTube</span>
                    </a>
                  </div>
                </div>

                {/* Role badge (static, no role switcher) */}
                <div className={`mt-4 pt-3.5 border-t ${isLight ? 'border-slate-100' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between px-1">
                    <span className={`text-[9px] font-mono font-extrabold tracking-widest uppercase ${
                      isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}>
                      Role
                    </span>
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide leading-none bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      {roleLabel}
                    </span>
                  </div>
                </div>

                {/* Logout */}
                <div className={`mt-4 pt-3.5 border-t ${isLight ? 'border-slate-100' : 'border-white/5'}`}>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[11px] font-bold text-rose-500 hover:text-rose-600 hover:bg-rose-50/55 cursor-pointer transition duration-150 text-left"
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
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all border ${
            isLight
              ? 'bg-amber-100 hover:bg-amber-200 border-amber-300 text-amber-900 shadow-sm'
              : 'liquid-glass-active text-yellow-500'
          }`}
        >
          <LogIn className={`w-4 h-4 ${isLight ? 'text-amber-700' : 'text-yellow-500'}`} />
          {t('header.login')}
        </button>
      )}
    </div>
  )
}
