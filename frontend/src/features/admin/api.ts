import { request } from '@/features/auth/api'

// --- Metrics ---

export interface ServerMetrics {
  cpu: { usagePercent: number }
  ram: { usedGB: number; totalGB: number; percent: number }
  disk: { usagePercent: number; usedGB: number; totalGB: number }
  database: { sqliteSizeBytes: number; clickHouseBytes: number }
  users: { registeredCount: number; onlineCount: number }
  logs: string[]
  timestamp: string
}

export async function apiGetMetrics(): Promise<ServerMetrics> {
  return request<ServerMetrics>('/admin/metrics')
}

export interface MetricsHistoryPoint {
  timestamp: string
  cpuPercent: number
  ramPercent: number
  ramUsedGB: number
  diskPercent: number
  diskUsedGB: number
}

export async function apiGetMetricsHistory(): Promise<MetricsHistoryPoint[]> {
  return request<MetricsHistoryPoint[]>('/admin/metrics/history')
}

// --- Users ---

export interface UserListItem {
  id: string
  email: string
  nickname: string
  role: string
  createdAt: string
}

export interface UserStats {
  registered: number
  onlineAuth: number
  hosts: number
}

export async function apiGetUserStats(): Promise<UserStats> {
  return request<UserStats>('/admin/users/stats')
}

export async function apiListUsers(limit = 50, offset = 0): Promise<{ users: UserListItem[]; limit: number; offset: number }> {
  return request<{ users: UserListItem[]; limit: number; offset: number }>(`/admin/users?limit=${limit}&offset=${offset}`)
}

export async function apiCreateUser(login: string, password: string, role: string, email?: string): Promise<{ id: string; login: string; email: string; role: string }> {
  return request<{ id: string; login: string; email: string; role: string }>('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ login, email, password, role }),
  })
}

export async function apiUpdateUserRole(id: string, role: string): Promise<{ id: string; email: string; oldRole: string; newRole: string }> {
  return request<{ id: string; email: string; oldRole: string; newRole: string }>(`/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export async function apiDeleteUser(id: string): Promise<void> {
  await request(`/admin/users/${id}`, { method: 'DELETE' })
}

// --- Policies ---

export interface TierPolicy {
  tier: string
  maxHistoryDays1m: number
  maxHistoryDays5m: number
  maxHistoryDays15m: number
  maxHistoryDays30m: number
  maxHistoryDays1h: number
  maxHistoryDays4h: number
  compressionLevels: number
  maxIndicators: number
  customIndicatorSettings: boolean
  telegramNotifications: boolean
  workspacesCount: number
  sessionLimit: number
}

export interface PoliciesResponse {
  policies: Record<string, TierPolicy>
}

export async function apiGetPolicies(): Promise<PoliciesResponse> {
  return request<PoliciesResponse>('/admin/policies')
}

export async function apiUpdatePolicies(policies: Record<string, Partial<TierPolicy>>): Promise<void> {
  await request('/admin/policies', {
    method: 'PUT',
    body: JSON.stringify({ policies }),
  })
}

// --- Tickers ---

export interface Ticker {
  id: string
  symbol: string
  name: string
  priceTickSpot: number
  priceTickFutures: number
  compressionSpot: number
  compressionFutures: number
  isActive: boolean
  createdAt: string
}

export async function apiGetTickers(): Promise<Ticker[]> {
  return request<Ticker[]>('/admin/tickers')
}

export async function apiAddTicker(data: {
  symbol: string
  name?: string
  priceTickSpot: number
  priceTickFutures: number
  compressionSpot: number
  compressionFutures: number
}): Promise<Ticker> {
  return request<Ticker>('/admin/tickers', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function apiUpdateTicker(id: string, data: Partial<Ticker>): Promise<void> {
  await request(`/admin/tickers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function apiDeleteTicker(id: string): Promise<void> {
  await request(`/admin/tickers/${id}`, { method: 'DELETE' })
}

// --- Default Compressions ---

export interface DefaultCompression {
  id: string
  symbol: string
  market: string
  timeframe: string
  multiplier: number
}

export async function apiGetCompressions(symbol: string): Promise<DefaultCompression[]> {
  return request<DefaultCompression[]>(`/admin/compressions?symbol=${encodeURIComponent(symbol)}`)
}

export async function apiUpsertCompressions(symbol: string, compressions: DefaultCompression[]): Promise<void> {
  await request('/admin/compressions', {
    method: 'PUT',
    body: JSON.stringify({ symbol, compressions }),
  })
}

// --- History Download ---

export interface DownloadJob {
  id: string
  symbol: string
  market: string
  startDate: string
  endDate: string
  status: string
  progress: number
  stepDetail: string
  error: string
  totalTicks: number
}

export async function apiStartDownload(data: {
  symbol: string
  market: string
  startDate: string
  endDate: string
}): Promise<{ jobId: string }> {
  return request<{ jobId: string }>('/admin/history/download', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function apiGetJobStatus(id: string): Promise<DownloadJob> {
  return request<DownloadJob>(`/admin/history/jobs/${id}`)
}

export async function apiGetJobs(): Promise<DownloadJob[]> {
  return request<DownloadJob[]>('/admin/history/jobs')
}

export async function apiClearJobs(): Promise<void> {
  await request('/admin/history/clear-jobs', { method: 'POST' })
}

// --- Billing ---

export interface PaymentRecord {
  id: string
  userId: string
  nickname: string
  subscriptionId: string
  tier: string
  status: string
  amount: number
  totalSpent: number
  paidAt: string
}

export interface BillingSummary {
  totalRevenue: number
  monthlyRevenue: number
  activeProCount: number
  activeVipCount: number
  waitingCount: number
  expiredCount: number
}

export interface BillingResponse {
  summary: BillingSummary
  payments: PaymentRecord[]
  total: number
  page: number
  pageSize: number
}

export async function apiGetBilling(page = 1, pageSize = 20): Promise<BillingResponse> {
  return request<BillingResponse>(`/admin/billing?page=${page}&pageSize=${pageSize}`)
}

export async function apiCreatePayment(data: {
  userId: string
  tier: string
  amount: number
  status: string
}): Promise<PaymentRecord> {
  return request<PaymentRecord>('/admin/billing', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function apiUpdatePayment(id: string, data: Partial<PaymentRecord>): Promise<void> {
  await request(`/admin/billing/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function apiDeletePayment(id: string): Promise<void> {
  await request(`/admin/billing/${id}`, { method: 'DELETE' })
}
