export interface AuthUser {
  id: string
  email: string
  nickname: string
  role: string
  emailVerified: boolean
  avatar: string
  createdAt: string
  subscriptionStatus: string
  subscriptionPaidAt: string
  subscriptionExpiresAt: string
  compressionMax?: number
}

interface AuthResponse {
  ok: boolean
  data?: { accessToken: string; user: AuthUser }
  error?: { code: string; message: string }
}

interface MeResponse {
  ok: boolean
  data?: ProfileData
  error?: { code: string; message: string }
}

interface ProfileData {
  id: string
  email: string
  nickname: string
  role: string
  emailVerified: boolean
  avatar: string
  createdAt: string
  subscriptionStatus: string
  subscriptionPaidAt: string
  subscriptionExpiresAt: string
  daysLeft: number
  compressionMax?: number
}

const BASE = '/api/v1'

let accessTokenRef: string | null = null
export function setApiAccessToken(token: string | null) { accessTokenRef = token }

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessTokenRef ? { Authorization: `Bearer ${accessTokenRef}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
    ...options,
  })
  const json = await res.json() as AuthResponse
  if (!json.ok) throw json.error!
  return json.data as T
}

export async function apiLogin(email: string, password: string) {
  return request<{ accessToken: string; user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function apiRegister(email: string, password: string, nickname: string) {
  return request<{ accessToken: string; user: AuthUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, nickname }),
  })
}

export async function apiLogout() {
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
}

export async function apiRefresh() {
  return request<{ accessToken: string; user: AuthUser }>('/auth/refresh', { method: 'POST' })
}

export async function apiVerifyEmail(token: string) {
  return request<{ ok: boolean }>(`/auth/verify-email?token=${token}`)
}

export async function apiResendVerification() {
  return request<{ ok: boolean }>('/auth/recovery', { method: 'POST', body: JSON.stringify({}) })
}

export async function apiGetSettings() {
  return request<{ settingsJson: string }>('/user/settings')
}

export interface UserLimits {
  tier: string
  sessionLimit: number
  historyMaxDays: number
  compressionMax: number
  maxIndicators: number
  customIndicatorSettings: number
  telegramEnabled: number
  workspacesCount: number
  anomaliesEnabled: number
  historyDaysPerTf: Record<string, number>
}

export async function apiGetLimits(): Promise<UserLimits> {
  return request<UserLimits>('/user/limits')
}

export async function apiGetLimitsWithToken(token: string): Promise<UserLimits> {
  const res = await fetch(`${BASE}/user/limits`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  const json = await res.json() as { ok: boolean; data?: UserLimits; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
  return json.data as UserLimits
}

export async function apiGetLimitsPublic(): Promise<UserLimits> {
  const res = await fetch(`${BASE}/user/limits`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  const json = await res.json() as { ok: boolean; data?: UserLimits; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
  return json.data as UserLimits
}

// --- Public tier policies (GET /tiers, no auth, guest-accessible) ---

// Same shape as UserLimits without the per-user `tier` field.
export type PublicTierPolicy = Omit<UserLimits, 'tier'>

export interface PublicTiers {
  free: PublicTierPolicy
  pro: PublicTierPolicy
  vip: PublicTierPolicy
}

// Public endpoint — must NOT send the Authorization header (guest access).
export async function apiGetTiers(): Promise<PublicTiers> {
  const res = await fetch(`${BASE}/tiers`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  const json = await res.json() as { ok: boolean; data?: PublicTiers; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
  return json.data as PublicTiers
}

export interface PublicCompressionDefault {
  market: string
  timeframe: string
  multiplier: number
}

export async function apiGetCompressionDefaults(symbol: string): Promise<PublicCompressionDefault[]> {
  return request<PublicCompressionDefault[]>(`/compressions?symbol=${encodeURIComponent(symbol)}`)
}

export async function apiPutSettings(settingsJson: string) {
  await request('/user/settings', {
    method: 'PUT',
    body: JSON.stringify({ settingsJson }),
  })
}

// --- Site settings (beta mode) ---

export async function apiGetSiteSettings(): Promise<{ betaMode: boolean }> {
  try {
    const res = await fetch(`${BASE}/site-settings`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return { betaMode: false }
    return res.json()
  } catch {
    return { betaMode: false }
  }
}

export async function apiUpdateBetaMode(betaMode: boolean): Promise<{ ok: boolean; data: { betaMode: boolean } }> {
  return request('/admin/site-settings', {
    method: 'PUT',
    body: JSON.stringify({ betaMode }),
  })
}

// --- Phase 10: Profile API ---

export async function apiGetMe() {
  const res = await fetch(`${BASE}/user/me`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessTokenRef ? { Authorization: `Bearer ${accessTokenRef}` } : {}),
    },
  })
  const json = await res.json() as MeResponse
  if (!json.ok) throw json.error!
  return json.data!
}

export async function apiUpdateProfile(nickname: string, avatar: string) {
  const res = await fetch(`${BASE}/user/profile`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessTokenRef ? { Authorization: `Bearer ${accessTokenRef}` } : {}),
    },
    body: JSON.stringify({ nickname, avatar }),
  })
  const json = await res.json() as { ok: boolean; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
}

export async function apiChangePassword(currentPassword: string, newPassword: string) {
  const res = await fetch(`${BASE}/user/change-password`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessTokenRef ? { Authorization: `Bearer ${accessTokenRef}` } : {}),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  const json = await res.json() as { ok: boolean; error?: { code: string; message: string } }
  if (!json.ok) throw json.error!
}
