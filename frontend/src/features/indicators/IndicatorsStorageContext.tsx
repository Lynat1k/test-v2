import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Indicator } from '@/chart2d/types'
import { useAuthContext } from '@/features/auth/AuthContext'
import type { IndicatorSettings } from '@/chart2d/types'
import {
  applyIndicatorPreset as apiApplyPreset,
  createIndicatorPreset as apiCreatePreset,
  deleteIndicators as apiDeleteIndicators,
  deleteIndicatorPreset as apiDeletePreset,
  fetchIndicators,
  listIndicatorPresets as apiListPresets,
  propagateIndicator as apiPropagateIndicator,
  putIndicators,
  putFavoriteIndicators,
  updateIndicatorPreset as apiUpdatePreset,
} from './api'
import {
  ALL_TF_MARKER,
  type CachedEntry,
  type IndicatorPreset,
  type IndicatorsSource,
  type ResolvedIndicators,
  type StoredIndicator,
} from './types'
import {
  canonKey,
  clearGuestPresets,
  computeActiveIndicators,
  defaultStoredIndicators,
  dehydrateForSave,
  hydrateIndicators,
  isAllTf,
  loadStorageV3,
  migrateLegacyV2IfNeeded,
  readCachedEntry,
  readFavorites,
  readGuestPresetsFor,
  saveStorageV3,
  writeCachedEntry,
  writeFavorites,
  writeGuestPresetsFor,
} from './storage'

interface StoreEntry extends CachedEntry {
  /** True while the first server fetch for this key is still in-flight. */
  loading: boolean
}

interface IndicatorsStorageValue {
  /**
   * Returns the resolved indicators (full Indicator[] shape) and metadata for
   * one (symbol, market, timeframe) triple. Uses, in order:
   *   1. in-memory map (already resolved this session)
   *   2. localStorage cache (stale-while-revalidate — kicks off a refetch)
   *   3. fresh server fetch (or system defaults for guests with no admin row)
   */
  getForKey(symbol: string, market: string, timeframe: string): {
    indicators: Indicator[]
    activeIndicators: Record<string, boolean>
    source: IndicatorsSource
    loading: boolean
    adminDefaultsTf: StoredIndicator[]
    adminDefaultsAllTf: StoredIndicator[]
  }

  /** Replace the row for a concrete (symbol, market, timeframe). */
  saveForKey(symbol: string, market: string, timeframe: string, visible: Indicator[]): Promise<void>

  /**
   * Same as saveForKey, but ALSO syncs the user-wide favorites set from the
   * Indicator[].isFavorite field. Use this for IndicatorsModal "Apply": the
   * modal mutates isFavorite locally in its draft array, so a plain saveForKey
   * would drop those flags (they live outside the per-key row by design).
   */
  applyIndicatorsForKey(symbol: string, market: string, timeframe: string, visible: Indicator[]): Promise<void>

  /**
   * Push ONE indicator to every TF of (symbol, market): upserts the '*' row
   * and replace-or-appends the same id inside every EXISTING per-tf row, while
   * preserving sibling indicators bit-for-bit. New per-tf rows are NOT created
   * — TFs without their own row pick the indicator up from '*' via cascade.
   * Mirrors backend PropagateUserIndicator.
   */
  propagateIndicator(symbol: string, market: string, one: Indicator): Promise<void>

  /**
   * Remove the per-key override so the cascade falls through to the next
   * layer (all-tf user → admin-tf → admin-all-tf → system).
   */
  resetKey(symbol: string, market: string, timeframe: string): Promise<void>

  /**
   * Force a re-fetch from the server for the given key, bypassing the
   * in-flight dedup. Used by the indicator modal after an admin toggles a
   * default so the UI reflects the new admin_indicator_defaults rows
   * immediately without waiting for the 5-minute refresh window.
   */
  refreshKey(symbol: string, market: string, timeframe: string): Promise<void>

  /** User-wide favorites set. */
  favorites: ReadonlySet<string>
  toggleFavorite(id: string): Promise<void>

  /** True until the first activeKey-driven fetch settles. */
  isLoading(symbol: string, market: string, timeframe: string): boolean

  /* ===== indicator presets ===== */

  /**
   * Returns the per-indicator user presets (empty array for guests).
   */
  listPresets(indicatorId: string): Promise<{
    presets: IndicatorPreset[]
  }>

  savePreset(indicatorId: string, name: string, settings: IndicatorSettings): Promise<IndicatorPreset>
  renamePreset(id: string, indicatorId: string, name: string): Promise<void>
  updatePresetSettings(id: string, indicatorId: string, settings: IndicatorSettings): Promise<void>
  deletePreset(id: string, indicatorId: string): Promise<void>

  /**
   * Apply the preset to the (symbol, market, timeframe) currently visible in
   * the chart. Server-side merges into the per-key row WITHOUT touching
   * sibling indicators. After success the in-memory + localStorage caches are
   * invalidated so a fresh read picks up the merged row.
   */
  applyPresetToCurrent(
    presetId: string,
    indicatorId: string,
    settings: IndicatorSettings,
    symbol: string,
    market: string,
    timeframe: string,
  ): Promise<void>
}

const Ctx = createContext<IndicatorsStorageValue | null>(null)

function emptyEntry(): StoreEntry {
  return {
    indicators: [],
    source: 'system',
    updatedAt: new Date(0).toISOString(),
    loading: false,
    adminDefaultsTf: [],
    adminDefaultsAllTf: [],
  }
}

function systemDefaultsEntry(): StoreEntry {
  return {
    indicators: defaultStoredIndicators(),
    source: 'system',
    updatedAt: new Date().toISOString(),
    loading: false,
    adminDefaultsTf: [],
    adminDefaultsAllTf: [],
  }
}

/**
 * Provider that owns the per-key indicator store, talks to the server when
 * authed, and keeps a localStorage write-through copy as a degradation
 * fallback. Must be mounted under AuthProvider — login/logout transitions are
 * detected via `user?.id` change here.
 */
export function IndicatorsStorageProvider({ children }: { children: ReactNode }) {
  const { user, accessToken, loading: authLoading } = useAuthContext()
  const isLoggedIn = !!user && !!accessToken

  // Cache key for the latest user we synced for; used to detect login/logout
  // edges so we can refetch on transition without leaking previous-user data.
  const lastUserIdRef = useRef<string | null>(null)
  const inFlightRef = useRef<Set<string>>(new Set())

  // Drives reactivity: incremented whenever the in-memory map mutates so
  // `getForKey` consumers re-render. The map itself lives in a ref to avoid
  // stale closures when concurrent fetches finish in arbitrary order.
  const storeRef = useRef<Map<string, StoreEntry>>(new Map())
  const [revision, setRevision] = useState(0)
  const bumpRevision = useCallback(() => setRevision((v) => v + 1), [])

  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites())

  // One-shot legacy migration. Uses BTCUSDT/futures as the default symbol+market
  // because we don't have access to the active slot here — this matches the
  // ChartControlsContext default in ChartControlsContext.tsx.
  useEffect(() => {
    try {
      migrateLegacyV2IfNeeded('BTCUSDT', 'futures')
    } catch (err) {
      console.warn('[indicators] legacy migration failed', err)
    }
  }, [])

  // Hydrate in-memory map from localStorage on mount (warm cache).
  useEffect(() => {
    const v3 = loadStorageV3()
    for (const [key, entry] of Object.entries(v3.byKey)) {
      if (!storeRef.current.has(key)) {
        storeRef.current.set(key, { ...entry, loading: false })
      }
    }
    bumpRevision()
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On login/logout, drop the in-memory map (so we don't render stale data
  // from the previous identity) but KEEP the localStorage cache — the guest
  // continues working with whatever was there, and the authed user will
  // refetch from the server on next access.
  //
  // EXCEPTION: guest-mode indicator presets are NOT migrated. On the
  // guest→logged-in transition they are wiped so the user only sees what the
  // server has for them. (Documented behaviour from Feature 2 spec.)
  useEffect(() => {
    if (authLoading) return
    const newUserId = user?.id ?? null
    const transitionedToAuth = newUserId !== null && lastUserIdRef.current === null
    if (newUserId !== lastUserIdRef.current) {
      lastUserIdRef.current = newUserId
      storeRef.current.clear()
      inFlightRef.current.clear()
      if (transitionedToAuth) {
        clearGuestPresets()
      }
      // Reseed from localStorage so guest doesn't see a blank state mid-session.
      const v3 = loadStorageV3()
      for (const [key, entry] of Object.entries(v3.byKey)) {
        storeRef.current.set(key, { ...entry, loading: false })
      }
      bumpRevision()
    }
  }, [user?.id, authLoading, bumpRevision])

  /** Lazy server fetch with dedup; updates the cache + bumps revision when done. */
  const ensureFetched = useCallback((symbol: string, market: string, timeframe: string) => {
    const { comboKey, symbol: cs, market: cm, timeframe: ct } = canonKey(symbol, market, timeframe)
    if (inFlightRef.current.has(comboKey)) return
    inFlightRef.current.add(comboKey)

    // Mark loading on the existing entry (or create a placeholder).
    const existing = storeRef.current.get(comboKey)
    if (existing) {
      storeRef.current.set(comboKey, { ...existing, loading: true })
    } else {
      storeRef.current.set(comboKey, { ...emptyEntry(), loading: true })
    }
    bumpRevision()

    fetchIndicators(cs, cm, ct).then(
      (resolved: ResolvedIndicators) => {
        const entry: StoreEntry = {
          indicators: resolved.indicators,
          source: resolved.source,
          updatedAt: new Date().toISOString(),
          loading: false,
          adminDefaultsTf: resolved.adminDefaultsTf,
          adminDefaultsAllTf: resolved.adminDefaultsAllTf,
        }
        storeRef.current.set(comboKey, entry)
        writeCachedEntry(comboKey, entry)
        bumpRevision()
      },
      (err: unknown) => {
        console.warn('[indicators] fetch failed', { comboKey, err })
        const cached = storeRef.current.get(comboKey)
        if (cached) {
          storeRef.current.set(comboKey, { ...cached, loading: false })
        } else {
          storeRef.current.set(comboKey, systemDefaultsEntry())
        }
        bumpRevision()
      },
    ).finally(() => {
      inFlightRef.current.delete(comboKey)
    })
  }, [bumpRevision])

  const getForKey = useCallback((symbol: string, market: string, timeframe: string) => {
    const { comboKey, symbol: cs, market: cm, timeframe: ct } = canonKey(symbol, market, timeframe)

    let entry = storeRef.current.get(comboKey)
    if (!entry) {
      const cached = readCachedEntry(comboKey)
      entry = cached ? { ...cached, loading: false } : null as unknown as StoreEntry | undefined
      if (entry) storeRef.current.set(comboKey, entry)
    }

    // Kick off a refresh on first access (lazy load), but never block the
    // caller — return whatever we have right now (cache or system defaults).
    if (!entry || (!entry.loading && shouldRefresh(entry))) {
      ensureFetched(cs, cm, ct)
    }

    const render: StoreEntry = entry ?? systemDefaultsEntry()
    const hydrated = hydrateIndicators(render.indicators, favorites)
    // If the cascade landed at 'system' and the row is empty, fall back to the
    // catalogue's defaults so the chart isn't completely blank on first run.
    const finalIndicators = (hydrated.length === 0 && render.source === 'system')
      ? hydrateIndicators(defaultStoredIndicators(), favorites)
      : hydrated

    return {
      indicators: finalIndicators,
      activeIndicators: computeActiveIndicators(finalIndicators),
      source: render.source,
      loading: render.loading,
      adminDefaultsTf: render.adminDefaultsTf ?? [],
      adminDefaultsAllTf: render.adminDefaultsAllTf ?? [],
    }
  }, [favorites, ensureFetched, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const isLoading = useCallback((symbol: string, market: string, timeframe: string): boolean => {
    const { comboKey } = canonKey(symbol, market, timeframe)
    const e = storeRef.current.get(comboKey)
    return e ? e.loading : false
  }, [])

  const saveForKey = useCallback(async (symbol: string, market: string, timeframe: string, visible: Indicator[]) => {
    const { comboKey, symbol: cs, market: cm, timeframe: ct } = canonKey(symbol, market, timeframe)
    const previous = storeRef.current.get(comboKey)
    const stored = dehydrateForSave(visible, previous?.indicators ?? [])

    const optimistic: StoreEntry = {
      indicators: stored,
      source: isAllTf(ct) ? 'user-all-tf' : 'user-tf',
      updatedAt: new Date().toISOString(),
      loading: false,
      adminDefaultsTf: previous?.adminDefaultsTf ?? [],
      adminDefaultsAllTf: previous?.adminDefaultsAllTf ?? [],
    }
    storeRef.current.set(comboKey, optimistic)
    writeCachedEntry(comboKey, optimistic)
    bumpRevision()

    if (!isLoggedIn) return
    try {
      await putIndicators(cs, cm, ct, stored)
    } catch (err) {
      console.warn('[indicators] PUT failed, kept local cache', err)
    }
  }, [isLoggedIn, bumpRevision])

  const applyIndicatorsForKey = useCallback(async (symbol: string, market: string, timeframe: string, visible: Indicator[]) => {
    // Sync favorites (user-wide) BEFORE the per-key save so the next render
    // hydrates with the right star state.
    const wanted = new Set<string>()
    for (const i of visible) if (i.isFavorite) wanted.add(i.id)
    const current = favorites
    let changed = wanted.size !== current.size
    if (!changed) {
      for (const id of wanted) {
        if (!current.has(id)) { changed = true; break }
      }
    }
    if (changed) {
      setFavorites(wanted)
      writeFavorites(Array.from(wanted))
      if (isLoggedIn) {
        try {
          await putFavoriteIndicators(Array.from(wanted))
        } catch (err) {
          console.warn('[indicators] favorites sync failed', err)
        }
      }
    }
    // Per-key save is identical to saveForKey from here on.
    const { comboKey, symbol: cs, market: cm, timeframe: ct } = canonKey(symbol, market, timeframe)
    const previous = storeRef.current.get(comboKey)
    const stored = dehydrateForSave(visible, previous?.indicators ?? [])
    const optimistic: StoreEntry = {
      indicators: stored,
      source: isAllTf(ct) ? 'user-all-tf' : 'user-tf',
      updatedAt: new Date().toISOString(),
      loading: false,
      adminDefaultsTf: previous?.adminDefaultsTf ?? [],
      adminDefaultsAllTf: previous?.adminDefaultsAllTf ?? [],
    }
    storeRef.current.set(comboKey, optimistic)
    writeCachedEntry(comboKey, optimistic)
    bumpRevision()

    if (!isLoggedIn) return
    try {
      await putIndicators(cs, cm, ct, stored)
    } catch (err) {
      console.warn('[indicators] PUT failed (apply), kept local cache', err)
    }
  }, [favorites, isLoggedIn, bumpRevision])

  const propagateIndicator = useCallback(async (symbol: string, market: string, one: Indicator) => {
    const { comboKey: starKey, symbol: cs, market: cm } = canonKey(symbol, market, ALL_TF_MARKER)
    const oneStored: StoredIndicator = {
      id: one.id,
      isActive: one.isActive,
      ...(one.isVisible === undefined ? {} : { isVisible: one.isVisible }),
      settings: one.settings,
    }
    const nowIso = new Date().toISOString()

    // Optimistic cache patch: every in-memory key for (cs, cm) gets the same
    // replace-or-append treatment. Mirrors backend behaviour exactly: per-tf
    // rows not yet in cache stay absent (they'll resolve via the '*' row on
    // next fetch).
    const prefix = `${cs}_${cm}_`
    for (const [key, entry] of storeRef.current.entries()) {
      if (!key.startsWith(prefix)) continue
      const arr = [...entry.indicators]
      const idx = arr.findIndex((s) => s.id === one.id)
      if (idx >= 0) arr[idx] = oneStored
      else arr.push(oneStored)
      const patched: StoreEntry = {
        ...entry,
        indicators: arr,
        updatedAt: nowIso,
        loading: false,
      }
      storeRef.current.set(key, patched)
      writeCachedEntry(key, patched)
    }
    // Ensure the '*' key exists in cache even if no row was ever fetched for it.
    if (!storeRef.current.has(starKey)) {
      const star: StoreEntry = {
        indicators: [oneStored],
        source: 'user-all-tf',
        updatedAt: nowIso,
        loading: false,
      }
      storeRef.current.set(starKey, star)
      writeCachedEntry(starKey, star)
    }
    bumpRevision()

    if (!isLoggedIn) return
    try {
      await apiPropagateIndicator(cs, cm, oneStored)
    } catch (err) {
      console.warn('[indicators] propagate failed, kept local cache', err)
    }
  }, [isLoggedIn, bumpRevision])

  const refreshKey = useCallback(async (symbol: string, market: string, timeframe: string) => {
    const { comboKey, symbol: cs, market: cm, timeframe: ct } = canonKey(symbol, market, timeframe)
    try {
      const resolved = await fetchIndicators(cs, cm, ct)
      const entry: StoreEntry = {
        indicators: resolved.indicators,
        source: resolved.source,
        updatedAt: new Date().toISOString(),
        loading: false,
        adminDefaultsTf: resolved.adminDefaultsTf,
        adminDefaultsAllTf: resolved.adminDefaultsAllTf,
      }
      storeRef.current.set(comboKey, entry)
      writeCachedEntry(comboKey, entry)
      bumpRevision()
    } catch (err) {
      console.warn('[indicators] refresh failed', err)
    }
  }, [bumpRevision])

  const resetKey = useCallback(async (symbol: string, market: string, timeframe: string) => {
    const { comboKey, symbol: cs, market: cm, timeframe: ct } = canonKey(symbol, market, timeframe)
    storeRef.current.delete(comboKey)
    const v3 = loadStorageV3()
    delete v3.byKey[comboKey]
    saveStorageV3(v3)
    bumpRevision()

    if (!isLoggedIn) return
    try {
      await apiDeleteIndicators(cs, cm, ct)
    } catch (err) {
      console.warn('[indicators] DELETE failed', err)
    }
    // Schedule a refetch so the new (cascaded) layer is visible immediately.
    ensureFetched(cs, cm, ct)
  }, [isLoggedIn, ensureFetched, bumpRevision])

  const toggleFavorite = useCallback(async (id: string) => {
    const next = new Set(favorites)
    if (next.has(id)) next.delete(id); else next.add(id)
    setFavorites(next)
    writeFavorites(Array.from(next))
    if (!isLoggedIn) return
    try {
      await putFavoriteIndicators(Array.from(next))
    } catch (err) {
      console.warn('[indicators] favorites PUT failed, kept local', err)
    }
  }, [favorites, isLoggedIn])

  // ===== indicator presets =====

  const listPresets = useCallback(async (indicatorId: string) => {
    if (isLoggedIn) {
      try {
        return await apiListPresets(indicatorId)
      } catch (err) {
        console.warn('[indicator-presets] list failed', err)
        return { presets: [] }
      }
    }
    return { presets: readGuestPresetsFor(indicatorId) }
  }, [isLoggedIn])

  const savePreset = useCallback(async (indicatorId: string, name: string, settings: IndicatorSettings) => {
    const trimmed = name.trim()
    if (!trimmed) throw { code: 'INVALID_PARAMS', message: 'name required' }
    if (isLoggedIn) {
      const { id } = await apiCreatePreset(indicatorId, trimmed, settings)
      return { id, indicatorId, name: trimmed, settings, updatedAt: new Date().toISOString() }
    }
    const existing = readGuestPresetsFor(indicatorId)
    if (existing.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw { code: 'NAME_EXISTS', message: 'preset name already used for this indicator' }
    }
    const created: IndicatorPreset = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      indicatorId,
      name: trimmed,
      settings,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    writeGuestPresetsFor(indicatorId, [created, ...existing])
    return created
  }, [isLoggedIn])

  const renamePreset = useCallback(async (id: string, indicatorId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) throw { code: 'INVALID_PARAMS', message: 'name required' }
    if (isLoggedIn) {
      await apiUpdatePreset(id, { name: trimmed })
      return
    }
    const existing = readGuestPresetsFor(indicatorId)
    if (existing.some((p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw { code: 'NAME_EXISTS', message: 'preset name already used for this indicator' }
    }
    writeGuestPresetsFor(
      indicatorId,
      existing.map((p) => (p.id === id ? { ...p, name: trimmed, updatedAt: new Date().toISOString() } : p)),
    )
  }, [isLoggedIn])

  const updatePresetSettings = useCallback(async (id: string, indicatorId: string, settings: IndicatorSettings) => {
    if (isLoggedIn) {
      await apiUpdatePreset(id, { settings })
      return
    }
    const existing = readGuestPresetsFor(indicatorId)
    writeGuestPresetsFor(
      indicatorId,
      existing.map((p) => (p.id === id ? { ...p, settings, updatedAt: new Date().toISOString() } : p)),
    )
  }, [isLoggedIn])

  const deletePreset = useCallback(async (id: string, indicatorId: string) => {
    if (isLoggedIn) {
      await apiDeletePreset(id)
      return
    }
    const existing = readGuestPresetsFor(indicatorId)
    writeGuestPresetsFor(indicatorId, existing.filter((p) => p.id !== id))
  }, [isLoggedIn])

  const applyPresetToCurrent = useCallback(async (
    presetId: string,
    indicatorId: string,
    settings: IndicatorSettings,
    symbol: string,
    market: string,
    timeframe: string,
  ) => {
    const { comboKey, symbol: cs, market: cm, timeframe: ct } = canonKey(symbol, market, timeframe)
    // Optimistic local patch — same logic the server runs (replace settings
    // of matching id; append fresh active+visible entry otherwise).
    const previous = storeRef.current.get(comboKey)
    const prevArr = previous?.indicators ?? []
    const arr = [...prevArr]
    const idx = arr.findIndex((s) => s.id === indicatorId)
    if (idx >= 0) {
      const old = arr[idx]
      if (old) {
        arr[idx] = { ...old, settings }
      }
    } else {
      arr.push({ id: indicatorId, isActive: true, isVisible: true, settings })
    }
    const optimistic: StoreEntry = {
      indicators: arr,
      source: isAllTf(ct) ? 'user-all-tf' : 'user-tf',
      updatedAt: new Date().toISOString(),
      loading: false,
    }
    storeRef.current.set(comboKey, optimistic)
    writeCachedEntry(comboKey, optimistic)
    bumpRevision()

    if (!isLoggedIn) return
    try {
      await apiApplyPreset(presetId, cs, cm, ct)
    } catch (err) {
      console.warn('[indicator-presets] apply failed, kept local patch', err)
      // Force-refresh from server so the user sees authoritative state.
      ensureFetched(cs, cm, ct)
      throw err
    }
  }, [isLoggedIn, bumpRevision, ensureFetched])

  const value = useMemo<IndicatorsStorageValue>(() => ({
    getForKey,
    saveForKey,
    applyIndicatorsForKey,
    propagateIndicator,
    resetKey,
    refreshKey,
    favorites,
    toggleFavorite,
    isLoading,
    listPresets,
    savePreset,
    renamePreset,
    updatePresetSettings,
    deletePreset,
    applyPresetToCurrent,
  }), [
    getForKey, saveForKey, applyIndicatorsForKey, propagateIndicator, resetKey, refreshKey,
    favorites, toggleFavorite, isLoading,
    listPresets, savePreset, renamePreset, updatePresetSettings, deletePreset, applyPresetToCurrent,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useIndicatorsStorage() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useIndicatorsStorage must be used within IndicatorsStorageProvider')
  return ctx
}

/**
 * Convenience hook returning the per-slot computed indicators + per-slot
 * handlers (toggle/visibility/remove). All handlers write through to the same
 * key, so calling `onToggleIndicator` on slot 0 (BTC/futures/1m) only affects
 * that key — slot 1 with a different key is untouched.
 */
export function useIndicatorsForKey(symbol: string, market: string, timeframe: string) {
  const store = useIndicatorsStorage()
  const view = store.getForKey(symbol, market, timeframe)

  const handlers = useMemo(() => {
    const save = (updater: (current: Indicator[]) => Indicator[]) =>
      store.saveForKey(symbol, market, timeframe, updater(view.indicators))

    return {
      onToggleIndicator: (id: string) =>
        save((cur) => cur.map((i) => (i.id === id ? { ...i, isActive: !i.isActive } : i))),
      onToggleVisibility: (id: string) =>
        save((cur) =>
          cur.map((i) => (i.id === id ? { ...i, isVisible: i.isVisible === false ? true : false } : i)),
        ),
      onRemoveIndicator: (id: string) =>
        save((cur) => cur.map((i) => (i.id === id ? { ...i, isActive: false } : i))),
      onApplyIndicators: (updated: Indicator[]) =>
        store.applyIndicatorsForKey(symbol, market, timeframe, updated),
      refreshKey: () => store.refreshKey(symbol, market, timeframe),
    }
  }, [store, symbol, market, timeframe, view.indicators])

  return {
    indicators: view.indicators,
    activeIndicators: view.activeIndicators,
    source: view.source,
    loading: view.loading,
    adminDefaultsTf: view.adminDefaultsTf,
    adminDefaultsAllTf: view.adminDefaultsAllTf,
    handlers,
  }
}

/**
 * True iff the cached entry is older than the refresh window. For the MVP we
 * refresh whenever the entry is older than 5 minutes; the user always sees
 * the cached value first (no mid-render mutation).
 */
function shouldRefresh(entry: StoreEntry): boolean {
  if (!entry.updatedAt) return true
  const age = Date.now() - new Date(entry.updatedAt).getTime()
  return age > 5 * 60 * 1000
}
