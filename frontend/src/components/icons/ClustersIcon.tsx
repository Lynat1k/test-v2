export const ClustersIcon = ({ className }: { className?: string }) => (
  <svg className={className ?? "w-4 h-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="3" width="14" height="18" rx="2" strokeWidth="2" />
    <line x1="5" y1="9" x2="19" y2="9" strokeWidth="1.5" />
    <line x1="5" y1="15" x2="19" y2="15" strokeWidth="1.5" />
    <line x1="12" y1="3" x2="12" y2="21" strokeWidth="1.2" strokeDasharray="2,2" />
  </svg>
)
