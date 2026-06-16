import { useState, useCallback } from 'react'

const STORAGE_KEY = 'procluster.favoritePairs'

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveFavorites(favorites: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
  } catch {
    // storage full or unavailable
  }
}

export function useFavoritePairs() {
  const [favorites, setFavorites] = useState<string[]>(loadFavorites)

  const isFavorite = useCallback(
    (symbol: string) => favorites.includes(symbol),
    [favorites],
  )

  const toggleFavorite = useCallback((symbol: string) => {
    setFavorites((prev) => {
      const next = prev.includes(symbol)
        ? prev.filter((s) => s !== symbol)
        : [...prev, symbol]
      saveFavorites(next)
      return next
    })
  }, [])

  return { favorites, isFavorite, toggleFavorite }
}
