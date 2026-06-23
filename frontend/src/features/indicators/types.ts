import type { IndicatorSettings } from '@/chart2d/types'

/**
 * The narrow per-(symbol,market,timeframe) shape that is actually persisted.
 * `label`, `category`, and `type` are derived from MODULAR_INDICATORS by `id`
 * on hydration — duplicating them would let the storage drift when the
 * catalogue changes. `isFavorite` is user-wide (lives in user_settings) so it
 * is hydrated from a separate source as well.
 */
export interface StoredIndicator {
  id: string
  isActive: boolean
  isVisible?: boolean
  settings: IndicatorSettings
}

/**
 * Which cascade layer produced the indicators array for a given key.
 * The frontend uses this to render the explanatory badge in IndicatorsModal
 * (FE-11) so the user understands why an apparently-shared all-tf change
 * leaves a different timeframe untouched after a per-tf override.
 */
export type IndicatorsSource =
  | 'user-tf'
  | 'user-all-tf'
  | 'admin-tf'
  | 'admin-all-tf'
  | 'system'

export interface ResolvedIndicators {
  indicators: StoredIndicator[]
  source: IndicatorsSource
  /**
   * Raw admin_indicator_defaults row for (symbol, market, timeframe). Empty
   * array when no per-tf admin default exists. Surfaced separately from the
   * cascade-resolved `indicators` so the modal can render the virtual "admin
   * default" preset row and drive the admin-only "Дефолт" toggle without an
   * extra round-trip.
   */
  adminDefaultsTf: StoredIndicator[]
  /**
   * Raw admin_indicator_defaults row for (symbol, market, '*'). Empty array
   * when no all-tf admin default exists.
   */
  adminDefaultsAllTf: StoredIndicator[]
}

/** All-tf marker for the wire format (mirrors AllTimeframeMarker on the backend). */
export const ALL_TF_MARKER = '*'

/** localStorage key for the v3 store. v2 is the legacy single-array key. */
export const STORAGE_KEY_V3 = 'procluster_indicators_v3'
export const LEGACY_STORAGE_KEY_V2 = 'procluster_indicators_v2'

/** Migration tombstone preserves the legacy v2 payload for rollback. */
export const LEGACY_MIGRATED_KEY = 'procluster_indicators_v2_migrated'

/**
 * One indicator-settings preset. Per-indicator, per-user.
 * `id` is a server-issued uuid (or a guest-local id for non-authed users).
 */
export interface IndicatorPreset {
  id: string
  indicatorId: string
  name: string
  settings: IndicatorSettings
  createdAt?: string
  updatedAt?: string
  readonly?: boolean
}

/** Guest-mode localStorage key for personal presets (mirrors v3 indicators key). */
export const PRESETS_STORAGE_KEY_V1 = 'procluster_indicator_presets_v1'

export interface PresetsStorageV1 {
  version: 1
  /** keyed by indicatorId → array of presets ordered by updatedAt desc */
  byIndicator: Record<string, IndicatorPreset[]>
}

export interface StorageV3 {
  version: 3
  byKey: Record<string, CachedEntry>
  favorites: string[]
  migratedFrom?: string
}

export interface CachedEntry {
  indicators: StoredIndicator[]
  source: IndicatorsSource
  updatedAt: string
  /**
   * Snapshot of the admin_indicator_defaults rows for the same key. Optional
   * because v3 entries written before this field existed will not have it; the
   * store hydrates a `[]` default on read.
   */
  adminDefaultsTf?: StoredIndicator[]
  adminDefaultsAllTf?: StoredIndicator[]
}
