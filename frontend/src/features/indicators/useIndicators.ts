import { useState, useEffect } from 'react'
import type { Indicator } from '@/types'

const STORAGE_KEY = 'procluster_indicators'

const DEFAULT_INDICATORS: Indicator[] = [
  { id: 'volume', label: 'Volume', category: 'Все индикаторы', type: 'Подвальный', isFavorite: false, isActive: false, settings: {} },
  { id: 'volumeOnChart', label: 'Volume on Chart', category: 'Все индикаторы', type: 'Оверлей', isFavorite: false, isActive: false, settings: {} },
  { id: 'volumeProfile', label: 'Volume Profile', category: 'Все индикаторы', type: 'Оверлей', isFavorite: false, isActive: false, settings: {} },
  { id: 'marketProfile', label: 'Market Profile', category: 'Все индикаторы', type: 'Оверлей', isFavorite: false, isActive: false, settings: {} },
  { id: 'delta', label: 'Delta', category: 'Все индикаторы', type: 'Подвальный', isFavorite: false, isActive: false, settings: {} },
  { id: 'cvd', label: 'CVD', category: 'Все индикаторы', type: 'Подвальный', isFavorite: false, isActive: false, settings: {} },
  { id: 'liquidations', label: 'Liquidations', category: 'Все индикаторы', type: 'Оверлей', isFavorite: false, isActive: false, settings: {} },
  { id: 'clusterSearch', label: 'Cluster Search', category: 'Все индикаторы', type: 'Оверлей', isFavorite: false, isActive: false, settings: {} },
  { id: 'reversalClusters', label: 'Reversal Clusters', category: 'Все индикаторы', type: 'Оверлей', isFavorite: false, isActive: false, settings: {} },
  { id: 'absorption', label: 'Absorption', category: 'Все индикаторы', type: 'Оверлей', isFavorite: false, isActive: false, settings: {} },
  { id: 'stackedImbalance', label: 'Stacked Imbalance', category: 'Все индикаторы', type: 'Оверлей', isFavorite: false, isActive: false, settings: {} },
]

export function useIndicators() {
  const [indicators, setIndicators] = useState<Indicator[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) as Indicator[] : DEFAULT_INDICATORS
    } catch {
      return DEFAULT_INDICATORS
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(indicators))
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

  const handleIndicatorFavorite = (id: string) => {
    setIndicators(prev => prev.map(ind =>
      ind.id === id ? { ...ind, isFavorite: !ind.isFavorite } : ind
    ))
  }

  return { indicators, handleIndicatorUpdate, handleIndicatorToggle, handleIndicatorFavorite }
}
