interface CandlePreviewIconProps {
  palette: 'default' | 'alternative'
  theme?: string
}

export const CandlePreviewIcon = ({ palette, theme }: CandlePreviewIconProps) => {
  const isDefault = palette === 'default'
  const isLight = theme === 'light'
  const bullColor = isDefault ? '#10b981' : (isLight ? '#E3E3E3' : '#B6B2B2')
  const bearColor = isDefault ? '#f43f5e' : (isLight ? '#292929' : '#5E5E5E')
  const bullBorder = isDefault ? '#10b981' : (isLight ? '#2F2F2F' : '#D5D5D5')
  const bearBorder = isDefault ? '#f43f5e' : (isLight ? '#3A3A3A' : '#AEA7A7')

  return (
    <svg width="22" height="18" viewBox="0 0 22 18" className="inline-block shrink-0 select-none">
      <line x1="6" y1="2" x2="6" y2="16" stroke={bullBorder} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3.5" y="5" width="5" height="8" fill={bullColor} stroke={bullBorder} strokeWidth="1" rx="0.5" />
      <line x1="16" y1="2" x2="16" y2="16" stroke={bearBorder} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="13.5" y="7" width="5" height="7" fill={bearColor} stroke={bearBorder} strokeWidth="1" rx="0.5" />
    </svg>
  )
}
