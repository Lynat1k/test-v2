import { Layers } from 'lucide-react'

export function Logo() {
  return (
    <div className="flex items-center gap-1.5 sm:gap-3 select-none cursor-pointer group hover:opacity-95 transition-all duration-200" title="ProCluster">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 via-amber-500 to-amber-600 flex items-center justify-center shadow-md scale-100 group-hover:scale-105 active:scale-95 transition-all duration-200 shadow-amber-500/15">
        <Layers className="text-slate-950 stroke-[2.5]" style={{ width: '17px', height: '17px' }} />
      </div>
      <div className="hidden sm:flex flex-col text-left leading-none">
        <span className="text-sm sm:text-lg font-black tracking-tight leading-none font-sans">
          <span className="text-white">PRO</span>
          <span className="text-amber-400">CLUSTER</span>
        </span>
        <span className="text-[7px] sm:text-[9px] font-mono tracking-widest font-bold uppercase leading-none mt-0.5 sm:mt-1.5 text-slate-400">
          Cluster Analytics
        </span>
      </div>
    </div>
  )
}
