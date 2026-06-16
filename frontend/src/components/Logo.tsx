import logoFull from '@/assets/images/procluster_logo_1779485281399.png'
import logoMini from '@/assets/images/procluster_logo_mini.png'

export function Logo() {
  return (
    <div className="flex items-center gap-1.5 sm:gap-3 select-none cursor-pointer group hover:opacity-95 transition-all duration-200" title="ProCluster">
      <img src={logoMini} alt="PROCLUSTER" className="h-7 w-auto sm:hidden" />
      <img src={logoFull} alt="PROCLUSTER" className="hidden sm:block h-8 w-auto" />
    </div>
  )
}
