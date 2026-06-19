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
