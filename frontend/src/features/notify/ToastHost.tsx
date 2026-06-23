import { useEffect, useState } from 'react'
import { subscribeToasts, type Toast } from './toast'

export default function ToastHost() {
  const [items, setItems] = useState<Toast[]>([])

  useEffect(() => {
    return subscribeToasts((t) => {
      setItems((prev) => [...prev, t])
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id))
      }, t.ttlMs)
    })
  }, [])

  if (items.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={
            'pointer-events-auto px-4 py-3 rounded-xl border text-sm font-semibold shadow-lg max-w-sm backdrop-blur-md ' +
            (t.kind === 'error'
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-200'
              : t.kind === 'warn'
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
              : 'bg-slate-700/70 border-slate-500/30 text-slate-100')
          }
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
