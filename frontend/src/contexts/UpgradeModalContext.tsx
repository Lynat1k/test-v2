import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { PlansModal } from '@/components/plans/PlansModal'

interface UpgradeModalValue {
  openPlans: () => void
}

const UpgradeModalContext = createContext<UpgradeModalValue | null>(null)

/**
 * Holds the open state for the global upgrade modal and renders <PlansModal/>.
 * Mounted high in the App tree (inside Tiers/Limits providers) so any locked
 * control can call openPlans() to surface the tier cards.
 */
export function UpgradeModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openPlans = useCallback(() => setOpen(true), [])
  const closePlans = useCallback(() => setOpen(false), [])

  return (
    <UpgradeModalContext.Provider value={{ openPlans }}>
      {children}
      <PlansModal isOpen={open} onClose={closePlans} />
    </UpgradeModalContext.Provider>
  )
}

export function useUpgradeModal(): UpgradeModalValue {
  const ctx = useContext(UpgradeModalContext)
  if (!ctx) throw new Error('useUpgradeModal must be used within UpgradeModalProvider')
  return ctx
}
