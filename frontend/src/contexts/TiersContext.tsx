import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { apiGetTiers, type PublicTiers } from '@/features/auth/api'

interface TiersContextValue {
  tiers: PublicTiers | null
  loading: boolean
  error: boolean
}

const TiersContext = createContext<TiersContextValue | null>(null)

export function TiersProvider({ children }: { children: ReactNode }) {
  const [tiers, setTiers] = useState<PublicTiers | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Fetch public tier policies once on mount. Fail-soft: on error keep
  // tiers=null and flag error so consumers can hide the table gracefully.
  useEffect(() => {
    let cancelled = false
    apiGetTiers()
      .then(data => {
        if (cancelled) return
        setTiers(data)
        setError(false)
      })
      .catch(() => {
        if (cancelled) return
        setTiers(null)
        setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <TiersContext.Provider value={{ tiers, loading, error }}>
      {children}
    </TiersContext.Provider>
  )
}

export function useTiers(): TiersContextValue {
  const ctx = useContext(TiersContext)
  if (!ctx) throw new Error('useTiers must be used within TiersProvider')
  return ctx
}
