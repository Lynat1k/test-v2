import { useState, useEffect, useMemo } from 'react'
import { MODULAR_INDICATORS } from '@/chart2d/indicators'
import type { Indicator } from '@/chart2d/types'

const STORAGE_KEY = 'procluster_indicators_v2'

function buildDefaultIndicators(): Indicator[] {
  return MODULAR_INDICATORS.map((mod) => ({
    id: mod.id,
    label: mod.label,
    category: mod.category,
    type: mod.type,
    isFavorite: false,
    isActive: mod.isActiveDefault ?? false,
    isVisible: true,
    settings: { ...mod.defaultSettings },
  }))
}

function mergeSaved(saved: Indicator[]): Indicator[] {
  const defaults = buildDefaultIndicators()
  const savedMap = new Map(saved.map((i) => [i.id, i]))
  return defaults.map((def) => {
    const s = savedMap.get(def.id)
    if (!s) return def
    return {
      ...def,
      isFavorite: s.isFavorite ?? def.isFavorite,
      isActive: s.isActive ?? def.isActive,
      isVisible: s.isVisible ?? def.isVisible ?? true,
      settings: { ...def.settings, ...s.settings },
    }
  })
}

export function useIndicators() {
  const [indicators, setIndicators] = useState<Indicator[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? mergeSaved(JSON.parse(stored)) : buildDefaultIndicators()
    } catch {
      return buildDefaultIndicators()
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(indicators))
  }, [indicators])

  const activeIndicators = useMemo<Record<string, boolean>>(() => {
    const record: Record<string, boolean> = { volume: false }
    for (const ind of indicators) {
      record[ind.id] = ind.isActive && ind.isVisible !== false
    }
    return record
  }, [indicators])

  const handleIndicatorUpdate = (id: string, settings: Partial<Indicator['settings']>) => {
    setIndicators(prev => prev.map(ind =>
      ind.id === id ? { ...ind, settings: { ...ind.settings, ...settings } } : ind
    ))
  }

  const handleIndicatorToggle = (id: string) => {
    setIndicators(prev => prev.map(ind =>
      ind.id === id ? { ...ind, isActive: !ind.isActive } : ind
    ))
  }

  const handleIndicatorDeactivate = (id: string) => {
    setIndicators(prev => prev.map(ind =>
      ind.id === id ? { ...ind, isActive: false } : ind
    ))
  }

  const handleIndicatorVisibility = (id: string) => {
    setIndicators(prev => prev.map(ind =>
      ind.id === id ? { ...ind, isVisible: ind.isVisible === false ? true : false } : ind
    ))
  }

  const handleIndicatorFavorite = (id: string) => {
    setIndicators(prev => prev.map(ind =>
      ind.id === id ? { ...ind, isFavorite: !ind.isFavorite } : ind
    ))
  }

  const handleApplyIndicators = (updated: Indicator[]) => {
    setIndicators(updated)
  }

  return {
    indicators,
    activeIndicators,
    handleIndicatorUpdate,
    handleIndicatorToggle,
    handleIndicatorDeactivate,
    handleIndicatorVisibility,
    handleIndicatorFavorite,
    handleApplyIndicators,
  }
}
