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

function writeLocal(data: Record<string, any>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)) } catch {}
}

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext()
  const [settings, setSettings] = useState<Record<string, any>>(() => readLocal())
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
        const merged: Record<string, any> = hasLocal ? { ...parsed, ...local } : { ...parsed }
        // Server-priority for per-symbol chart compression keys: stale guest LS must not
        // overwrite the logged-in user's saved choices (handled per-key, leaving other
        // settings local-wins as before).
        for (const k of Object.keys(parsed)) {
          if (k.startsWith('chartCompression_') || k.startsWith('clusterAbbreviate_') || k.startsWith('clusterHideNumbers_')) merged[k] = parsed[k]
        }

        settingsRef.current = merged
        setSettings(merged)
        if (hasLocal) {
          try {
            await apiPutSettings(JSON.stringify(merged))
            writeLocal({})
          } catch {
            // keep localStorage intact as backup
          }
        }
      } catch {
        const local = readLocal()
        settingsRef.current = local
        setSettings(local)
      }
    })()
  }, [user])

  // Debounced server sync for auth users only.
  const flushSave = useCallback(() => {
    if (!user) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      try { await apiPutSettings(JSON.stringify(settingsRef.current)) } catch {}
    }, 500)
  }, [user])

  useEffect(() => { return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) } }, [])

  const setSetting = useCallback((key: string, value: any) => {
    // Read from ref (always current) — avoids stale-prev risk in Concurrent Mode.
    const next = { ...settingsRef.current, [key]: value }
    settingsRef.current = next
    dirtyRef.current = true
    setSettings(next)
    // Immediate localStorage write: guest persistence + auth backup.
    writeLocal(next)
    // Auth users additionally sync to server with debounce.
    if (user) {
      flushSave()
    }
  }, [user, flushSave])

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
