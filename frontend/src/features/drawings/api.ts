import { request } from '@/features/auth/api'

const BASE = '/api/v1'

export type DrawingDefaultsMap = Record<string, Record<string, unknown>>

export async function apiGetDrawingDefaults(): Promise<DrawingDefaultsMap> {
  const res = await fetch(`${BASE}/user/drawing-defaults`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  const json = await res.json() as { ok: boolean; data?: DrawingDefaultsMap; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
  return json.data ?? {}
}

export async function apiGetDrawingDefaultsWithToken(token: string): Promise<DrawingDefaultsMap> {
  const res = await fetch(`${BASE}/user/drawing-defaults`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  const json = await res.json() as { ok: boolean; data?: DrawingDefaultsMap; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
  return json.data ?? {}
}

export async function apiPutDrawingDefault(drawingType: string, settings: Record<string, unknown>): Promise<void> {
  await request<void>('/user/drawing-defaults', {
    method: 'PUT',
    body: JSON.stringify({ drawingType, settings }),
  })
}

// --- Phase 14 Step 2: Saved drawings ---

export interface DrawingSaveItem {
  id: string
  drawingType: string
  payload: Record<string, unknown>
}

export interface DrawingResponseItem {
  id: string
  drawingType: string
  payload: Record<string, unknown>
}

export async function apiGetDrawings(symbol: string, interval: string, market: string, token: string): Promise<DrawingResponseItem[]> {
  const res = await fetch(`${BASE}/user/drawings?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&market=${encodeURIComponent(market)}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  const json = await res.json() as { ok: boolean; data?: DrawingResponseItem[]; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
  return json.data ?? []
}

export async function apiPutDrawings(
  symbol: string,
  interval: string,
  market: string,
  drawings: DrawingSaveItem[],
  token: string,
): Promise<void> {
  const res = await fetch(`${BASE}/user/drawings`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ symbol, interval, market, drawings }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.warn(`[apiPutDrawings] ${res.status} ${res.statusText}: ${text}`)
    let err: { code: string; message: string }
    try { const parsed = JSON.parse(text); err = parsed.error || { code: 'HTTP_ERROR', message: text } } catch { err = { code: 'HTTP_ERROR', message: text } }
    throw err
  }
  const json = await res.json() as { ok: boolean; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
}

export async function apiDeleteDrawing(id: string): Promise<void> {
  await request<void>(`/user/drawings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
