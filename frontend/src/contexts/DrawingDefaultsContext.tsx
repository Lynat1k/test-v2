import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useAuthContext } from '@/features/auth/AuthContext'
import type { DrawingDefaultsMap } from '@/features/drawings/api'
import { apiGetDrawingDefaults, apiGetDrawingDefaultsWithToken, apiPutDrawingDefault } from '@/features/drawings/api'

interface DrawingDefaultsContextValue {
  drawingDefaults: DrawingDefaultsMap
  loading: boolean
  updateDrawingDefault: (drawingType: string, settings: Record<string, unknown>) => Promise<void>
  refreshDrawingDefaults: () => Promise<void>
}

const DrawingDefaultsContext = createContext<DrawingDefaultsContextValue | null>(null)

const POSITION_DEFAULTS: Record<string, unknown> = {
  deposit: 10000,
  risk: 1,
  riskType: "percent",
  colorTarget: "rgba(16, 185, 129, 0.22)",
  colorStop: "rgba(239, 68, 68, 0.22)",
  opacity: 0.22,
  fontSize: 10,
  makerFee: 0.02,
  takerFee: 0.05,
  entryFeeType: "maker",
  exitFeeType: "taker"
}

const VOLUME_DEFAULTS: Record<string, unknown> = {
  extendPoc: false,
  volColor: "#3b82f6",
  pocColor: "#3b82f6",
  vpVaOpacity: 0.28,
  vpOutVaOpacity: 0.28 * 0.3,
  vpPocOpacity: 1.0,
  vpBgOpacity: 0.03,
  vpBorderOpacity: 0.8
}

export function getClientDefaults(drawingType: string): Record<string, unknown> {
  switch (drawingType) {
    case "volume":
      return { ...VOLUME_DEFAULTS }
    case "position":
    case "long":
    case "short":
      return { ...POSITION_DEFAULTS }
    default:
      return {}
  }
}

export function DrawingDefaultsProvider({ children }: { children: ReactNode }) {
  const { user, accessToken } = useAuthContext()
  const [drawingDefaults, setDrawingDefaults] = useState<DrawingDefaultsMap>({})
  const [loading, setLoading] = useState(true)

  const refreshDrawingDefaults = useCallback(async () => {
    try {
      let data: DrawingDefaultsMap
      if (accessToken) {
        data = await apiGetDrawingDefaultsWithToken(accessToken)
      } else {
        data = await apiGetDrawingDefaults()
      }
      setDrawingDefaults(data)
    } catch {
      setDrawingDefaults({})
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    setLoading(true)
    refreshDrawingDefaults()
  }, [refreshDrawingDefaults, user?.id])

  const updateDrawingDefault = useCallback(async (drawingType: string, settings: Record<string, unknown>) => {
    if (!accessToken) return
    try {
      await apiPutDrawingDefault(drawingType, settings)
      setDrawingDefaults(prev => ({ ...prev, [drawingType]: settings }))
    } catch (err) {
      console.warn('[DrawingDefaults] failed to save:', err)
    }
  }, [accessToken])

  return (
    <DrawingDefaultsContext.Provider value={{ drawingDefaults, loading, updateDrawingDefault, refreshDrawingDefaults }}>
      {children}
    </DrawingDefaultsContext.Provider>
  )
}

export function useDrawingDefaults() {
  const ctx = useContext(DrawingDefaultsContext)
  if (!ctx) throw new Error('useDrawingDefaults must be used within DrawingDefaultsProvider')
  return ctx
}
