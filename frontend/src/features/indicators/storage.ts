import type { Indicator, IndicatorSettings } from '@/chart2d/types'
import { MODULAR_INDICATORS } from '@/chart2d/indicators'
import {
  ALL_TF_MARKER,
  LEGACY_MIGRATED_KEY,
  LEGACY_STORAGE_KEY_V2,
  PRESETS_STORAGE_KEY_V1,
  STORAGE_KEY_V3,
} from './types'
import type {
  CachedEntry,
  IndicatorPreset,
  PresetsStorageV1,
  StorageV3,
  StoredIndicator,
} from './types'

/**
 * Canonicalises a (symbol, market, timeframe) triple to the on-the-wire form:
 *   symbol → UPPERCASE   (e.g. "BTCUSDT")
 *   market → lowercase   ("futures" | "spot")
 *   tf     → lowercase   ("1m" | "5m" | ... | "*")
 *
 * The backend also normalises, but we do it here too so that the cache key
 * (used for lookups in localStorage and the in-memory map) is always the same
 * regardless of what casing the caller passed in. Without this, a save at
 * `FUTURES` and a read at `futures` would hit two distinct map entries.
 */
export function canonKey(symbol: string, market: string, timeframe: string): {
  symbol: string
  market: string
  timeframe: string
  comboKey: string
} {
  const s = symbol.trim().toUpperCase()
  const m = market.trim().toLowerCase()
  const t = timeframe.trim().toLowerCase()
  return { symbol: s, market: m, timeframe: t, comboKey: `${s}_${m}_${t}` }
}

/**
 * Hydrates a stored indicator (id + isActive + isVisible + settings) into the
 * full Indicator type the chart engine expects, by looking up the static
 * fields (label/category/type) from the MODULAR_INDICATORS catalogue.
 *
 * Unknown ids — left over from a renamed/removed indicator — are dropped from
 * the rendered output (with a console.warn) so they do not crash the canvas.
 * They are intentionally PRESERVED in `stored` and re-emitted by
 * `dehydrateForSave` so a future catalogue rollback does not destroy data.
 */
export function hydrateIndicators(
  stored: StoredIndicator[],
  favorites: ReadonlySet<string>,
): Indicator[] {
  const out: Indicator[] = []
  const seen = new Set<string>()
  for (const s of stored) {
    const meta = MODULAR_INDICATORS.find((m) => m.id === s.id)
    if (!meta) {
      console.warn(`[indicators] unknown id "${s.id}" — not rendered, preserved in storage`)
      continue
    }
    seen.add(s.id)
    out.push({
      id: s.id,
      label: meta.label,
      category: meta.category,
      type: meta.type,
      isFavorite: favorites.has(s.id),
      isActive: s.isActive,
      ...(s.isVisible === undefined ? {} : { isVisible: s.isVisible }),
      settings: { ...meta.defaultSettings, ...s.settings } as IndicatorSettings,
    })
  }
  for (const meta of MODULAR_INDICATORS) {
    if (seen.has(meta.id)) continue
    // Недостающие в сохранённом наборе индикаторы добиваются как ВЫКЛЮЧЕННЫЕ,
    // чтобы дефолты админа/пользователя оставались единственным источником
    // правды и системные isActiveDefault не протекали поверх них.
    out.push({
      id: meta.id,
      label: meta.label,
      category: meta.category,
      type: meta.type,
      isFavorite: favorites.has(meta.id),
      isActive: false,
      isVisible: true,
      settings: { ...meta.defaultSettings } as IndicatorSettings,
    })
  }
  return out
}

/**
 * Reverse of hydrateIndicators: trims a full Indicator[] back down to the
 * persisted shape, and re-attaches any stored entries whose id is missing
 * from the visible array (passthrough for unknown ids — see hydrateIndicators).
 *
 * `visible` is the array the modal worked with (only known ids that round-trip
 * through hydrate); `previousStored` is the pre-edit storage. Entries in
 * previousStored whose id is NOT in visible AND whose id is NOT in
 * MODULAR_INDICATORS are appended back so saving a known-id edit does not
 * accidentally delete unknown-id rows.
 */
export function dehydrateForSave(
  visible: Indicator[],
  previousStored: ReadonlyArray<StoredIndicator>,
): StoredIndicator[] {
  const visibleIds = new Set(visible.map((i) => i.id))
  const out: StoredIndicator[] = visible.map((i) => ({
    id: i.id,
    isActive: i.isActive,
    ...(i.isVisible === undefined ? {} : { isVisible: i.isVisible }),
    settings: i.settings,
  }))
  for (const s of previousStored) {
    if (visibleIds.has(s.id)) continue
    const isKnown = MODULAR_INDICATORS.some((m) => m.id === s.id)
    if (isKnown) continue // dropped from visible by deliberate user action
    out.push(s) // passthrough
  }
  return out
}

/**
 * Returns the default StoredIndicator array used when no row exists in any
 * cascade layer (source='system'). Mirrors the existing useIndicators
 * buildDefaultIndicators() output shape but only the per-key fields are kept.
 */
export function defaultStoredIndicators(): StoredIndicator[] {
  return MODULAR_INDICATORS.map((mod) => ({
    id: mod.id,
    isActive: mod.isActiveDefault ?? false,
    isVisible: true,
    settings: { ...mod.defaultSettings },
  }))
}

// --- localStorage v3 read/write ---

function safeParseV3(): StorageV3 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V3)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const rec = parsed as Partial<StorageV3>
    if (rec.version !== 3) return null
    return {
      version: 3,
      byKey: typeof rec.byKey === 'object' && rec.byKey !== null ? rec.byKey : {},
      favorites: Array.isArray(rec.favorites) ? rec.favorites.filter((x) => typeof x === 'string') : [],
      ...(typeof rec.migratedFrom === 'string' ? { migratedFrom: rec.migratedFrom } : {}),
    }
  } catch {
    return null
  }
}

export function loadStorageV3(): StorageV3 {
  return safeParseV3() ?? { version: 3, byKey: {}, favorites: [] }
}

export function saveStorageV3(s: StorageV3): void {
  try {
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(s))
  } catch (err) {
    console.warn('[indicators] localStorage write failed', err)
  }
}

export function readCachedEntry(comboKey: string): CachedEntry | null {
  const s = loadStorageV3()
  const entry = s.byKey[comboKey]
  return entry ?? null
}

export function writeCachedEntry(comboKey: string, entry: CachedEntry): void {
  const s = loadStorageV3()
  s.byKey[comboKey] = entry
  saveStorageV3(s)
}

export function readFavorites(): Set<string> {
  return new Set(loadStorageV3().favorites)
}

export function writeFavorites(ids: ReadonlyArray<string>): void {
  const s = loadStorageV3()
  s.favorites = Array.from(new Set(ids))
  saveStorageV3(s)
}

// --- legacy v2 → v3 one-shot migration ---

/**
 * Migrates the legacy `procluster_indicators_v2` array, if present, into a
 * single scope=all-tf cached entry for the supplied symbol+market. Idempotent —
 * the v3 store's `migratedFrom` field is set on success so subsequent loads
 * are no-ops. The legacy key is renamed (not deleted) so the user can roll back
 * if something goes wrong.
 *
 * Returns true when a migration ran in this call.
 */
export function migrateLegacyV2IfNeeded(currentSymbol: string, currentMarket: string): boolean {
  const v3 = loadStorageV3()
  if (v3.migratedFrom === LEGACY_STORAGE_KEY_V2) return false

  let legacyRaw: string | null = null
  try {
    legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY_V2)
  } catch {
    return false
  }
  if (!legacyRaw) {
    // Nothing to migrate, but mark as migrated so we don't probe every load.
    v3.migratedFrom = LEGACY_STORAGE_KEY_V2
    saveStorageV3(v3)
    return false
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(legacyRaw)
  } catch {
    return false
  }
  if (!Array.isArray(parsed)) {
    // Corrupt — preserve under a tombstone and stop probing.
    try {
      localStorage.setItem(`${LEGACY_MIGRATED_KEY}_corrupt`, legacyRaw)
      localStorage.removeItem(LEGACY_STORAGE_KEY_V2)
    } catch {
      // swallow
    }
    v3.migratedFrom = LEGACY_STORAGE_KEY_V2
    saveStorageV3(v3)
    return false
  }

  const trimmed: StoredIndicator[] = []
  for (const it of parsed as Array<Record<string, unknown>>) {
    const id = it['id']
    if (typeof id !== 'string') continue
    trimmed.push({
      id,
      isActive: it['isActive'] === true,
      ...(it['isVisible'] === undefined ? {} : { isVisible: it['isVisible'] === true }),
      settings: (it['settings'] as IndicatorSettings) ?? {},
    })
  }

  const { comboKey } = canonKey(currentSymbol, currentMarket, ALL_TF_MARKER)
  v3.byKey[comboKey] = {
    indicators: trimmed,
    source: 'user-all-tf',
    updatedAt: new Date().toISOString(),
  }
  v3.migratedFrom = LEGACY_STORAGE_KEY_V2
  saveStorageV3(v3)

  // Rename rather than delete so the user can roll back.
  try {
    localStorage.setItem(LEGACY_MIGRATED_KEY, legacyRaw)
    localStorage.removeItem(LEGACY_STORAGE_KEY_V2)
  } catch {
    // swallow
  }
  return true
}

/**
 * Derives `activeIndicators` record (id → isActive && isVisible !== false)
 * from a hydrated array, matching the shape ChartContainer2 already expects.
 */
export function computeActiveIndicators(indicators: Indicator[]): Record<string, boolean> {
  const record: Record<string, boolean> = { volume: false }
  for (const ind of indicators) {
    record[ind.id] = ind.isActive && ind.isVisible !== false
  }
  return record
}

/** Type guard for the all-tf marker constant. */
export function isAllTf(timeframe: string): boolean {
  return timeframe === ALL_TF_MARKER
}

// --- guest-mode presets store (Feature 2) ---

function safeParsePresetsV1(): PresetsStorageV1 | null {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY_V1)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const rec = parsed as Partial<PresetsStorageV1>
    if (rec.version !== 1) return null
    return {
      version: 1,
      byIndicator: typeof rec.byIndicator === 'object' && rec.byIndicator !== null ? rec.byIndicator : {},
    }
  } catch {
    return null
  }
}

export function loadPresetsV1(): PresetsStorageV1 {
  return safeParsePresetsV1() ?? { version: 1, byIndicator: {} }
}

export function savePresetsV1(s: PresetsStorageV1): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY_V1, JSON.stringify(s))
  } catch (err) {
    console.warn('[indicator-presets] localStorage write failed', err)
  }
}

export function readGuestPresetsFor(indicatorId: string): IndicatorPreset[] {
  return loadPresetsV1().byIndicator[indicatorId] ?? []
}

export function writeGuestPresetsFor(indicatorId: string, presets: IndicatorPreset[]): void {
  const s = loadPresetsV1()
  s.byIndicator[indicatorId] = presets
  savePresetsV1(s)
}

/**
 * Drop guest-mode presets entirely. Called on login transition: per the spec,
 * guest presets are NOT migrated to the server — they're discarded.
 */
export function clearGuestPresets(): void {
  try {
    localStorage.removeItem(PRESETS_STORAGE_KEY_V1)
  } catch {
    /* swallow */
  }
}
