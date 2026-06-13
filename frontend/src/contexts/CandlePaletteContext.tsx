import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

type CandlePalette = 'default' | 'alternative'

interface CandlePaletteContextValue {
  palette0: CandlePalette
  palette1: CandlePalette
  setPalette0: (p: CandlePalette) => void
  setPalette1: (p: CandlePalette) => void
  getActivePalette: (chartIndex: 0 | 1) => CandlePalette
  setActivePalette: (chartIndex: 0 | 1, palette: CandlePalette) => void
}

const CandlePaletteContext = createContext<CandlePaletteContextValue | null>(null)

const STORAGE_KEY_0 = 'procluster_candle_palette_0'
const STORAGE_KEY_1 = 'procluster_candle_palette_1'

const PALETTE_COLORS: Record<CandlePalette, { bull: string; bear: string; bullBorder: string; bearBorder: string }> = {
  default: { bull: '#10b981', bear: '#f43f5e', bullBorder: '#10b981', bearBorder: '#f43f5e' },
  alternative: { bull: '#e2e8f0', bear: '#374151', bullBorder: '#cbd5e1', bearBorder: '#1f2937' },
}

function applyPaletteCSS(palette: CandlePalette, prefix: string) {
  const colors = PALETTE_COLORS[palette]
  const root = document.documentElement
  root.style.setProperty(`${prefix}-candle-bull`, colors.bull)
  root.style.setProperty(`${prefix}-candle-bear`, colors.bear)
  root.style.setProperty(`${prefix}-candle-bull-border`, colors.bullBorder)
  root.style.setProperty(`${prefix}-candle-bear-border`, colors.bearBorder)
}

export function CandlePaletteProvider({ children }: { children: ReactNode }) {
  const [palette0, setPalette0State] = useState<CandlePalette>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_0)
    return stored === 'alternative' ? 'alternative' : 'default'
  })
  const [palette1, setPalette1State] = useState<CandlePalette>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_1)
    return stored === 'alternative' ? 'alternative' : 'default'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_0, palette0)
    applyPaletteCSS(palette0, '--chart0')
  }, [palette0])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_1, palette1)
    applyPaletteCSS(palette1, '--chart1')
  }, [palette1])

  const setPalette0 = (p: CandlePalette) => setPalette0State(p)
  const setPalette1 = (p: CandlePalette) => setPalette1State(p)

  const getActivePalette = useCallback((chartIndex: 0 | 1): CandlePalette =>
    chartIndex === 0 ? palette0 : palette1
  , [palette0, palette1])

  const setActivePalette = (chartIndex: 0 | 1, palette: CandlePalette) => {
    if (chartIndex === 0) setPalette0(palette)
    else setPalette1(palette)
  }

  return (
    <CandlePaletteContext.Provider value={{ palette0, palette1, setPalette0, setPalette1, getActivePalette, setActivePalette }}>
      {children}
    </CandlePaletteContext.Provider>
  )
}

export function useCandlePalette() {
  const ctx = useContext(CandlePaletteContext)
  if (!ctx) throw new Error('useCandlePalette must be used within CandlePaletteProvider')
  return ctx
}
