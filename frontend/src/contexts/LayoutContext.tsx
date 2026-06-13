import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type LayoutMode = 'single' | 'horizontal' | 'vertical'

interface CrosshairData {
  chartIndex: 0 | 1
  x: number
  y: number
  timestamp?: number
  price?: number
}

interface LayoutContextValue {
  layoutMode: LayoutMode
  splitRatio: number
  setLayoutMode: (mode: LayoutMode) => void
  setSplitRatio: (ratio: number) => void

  onCrosshairMove: (data: CrosshairData | null) => void
  crosshairCallback: ((data: CrosshairData | null) => void) | null
  setCrosshairCallback: (cb: ((data: CrosshairData | null) => void) | null) => void
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

const STORAGE_KEY_LAYOUT = 'procluster_layout_mode'
const STORAGE_KEY_SPLIT = 'procluster_split_ratio'

function loadLayout(): LayoutMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY_LAYOUT)
    if (v === 'horizontal' || v === 'vertical' || v === 'single') return v
  } catch {}
  return 'single'
}

function loadSplit(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY_SPLIT)
    if (v) {
      const n = parseFloat(v)
      if (n >= 0.1 && n <= 0.9) return n
    }
  } catch {}
  return 0.5
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>(loadLayout)
  const [splitRatio, setSplitRatioState] = useState<number>(loadSplit)
  const [crosshairCallback, setCrosshairCallback] = useState<((data: CrosshairData | null) => void) | null>(null)

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setLayoutModeState(mode)
    try { localStorage.setItem(STORAGE_KEY_LAYOUT, mode) } catch {}
  }, [])

  const setSplitRatio = useCallback((ratio: number) => {
    const clamped = Math.max(0.1, Math.min(0.9, ratio))
    setSplitRatioState(clamped)
    try { localStorage.setItem(STORAGE_KEY_SPLIT, String(clamped)) } catch {}
  }, [])

  const onCrosshairMove = useCallback((data: CrosshairData | null) => {
    crosshairCallback?.(data)
  }, [crosshairCallback])

  return (
    <LayoutContext.Provider value={{
      layoutMode, splitRatio,
      setLayoutMode, setSplitRatio,
      onCrosshairMove, crosshairCallback, setCrosshairCallback,
    }}>
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  const ctx = useContext(LayoutContext)
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider')
  return ctx
}
