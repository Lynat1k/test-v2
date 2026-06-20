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
  // Ref always holds the latest settings so the async save timer never reads stale closure values.
  const settingsRef = useRef<Record<string, any>>(settings)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const loadedFromApiRef = useRef(false)

  useEffect(() => {
    if (!user) {
      const local = readLocal()
      settingsRef.current = local
      setSettings(local)
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

        settingsRef.current = merged
        setSettings(merged)
        if (hasLocal) {
          try {
            await apiPutSettings(JSON.stringify(merged))
            writeLocal({})  // clear localStorage only after successful PUT
          } catch {
            // PUT failed — keep localStorage intact as backup for next load
          }
        }
      } catch {
        const local = readLocal()
        settingsRef.current = local
        setSettings(local)
      }
    })()
  }, [user])

  // flushSave reads settingsRef (not the closed-over state) so the 500ms timer
  // always persists the value that was actually written, not a stale snapshot.
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      const current = settingsRef.current
      if (user) {
        try { await apiPutSettings(JSON.stringify(current)) } catch { /* retry next change */ }
      } else {
        writeLocal(current)
      }
    }, 500)
  }, [user]) // `settings` removed from deps — we use the ref instead

  useEffect(() => { return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) } }, [])

  const setSetting = useCallback((key: string, value: any) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      settingsRef.current = next   // sync ref immediately so flushSave reads the new value
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
