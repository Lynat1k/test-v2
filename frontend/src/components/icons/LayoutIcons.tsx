interface IconProps {
  className?: string
}

export function SingleChartIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
    </svg>
  )
}

export function HorizontalSplitIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2" width="5.5" height="12" rx="1" />
      <rect x="9" y="2" width="5.5" height="12" rx="1" />
    </svg>
  )
}

export function VerticalSplitIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="1.5" width="12" height="5.5" rx="1" />
      <rect x="2" y="9" width="12" height="5.5" rx="1" />
    </svg>
  )
}
