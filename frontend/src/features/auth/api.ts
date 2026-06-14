export interface AuthUser {
  id: string
  email: string
  nickname: string
  role: string
  emailVerified: boolean
}

interface AuthResponse {
  ok: boolean
  data?: { accessToken: string; user: AuthUser }
  error?: { code: string; message: string }
}

const BASE = '/api/v1'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers as Record<string, string> },
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

export async function apiPutSettings(settingsJson: string) {
  await fetch(`${BASE}/user/settings`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settingsJson }),
  })
}
