import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { AuthUser } from './api'
import { apiRefresh, apiLogout, setApiAccessToken, apiGetSiteSettings } from './api'

interface AuthContextValue {
  user: AuthUser | null
  accessToken: string | null
  loading: boolean
  betaMode: boolean
  betaLoaded: boolean
  setUser: (user: AuthUser | null) => void
  setAccessToken: (token: string | null) => void
  setBetaMode: (mode: boolean) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [betaMode, setBetaMode] = useState(false)
  const [betaLoaded, setBetaLoaded] = useState(false)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    const ms = Math.max((expiresIn - 120) * 1000, 30_000)
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const data = await apiRefresh()
        setAccessToken(data.accessToken)
        setUser(data.user)
        scheduleRefresh(900)
      } catch {
        setAccessToken(null)
        setUser(null)
      }
    }, ms)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiRefresh()
        if (cancelled) return
        setAccessToken(data.accessToken)
        setUser(data.user)
        scheduleRefresh(900)
      } catch {
        // Not logged in — that's fine
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    ;(async () => {
      try {
        const data = await apiGetSiteSettings()
        if (cancelled) return
        setBetaMode(data.betaMode)
      } catch {
        // fail-open: beta stays false
      } finally {
        if (!cancelled) setBetaLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [scheduleRefresh])

  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current) }
  }, [])

  useEffect(() => {
    setApiAccessToken(accessToken)
  }, [accessToken])

  const logout = useCallback(async () => {
    await apiLogout()
    setAccessToken(null)
    setUser(null)
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
  }, [])

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, betaMode, betaLoaded, setUser, setAccessToken, setBetaMode, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}
