import { request } from '@/features/auth/api'
import type { IndicatorSettings } from '@/chart2d/types'
import type { IndicatorPreset, ResolvedIndicators, StoredIndicator } from './types'

/**
 * HTTP client for the user_indicators endpoints. Mirrors the contract from
 * backend/internal/auth/indicators_handlers.go. All calls go through the
 * shared `request()` helper so Authorization is attached automatically when
 * an access token is available.
 */

interface ResolveResponseShape {
  indicators: unknown[]
  source: string
  adminDefaultsTf?: unknown[]
  adminDefaultsAllTf?: unknown[]
}

function asStoredIndicators(raw: unknown[]): StoredIndicator[] {
  const out: StoredIndicator[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = rec['id']
    if (typeof id !== 'string' || id === '') continue
    out.push({
      id,
      isActive: rec['isActive'] === true,
      ...(rec['isVisible'] === undefined ? {} : { isVisible: rec['isVisible'] === true }),
      settings: (rec['settings'] as StoredIndicator['settings']) ?? {},
    })
  }
  return out
}

/**
 * GET /api/v1/user/indicators?symbol&market&timeframe
 * Auth-optional. Guests see only admin-* and system tiers; authed callers get
 * the full cascade.
 */
export async function fetchIndicators(symbol: string, market: string, timeframe: string): Promise<ResolvedIndicators> {
  const qs = new URLSearchParams({ symbol, market, timeframe }).toString()
  const data = await request<ResolveResponseShape>(`/user/indicators?${qs}`)
  return {
    indicators: asStoredIndicators(data.indicators ?? []),
    source: (data.source as ResolvedIndicators['source']) ?? 'system',
    adminDefaultsTf: asStoredIndicators(data.adminDefaultsTf ?? []),
    adminDefaultsAllTf: asStoredIndicators(data.adminDefaultsAllTf ?? []),
  }
}

/**
 * PUT /api/v1/user/indicators with mode=replace. Requires auth.
 */
export async function putIndicators(
  symbol: string,
  market: string,
  timeframe: string,
  indicators: StoredIndicator[],
): Promise<void> {
  await request('/user/indicators', {
    method: 'PUT',
    body: JSON.stringify({ symbol, market, timeframe, indicators, mode: 'replace' }),
  })
}

/**
 * PUT /api/v1/user/indicators with mode=propagate. Pushes a SINGLE indicator
 * (identified by its id) into the (user, symbol, market, '*') row AND into
 * every EXISTING per-tf row of the same (user, symbol, market). Inside each
 * target row the id slot is replace-or-appended; sibling indicators are
 * preserved bit-for-bit. New per-tf rows are NOT created — TFs without their
 * own row pick the indicator up from the '*' row via the cascade.
 *
 * The wire format passes the indicator as a single object (not an array of
 * length one), matching the backend handler dispatch.
 */
export async function propagateIndicator(
  symbol: string,
  market: string,
  indicator: StoredIndicator,
): Promise<void> {
  await request('/user/indicators', {
    method: 'PUT',
    body: JSON.stringify({ symbol, market, mode: 'propagate', indicator }),
  })
}

/**
 * DELETE /api/v1/user/indicators?symbol&market&timeframe
 * Drops the user override so the cascade falls back to the next layer.
 */
export async function deleteIndicators(symbol: string, market: string, timeframe: string): Promise<void> {
  const qs = new URLSearchParams({ symbol, market, timeframe }).toString()
  await request(`/user/indicators?${qs}`, { method: 'DELETE' })
}

/**
 * PUT /api/v1/user/settings/favorite-indicators
 * Atomic single-field update; does not touch other keys in the JSON blob.
 */
export async function putFavoriteIndicators(ids: string[]): Promise<void> {
  await request('/user/settings/favorite-indicators', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}

/* ===== indicator presets (Feature 2) ===== */

interface PresetWire {
  id: string
  indicatorId: string
  name: string
  settings: IndicatorSettings
  createdAt?: string
  updatedAt?: string
  readonly?: boolean
}

interface ListPresetsResponse {
  presets: PresetWire[]
}

/**
 * GET /api/v1/user/indicator-presets?indicatorId=...
 * Auth-optional. Returns user-owned presets (empty for guests).
 */
export async function listIndicatorPresets(indicatorId: string): Promise<{
  presets: IndicatorPreset[]
}> {
  const qs = new URLSearchParams({ indicatorId }).toString()
  const data = await request<ListPresetsResponse>(`/user/indicator-presets?${qs}`)
  return {
    presets: (data.presets ?? []).map((p) => ({ ...p, settings: p.settings ?? {} })),
  }
}

export async function createIndicatorPreset(
  indicatorId: string,
  name: string,
  settings: IndicatorSettings,
): Promise<{ id: string }> {
  return request<{ id: string }>('/user/indicator-presets', {
    method: 'POST',
    body: JSON.stringify({ indicatorId, name, settings }),
  })
}

export async function updateIndicatorPreset(
  id: string,
  patch: { name?: string; settings?: IndicatorSettings },
): Promise<void> {
  await request(`/user/indicator-presets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export async function deleteIndicatorPreset(id: string): Promise<void> {
  await request(`/user/indicator-presets/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function applyIndicatorPreset(
  id: string,
  symbol: string,
  market: string,
  timeframe: string,
): Promise<{ indicatorId: string }> {
  const qs = new URLSearchParams({ symbol, market, timeframe }).toString()
  return request<{ indicatorId: string }>(
    `/user/indicator-presets/${encodeURIComponent(id)}/apply?${qs}`,
    { method: 'POST' },
  )
}
