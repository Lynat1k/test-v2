import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { apiGetLimitsWithToken, apiGetLimitsPublic, type UserLimits } from '@/features/auth/api'
import { useAuthContext } from '@/features/auth/AuthContext'

const DEFAULT_LIMITS: UserLimits = {
  tier: 'guest',
  sessionLimit: 1,
  historyMaxDays: 7,
  compressionMax: 1,
  maxIndicators: 1,
  customIndicatorSettings: 0,
  telegramEnabled: 0,
  workspacesCount: 1,
  anomaliesEnabled: 0,
  historyDaysPerTf: { '1m': 1, '5m': 1, '15m': 1, '30m': 1, '1h': 1, '4h': 1 },
}

interface LimitsContextValue {
  limits: UserLimits
  loading: boolean
  refresh: () => Promise<void>
}

const LimitsContext = createContext<LimitsContextValue | null>(null)

export function LimitsProvider({ children }: { children: ReactNode }) {
  const { user, accessToken } = useAuthContext()
  const [limits, setLimits] = useState<UserLimits>(DEFAULT_LIMITS)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = accessToken
        ? await apiGetLimitsWithToken(accessToken)
        : await apiGetLimitsPublic()
      console.log('[LimitsContext] fetched:', data)
      setLimits(data)
    } catch (e) {
      console.error('[LimitsContext] fetch error:', e)
      setLimits(DEFAULT_LIMITS)
    }
    setLoading(false)
  }, [accessToken])

  // Fetch on mount and whenever auth state changes (guest ↔ login)
  useEffect(() => {
    setLoading(true)
    refresh()
  }, [user?.id, accessToken, refresh])

  return (
    <LimitsContext.Provider value={{ limits, loading, refresh }}>
      {children}
    </LimitsContext.Provider>
  )
}

export function useUserLimits(): LimitsContextValue {
  const ctx = useContext(LimitsContext)
  if (!ctx) throw new Error('useUserLimits must be used within LimitsProvider')
  return ctx
}
