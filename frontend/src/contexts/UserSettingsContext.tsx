import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useAuthContext } from '@/features/auth/AuthContext'
import { apiGetSettings, apiPutSettings } from '@/features/auth/api'

interface UserSettingsContextValue {
  settings: Record<string, any>
  setSetting: (key: string, value: any) => void
  getSetting: <T = any>(key: string, fallback?: T) => T
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null)

const LS_KEY = 'procluster_user_settings'

function readLocal(): Record<string, any> {
  try {
    const s = localStorage.getItem(LS_KEY)
    return s ? JSON.parse(s) : {}
  } catch { return {} }
}

function writeLocal(settings: Record<string, any>) {
  localStorage.setItem(LS_KEY, JSON.stringify(settings))
}

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext()
  const [settings, setSettings] = useState<Record<string, any>>(() => user ? {} : readLocal())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const loadedFromApiRef = useRef(false)

  useEffect(() => {
    if (!user) {
      setSettings(readLocal())
      loadedFromApiRef.current = false
      return
    }
    if (loadedFromApiRef.current) return
    loadedFromApiRef.current = true

    ;(async () => {
      try {
        const data = await apiGetSettings()
        const parsed = JSON.parse(data.settingsJson || '{}')
        const local = readLocal()

        const hasLocal = Object.keys(local).length > 0
        const merged = hasLocal ? { ...parsed, ...local } : parsed

        setSettings(merged)
        if (hasLocal) {
          await apiPutSettings(JSON.stringify(merged))
          writeLocal({})
        }
      } catch {
        setSettings(readLocal())
      }
    })()
  }, [user])

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      if (user) {
        try { await apiPutSettings(JSON.stringify(settings)) } catch { /* retry next change */ }
      } else {
        writeLocal(settings)
      }
    }, 500)
  }, [user, settings])

  useEffect(() => { return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) } }, [])

  const setSetting = useCallback((key: string, value: any) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      dirtyRef.current = true
      setTimeout(flushSave, 0)
      return next
    })
  }, [flushSave])

  const getSetting = useCallback(<T = any>(key: string, fallback?: T): T => {
    return (settings[key] ?? fallback) as T
  }, [settings])

  return (
    <UserSettingsContext.Provider value={{ settings, setSetting, getSetting }}>
      {children}
    </UserSettingsContext.Provider>
  )
}

export function useUserSettings() {
  const ctx = useContext(UserSettingsContext)
  if (!ctx) throw new Error('useUserSettings must be used within UserSettingsProvider')
  return ctx
}
