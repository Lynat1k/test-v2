// Minimal global toast bus. No deps — a module-level listener list + a small
// host component (ToastHost.tsx) mounted once at the app root.
//
// Use `notify('text')` from anywhere. The host owns rendering and timing.

export type ToastKind = 'info' | 'warn' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
  ttlMs: number
}

type Listener = (t: Toast) => void

const listeners = new Set<Listener>()
let nextId = 1

export function notify(text: string, opts: { kind?: ToastKind; ttlMs?: number } = {}): void {
  const t: Toast = {
    id: nextId++,
    kind: opts.kind ?? 'info',
    text,
    ttlMs: opts.ttlMs ?? 4500,
  }
  for (const fn of listeners) fn(t)
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// Helper used in indicator endpoints — recognises the backend's
// CUSTOM_SETTINGS_FORBIDDEN error shape thrown by features/auth/api.ts
// `request()`.
export function reportCustomSettingsForbidden(err: unknown): void {
  if (err && typeof err === 'object' && (err as { code?: string }).code === 'CUSTOM_SETTINGS_FORBIDDEN') {
    notify('Изменение настроек индикаторов недоступно на вашем тарифе', { kind: 'warn' })
  }
}
