import { useState, useEffect, useRef } from "react"
import type { Indicator, IndicatorSettings } from "@/chart2d/types"
import { X, Search, Star, Trash2, Eye, EyeOff, Layers, Activity, ChevronDown, ArrowUp, ArrowDown } from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { MODULAR_INDICATORS } from "@/chart2d/indicators"
import { INDICATOR_DESCRIPTIONS } from "@/chart2d/indicators/descriptions"
import { useUserLimits } from "@/contexts/LimitsContext"

interface IndicatorsModalProps {
  isOpen: boolean
  onClose: () => void
  symbol?: string
  indicators?: Indicator[]
  focusIndicatorId?: string | null
  onApplyIndicators?: (indicators: Indicator[]) => void
  onToggleVisibility?: (id: string) => void
}

function buildDefaultIndicators(): Indicator[] {
  return MODULAR_INDICATORS.map((mod) => ({
    id: mod.id,
    label: mod.label,
    category: mod.category,
    type: mod.type,
    isFavorite: false,
    isActive: mod.isActiveDefault ?? false,
    isVisible: true,
    settings: { ...mod.defaultSettings },
  }))
}

export default function IndicatorsModal({ isOpen, onClose, symbol = "", indicators, focusIndicatorId, onApplyIndicators, onToggleVisibility }: IndicatorsModalProps) {
  const { limits } = useUserLimits()
  const maxIndicators = limits.maxIndicators >= 100 ? Infinity : limits.maxIndicators

  const [draft, setDraft] = useState<Indicator[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedId, setSelectedId] = useState("clusterSearch")

  const [size, setSize] = useState({ width: 855, height: 800 })
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0 })
  const sizeStart = useRef({ width: 855, height: 800 })
  const resizeOffsetStart = useRef({ x: 0, y: 0 })

  const [expandedTabs, setExpandedTabs] = useState<{
    "Все индикаторы": boolean
    "Избранные": boolean
    "Сообщество": boolean
  }>({
    "Все индикаторы": true,
    "Избранные": false,
    "Сообщество": false,
  })

  const toggleTabExpanded = (tabName: keyof typeof expandedTabs) => {
    setExpandedTabs(prev => ({ ...prev, [tabName]: !prev[tabName] }))
  }

  const isSectionExpanded = (tabName: keyof typeof expandedTabs) => {
    if (searchQuery.trim() !== "") return true
    return expandedTabs[tabName]
  }

  const getAccordionIndicators = (tabName: keyof typeof expandedTabs) => {
    return draft.filter((ind) => {
      if (tabName === "Избранные" && !ind.isFavorite) return false
      if (tabName === "Сообщество" && ind.category !== "Сообщество") return false
      if (searchQuery.trim() !== "") {
        return ind.label.replace("(PROCLUSTER) ", "").toLowerCase().includes(searchQuery.toLowerCase())
      }
      return true
    })
  }

  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const modalOffset = useRef({ x: 0, y: 0 })

  const prevIsOpen = useRef(isOpen)
  const initialIndicators = useRef<Indicator[]>([])

  useEffect(() => {
    if (isOpen && !prevIsOpen.current) {
      const source = (indicators && indicators.length > 0) ? indicators : buildDefaultIndicators()
      const cloned = JSON.parse(JSON.stringify(source)) as Indicator[]
      setDraft(cloned)
      initialIndicators.current = cloned
      if (focusIndicatorId) setSelectedId(focusIndicatorId)
      setOffset({ x: 0, y: 0 })
      setSize({ width: 855, height: 800 })
    }
    prevIsOpen.current = isOpen
  }, [isOpen, indicators, focusIndicatorId])

  const handleCancel = () => {
    onClose()
  }

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setOffset({ x: modalOffset.current.x + dx, y: modalOffset.current.y + dy })
    }

    const handleMouseUp = () => setDragging(false)

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [dragging])

  useEffect(() => {
    if (!resizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStart.current.x
      const dy = e.clientY - resizeStart.current.y

      const newWidth = Math.max(700, Math.min(1300, sizeStart.current.width + dx))
      const newHeight = Math.max(480, Math.min(950, sizeStart.current.height + dy))

      setSize({ width: newWidth, height: newHeight })
      setOffset({
        x: resizeOffsetStart.current.x + (newWidth - sizeStart.current.width) / 2,
        y: resizeOffsetStart.current.y + (newHeight - sizeStart.current.height) / 2,
      })
    }

    const handleMouseUp = () => setResizing(false)

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [resizing])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest(".no-drag")) return
    if (e.button !== 0) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    modalOffset.current = { ...offset }
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY }
    sizeStart.current = { ...size }
    resizeOffsetStart.current = { ...offset }
  }

  if (!isOpen) return null

  const selectedIndicator = draft.find((i) => i.id === selectedId) || draft[0]

  const updateSettings = (updates: Partial<IndicatorSettings>) => {
    if (!selectedIndicator) return
    setDraft((prev) =>
      prev.map((ind) => {
        if (ind.id === selectedIndicator.id) {
          return { ...ind, settings: { ...ind.settings, ...updates } }
        }
        return ind
      })
    )
  }

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft((prev) => prev.map((ind) => (ind.id === id ? { ...ind, isFavorite: !ind.isFavorite } : ind)))
  }

  const toggleActive = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()

    const target = draft.find((ind) => ind.id === id)
    if (target && !target.isActive) {
      const activeCount = draft.filter((ind) => ind.isActive).length
      if (activeCount >= maxIndicators) return
    }

    setDraft((prev) =>
      prev.map((ind) => (ind.id === id ? { ...ind, isActive: !ind.isActive } : ind))
    )
  }

  const deactivateIndicator = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft((prev) => prev.map((ind) => (ind.id === id ? { ...ind, isActive: false } : ind)))
  }

  const toggleVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft((prev) =>
      prev.map((ind) => (ind.id === id ? { ...ind, isVisible: ind.isVisible === false ? true : false } : ind))
    )
  }

  const moveIndicator = (id: string, direction: "up" | "down", e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft((prev) => {
      const list = [...prev]
      const index = list.findIndex((ind) => ind.id === id)
      if (index === -1) return prev

      let targetIndex = -1
      if (direction === "up") {
        for (let i = index - 1; i >= 0; i--) {
          if (list[i]?.isActive) { targetIndex = i; break }
        }
      } else {
        for (let i = index + 1; i < list.length; i++) {
          if (list[i]?.isActive) { targetIndex = i; break }
        }
      }

      if (targetIndex !== -1) {
        const item = list[index]; if (!item) return prev
        const targetItem = list[targetIndex]; if (!targetItem) return prev
        const temp = item
        list[index] = targetItem
        list[targetIndex] = temp
      }
      return list
    })
  }

  const handleApply = () => {
    onApplyIndicators?.(draft)
    onClose()
  }

  const addedIndicators = draft.filter((ind) => ind.isActive)

  const isLight = false

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none bg-transparent">
      <div
        className="pointer-events-auto relative"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 15 }}
          className={`rounded-3xl flex flex-col overflow-hidden font-sans border shadow-2xl relative muddy-glass-popover ${isLight ? "border-slate-200/50 text-slate-850" : "border-white/10 text-slate-200"}`}
          style={{ width: `${size.width}px`, height: `${size.height}px` }}
        >
          {/* HEADER */}
          <div
            onMouseDown={handleMouseDown}
            className={`flex items-center justify-between px-6 py-4.5 border-b transition-all duration-300 cursor-grab active:cursor-grabbing select-none ${isLight ? "bg-white/30 border-slate-200/80 text-slate-800" : "border-white/5 bg-slate-950/20"}`}
          >
            <div className="flex items-center gap-2.5 pointer-events-none">
              <Layers className="w-5 h-5 text-blue-500" />
              <span className="text-base font-bold tracking-wide">
                Индикаторы <span className="text-slate-455 font-medium font-mono">{"→"} {symbol || "..."}</span>
              </span>
            </div>
            <button
              onClick={handleCancel}
              className={`p-1 rounded-full transition-colors cursor-pointer no-drag ${isLight ? "hover:bg-slate-200/55 text-slate-550 hover:text-slate-800" : "hover:bg-white/5 text-slate-400 hover:text-slate-100"}`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* WORKSPACE */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* LEFT SIDEBAR */}
            <div className={`w-[335px] p-4 border-r flex flex-col gap-4 select-none transition-all duration-300 shrink-0 ${isLight ? "bg-slate-50/50 border-slate-200" : "bg-slate-900/10 border-white/5"}`}>
              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Поиск индикаторов..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full border rounded-xl py-1.5 px-3.5 pl-9 text-xs outline-none font-sans transition-all duration-300 no-drag ${isLight ? "bg-slate-50 border-slate-200 text-slate-850 placeholder-slate-400 focus:ring-1 focus:ring-blue-400 focus:border-blue-400" : "bg-[#030712]/50 border border-white/10 text-slate-200 placeholder-slate-500 focus:ring-1 focus:ring-yellow-500/40 focus:border-yellow-500/40"}`}
                />
              </div>

              {/* Active indicators */}
              <div className={`flex flex-col min-h-0 border-b pb-3 shrink-0 flex-[0.7] ${isLight ? "border-slate-200" : "border-white/5"}`}>
                <span className="text-[10px] font-bold text-slate-500 tracking-widest uppercase mb-2 block font-mono pl-1">
                  АКТИВНЫЕ ({addedIndicators.length})
                </span>
                <div className={`flex-1 overflow-y-auto pr-1 flex flex-col gap-1.5 ${isLight ? "scrollbar-thin-light" : "scrollbar-thin-dark"}`}>
                  <AnimatePresence initial={false}>
                    {addedIndicators.length === 0 ? (
                      <div className="text-slate-500 text-[11px] italic pl-1.5 pt-1">
                        Нет активных индикаторов
                      </div>
                    ) : (
                      addedIndicators.map((ind, idx) => {
                        const isVisible = ind.isVisible !== false
                        return (
                          <motion.div
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                            key={ind.id}
                            onClick={() => setSelectedId(ind.id)}
                            className={`flex items-center justify-between px-3 py-2 rounded-xl border transition-all cursor-pointer no-drag ${!isVisible ? "opacity-60" : ""} ${selectedId === ind.id
                              ? isLight
                                ? "bg-blue-50 border-blue-200 text-blue-850 animate-pulse"
                                : "bg-blue-600/15 border-blue-500/30 text-slate-100"
                              : isLight
                                ? "bg-transparent border-transparent hover:bg-slate-100 text-slate-600"
                                : "bg-white/0 border-transparent hover:bg-white/5 text-slate-350"
                              }`}
                          >
                            <span className="text-xs truncate font-medium font-sans pr-2">
                              {ind.label.replace("(PROCLUSTER) ", "")}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                disabled={idx === 0}
                                onClick={(e) => moveIndicator(ind.id, "up", e)}
                                className={`p-1 rounded transition ${idx === 0 ? "opacity-20 cursor-not-allowed" : isLight ? "hover:bg-slate-200 text-slate-500 hover:text-slate-850" : "hover:bg-white/10 text-slate-400 hover:text-slate-200"}`}
                                title="Переместить вверх"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                disabled={idx === addedIndicators.length - 1}
                                onClick={(e) => moveIndicator(ind.id, "down", e)}
                                className={`p-1 rounded transition ${idx === addedIndicators.length - 1 ? "opacity-20 cursor-not-allowed" : isLight ? "hover:bg-slate-200 text-slate-500 hover:text-slate-850" : "hover:bg-white/10 text-slate-400 hover:text-slate-200"}`}
                                title="Переместить вниз"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => { toggleVisibility(ind.id, e); onToggleVisibility?.(ind.id) }}
                                className={`p-1 rounded transition ${isLight ? "hover:bg-slate-200/80 text-slate-500 hover:text-slate-850" : "hover:bg-white/10 text-slate-400 hover:text-slate-200"}`}
                                title={isVisible ? "Скрыть на графике" : "Показать на графике"}
                              >
                                {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-rose-500 font-bold" />}
                              </button>
                              <button
                                onClick={(e) => deactivateIndicator(ind.id, e)}
                                className={`p-1 rounded transition ${isLight ? "hover:bg-rose-100 text-slate-500 hover:text-rose-600" : "hover:bg-rose-500/20 text-slate-400 hover:text-rose-400"}`}
                                title="Удалить из активных"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </motion.div>
                        )
                      })
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Accordion categories */}
              <div className={`flex-1 overflow-y-auto pr-1 flex flex-col gap-2 min-h-0 ${isLight ? "scrollbar-thin-light" : "scrollbar-thin-dark"}`}>
                {(["Все индикаторы", "Избранные", "Сообщество"] as const).map((tab) => {
                  const items = getAccordionIndicators(tab)
                  const isExpanded = isSectionExpanded(tab)
                  const count = items.length

                  return (
                    <div key={tab} className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => toggleTabExpanded(tab)}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer no-drag ${isExpanded
                          ? isLight
                            ? "bg-blue-50 border border-blue-205 text-blue-700 font-extrabold"
                            : "bg-gradient-to-r from-blue-600/35 to-blue-500/10 border border-blue-500/25 text-blue-400 font-extrabold"
                          : isLight
                            ? "text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200/50"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/5"
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-0" : "-rotate-90"}`} />
                          <span>{tab}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold transition-all duration-300 ${isExpanded ? isLight ? "bg-blue-100 text-blue-800" : "bg-blue-500/20 text-blue-400" : isLight ? "bg-slate-200 text-slate-605" : "bg-slate-800 text-slate-400"}`}>
                          {count}
                        </span>
                      </button>

                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="overflow-hidden flex flex-col gap-1 pl-1"
                          >
                            {items.length === 0 ? (
                              <div className="text-slate-500 text-[10.5px] italic pl-6 py-1.5">
                                Нет индикаторов
                              </div>
                            ) : (
                              items.map((ind) => {
                                const isSelected = selectedId === ind.id
                                return (
                                  <div
                                    key={ind.id}
                                    onClick={() => setSelectedId(ind.id)}
                                    className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition select-none border no-drag ${isSelected
                                      ? isLight
                                        ? "bg-blue-50 border-blue-205"
                                        : "bg-blue-600/10 border border-blue-500/20"
                                      : isLight
                                        ? "bg-transparent border-transparent hover:bg-slate-100/70"
                                        : "bg-white/0 border border-transparent hover:bg-white/5"
                                      }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className={`text-xs truncate font-medium ${isSelected ? isLight ? "text-blue-900 font-extrabold" : "text-slate-100 font-bold" : isLight ? "text-slate-700" : "text-slate-305"}`}>
                                        {ind.label.replace("(PROCLUSTER) ", "")}
                                      </span>
                                      {ind.isActive && (
                                        <span className={`text-[8px] font-black rounded px-1 uppercase tracking-wide shrink-0 ${isLight ? "bg-blue-100 text-blue-700 animate-pulse" : "bg-blue-500/10 text-blue-400"}`}>
                                          АКТИВЕН
                                        </span>
                                      )}
                                    </div>

                                    <button
                                      onClick={(e) => toggleFavorite(ind.id, e)}
                                      className={`p-1 rounded transition ml-2 shrink-0 ${isLight ? "hover:bg-slate-205 text-slate-400 hover:text-yellow-550" : "hover:bg-white/10 text-slate-400 hover:text-yellow-405"}`}
                                    >
                                      <Star className={`w-3.5 h-3.5 ${ind.isFavorite ? "fill-yellow-400 text-yellow-400" : "text-slate-500"}`} />
                                    </button>
                                  </div>
                                )
                              })
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className={`flex-1 p-5 overflow-y-auto flex flex-col gap-5 select-none transition-all duration-300 ${isLight ? "bg-slate-50/70 scrollbar-thin-light" : "bg-slate-950/5 scrollbar-thin-dark"}`}>
              {selectedIndicator ? (
                <div className="flex flex-col gap-5">
                  {/* Title Card */}
                  <div className={`flex items-center justify-between pb-3 border-b transition-all duration-300 ${isLight ? "border-slate-200" : "border-white/5"}`}>
                    <div>
                      <h3 className={`text-[15px] font-extrabold tracking-tight font-sans flex items-center gap-1.5 leading-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                        {selectedIndicator.label.replace("(PROCLUSTER) ", "")}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[10px] text-slate-550 font-bold font-mono tracking-widest leading-none">
                          ТИП: {selectedIndicator.type.toUpperCase()}
                        </p>
                        <span className={`text-[9px] font-bold rounded px-1.5 py-0.5 uppercase tracking-wide font-mono scale-90 leading-none ${isLight ? "bg-slate-200/80 text-slate-750" : "bg-white/10 text-slate-300"}`}>
                          Оверлей
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <button
                        onClick={() => toggleActive(selectedIndicator.id)}
                        className="px-3.5 py-1.5 font-bold text-[11px] rounded-lg cursor-pointer transition-all active:scale-[0.98] text-white bg-blue-650 hover:bg-blue-600/90"
                      >
                        {selectedIndicator.isActive ? "Добавить еще" : "Активировать"}
                      </button>
                      <span className={`text-[10px] font-bold font-mono leading-none ${selectedIndicator.isActive ? isLight ? "text-emerald-600" : "text-emerald-400" : isLight ? "text-amber-600" : "text-amber-500"}`}>
                        {selectedIndicator.isActive ? "Активно: 1 шт." : "Деактивирован"}
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div className={`p-3 rounded-xl border transition-all duration-300 flex items-start gap-2.5 ${isLight ? "bg-blue-50/40 border-blue-250/20" : "bg-blue-500/5 border-blue-500/10 text-slate-300"}`}>
                    <Activity className={`w-4 h-4 mt-0.5 shrink-0 ${isLight ? "text-blue-600" : "text-blue-450"}`} />
                    <div className="flex flex-col min-w-0">
                      <p className={`text-[11px] leading-relaxed ${isLight ? "text-slate-700" : "text-slate-350"}`}>
                        <span className={`font-bold ${isLight ? "text-slate-850" : "text-slate-200"}`}>
                          {INDICATOR_DESCRIPTIONS[selectedIndicator.id]?.desc || "Отображает математический и статистический анализ ценовых графиков."}
                        </span>{" "}
                        {INDICATOR_DESCRIPTIONS[selectedIndicator.id]?.details || "Визуализирует распределение объемов, плотностей и дисбалансов покупателей и продавцов на рабочей панели."}
                      </p>
                    </div>
                  </div>

                  {/* Settings */}
                  <div className="flex flex-col gap-4">
                    {!limits.customIndicatorSettings && (
                      <div className={`p-3.5 border rounded-xl text-center text-xs font-bold mb-1 flex flex-col md:flex-row items-center justify-center gap-2 leading-relaxed ${isLight ? "bg-rose-50 border-rose-200 text-rose-800 shadow-sm" : "bg-rose-500/10 border-rose-505/15 text-rose-450"}`}>
                        <X className="w-4 h-4 shrink-0 text-red-500 animate-pulse" />
                        <span>Настройки индикаторов заблокированы для вашего тарифа ({limits.tier.toUpperCase()})! Настройте политики в Админке.</span>
                      </div>
                    )}

                    <div className={!limits.customIndicatorSettings ? "pointer-events-none opacity-30 select-none cursor-not-allowed" : ""}>
                      {selectedIndicator.id === "clusterSearch" && (
                        <>
                          {/* MEDIUM FILTER */}
                          <div className={`flex flex-col gap-3 rounded-2xl p-4 border transition-all duration-300 ${isLight ? "bg-slate-100/50 border-slate-200" : "bg-white/5 border-white/5"}`}>
                            <div className="flex items-center justify-between w-full">
                              <span className={`text-[11px] uppercase tracking-wider font-extrabold font-mono flex items-center gap-2 ${isLight ? "text-slate-600" : "text-slate-400"}`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                Средний фильтр объема
                              </span>
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={selectedIndicator.settings.csMedEnabled !== false}
                                  onChange={(e) => updateSettings({ csMedEnabled: e.target.checked })}
                                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                />
                                <span className="text-[10px] font-bold text-slate-400">Вкл.</span>
                              </label>
                            </div>

                            <div className={`flex flex-col gap-3 transition-opacity duration-300 ${selectedIndicator.settings.csMedEnabled === false ? "opacity-35 pointer-events-none" : "opacity-100"}`}>
                              <div className="grid grid-cols-2 gap-3.5">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Мин. объем</span>
                                  <input
                                    type="number"
                                    value={selectedIndicator.settings.csMedMinVolume ?? 100}
                                    onChange={(e) => updateSettings({ csMedMinVolume: parseFloat(e.target.value) || 0 })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Макс. объем</span>
                                  <input
                                    type="number"
                                    value={selectedIndicator.settings.csMedMaxVolume ?? 500}
                                    onChange={(e) => updateSettings({ csMedMaxVolume: parseFloat(e.target.value) || 0 })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>
                              </div>

                              <div className="grid grid-cols-2 gap-3.5">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Мин. размер фигуры (px)</span>
                                  <input
                                    type="number"
                                    value={selectedIndicator.settings.csMedMinSize ?? 4}
                                    onChange={(e) => updateSettings({ csMedMinSize: parseInt(e.target.value) || 0 })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Макс. размер фигуры (px)</span>
                                  <input
                                    type="number"
                                    value={selectedIndicator.settings.csMedMaxSize ?? 12}
                                    onChange={(e) => updateSettings({ csMedMaxSize: parseInt(e.target.value) || 0 })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>
                              </div>

                              <div className="grid grid-cols-2 gap-3.5">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Объединение уровней</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={selectedIndicator.settings.csMedMergeLevels ?? selectedIndicator.settings.csMergeLevels ?? 1}
                                    onChange={(e) => updateSettings({ csMedMergeLevels: Math.max(1, parseInt(e.target.value) || 1) })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>

                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Перевес по bid/ask (%)</span>
                                  <div className="relative">
                                    <input
                                      type="number"
                                      min="50"
                                      max="100"
                                      value={selectedIndicator.settings.csMedImbalancePercent ?? selectedIndicator.settings.csImbalancePercent ?? 60}
                                      onChange={(e) => updateSettings({ csMedImbalancePercent: Math.max(50, Math.min(100, parseInt(e.target.value) || 50)) })}
                                      className={`w-full rounded-xl px-3 py-2 pr-8 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                    />
                                    <span className="absolute right-3 top-2.5 text-slate-500 font-mono text-xs font-bold">%</span>
                                  </div>
                                </label>
                              </div>

                              <div className="grid grid-cols-2 gap-3.5">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Фильтрация по дельте</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={selectedIndicator.settings.csMedMinDelta ?? 0}
                                    onChange={(e) => updateSettings({ csMedMinDelta: Math.max(0, parseFloat(e.target.value) || 0) })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>

                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Расположение в свече</span>
                                  <select
                                    value={selectedIndicator.settings.csMedLocation ?? "any"}
                                    onChange={(e) => updateSettings({ csMedLocation: e.target.value as any })}
                                    className={`rounded-xl px-2 py-2 text-xs outline-none cursor-pointer transition-all border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  >
                                    <option value="any">Вся свеча</option>
                                    <option value="body">Тело свечи</option>
                                    <option value="lowerWick">Нижняя тень</option>
                                    <option value="upperWick">Верхняя тень</option>
                                  </select>
                                </label>
                              </div>

                              <div className="grid grid-cols-3 gap-2">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Форма</span>
                                  <select
                                    value={selectedIndicator.settings.csMedShape ?? "circle"}
                                  onChange={(e) => updateSettings({ csMedShape: e.target.value as any })}
                                  className={`rounded-xl px-2 py-2 text-xs outline-none cursor-pointer transition-all border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  >
                                    <option value="circle">Круг (Circle)</option>
                                    <option value="square">Квадрат (Square)</option>
                                    <option value="rhombus">Ромб (Rhombus)</option>
                                  </select>
                                </label>

                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Цвет Ask</span>
                                  <div className="flex items-center gap-1 mt-1">
                                    <input
                                      type="color"
                                      value={selectedIndicator.settings.csMedColorAsk ?? "#10b981"}
                                      onChange={(e) => updateSettings({ csMedColorAsk: e.target.value })}
                                      className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                                    />
                                    <span className="text-[9px] font-mono text-slate-400 truncate">{selectedIndicator.settings.csMedColorAsk ?? "#10b981"}</span>
                                  </div>
                                </label>

                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Цвет Bid</span>
                                  <div className="flex items-center gap-1 mt-1">
                                    <input
                                      type="color"
                                      value={selectedIndicator.settings.csMedColorBid ?? "#ef4444"}
                                      onChange={(e) => updateSettings({ csMedColorBid: e.target.value })}
                                      className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                                    />
                                    <span className="text-[9px] font-mono text-slate-400 truncate">{selectedIndicator.settings.csMedColorBid ?? "#ef4444"}</span>
                                  </div>
                                </label>
                              </div>

                              <div className="flex flex-col gap-1.5 mt-1.5">
                                <div className={`flex justify-between font-bold text-xs ${isLight ? "text-slate-700" : "text-slate-300"}`}>
                                  <span>Прозрачность выделения</span>
                                  <span className="font-mono text-yellow-500">{Math.round((selectedIndicator.settings.csMedOpacity ?? 0.70) * 100)}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="0.1"
                                  max="1.0"
                                  step="0.05"
                                  value={selectedIndicator.settings.csMedOpacity ?? 0.7}
                                  onChange={(e) => updateSettings({ csMedOpacity: parseFloat(e.target.value) })}
                                  className="w-full accent-blue-600 rounded-lg h-1 bg-slate-800"
                                />
                              </div>

                              <label className={`flex items-center gap-2.5 p-2 rounded-xl cursor-pointer mt-1 ${isLight ? "hover:bg-slate-150 bg-slate-200/50 text-slate-700 border-slate-300" : "hover:bg-white/5 bg-slate-950/45 text-slate-200 border-white/5"} border`}>
                                <input
                                  type="checkbox"
                                  checked={selectedIndicator.settings.csMedTgAlert ?? false}
                                  onChange={(e) => updateSettings({ csMedTgAlert: e.target.checked })}
                                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                                />
                                <div className="flex flex-col">
                                  <span className="font-bold text-[11px]">Уведомление в Телеграм канал / чат</span>
                                  <span className={`text-[9.5px] font-medium ${isLight ? "text-slate-500" : "text-slate-400"}`}>Только для VIP & Admin</span>
                                </div>
                              </label>
                            </div>
                          </div>

                          {/* LARGE FILTER */}
                          <div className={`flex flex-col gap-3 rounded-2xl p-4 border transition-all duration-300 ${isLight ? "bg-slate-100/50 border-slate-200" : "bg-white/5 border-white/5"}`}>
                            <div className="flex items-center justify-between w-full">
                              <span className={`text-[11px] uppercase tracking-wider font-extrabold font-mono flex items-center gap-2 ${isLight ? "text-slate-600" : "text-slate-400"}`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                                Крупный фильтр объема
                              </span>
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={selectedIndicator.settings.csLargeEnabled !== false}
                                  onChange={(e) => updateSettings({ csLargeEnabled: e.target.checked })}
                                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                />
                                <span className="text-[10px] font-bold text-slate-400">Вкл.</span>
                              </label>
                            </div>

                            <div className={`flex flex-col gap-3 transition-opacity duration-300 ${selectedIndicator.settings.csLargeEnabled === false ? "opacity-35 pointer-events-none" : "opacity-100"}`}>
                              <label className="flex flex-col gap-1.5 text-xs">
                                <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Минимальный объем (мин объем)</span>
                                <input
                                  type="number"
                                  value={selectedIndicator.settings.csLargeMinVolume ?? 500}
                                  onChange={(e) => updateSettings({ csLargeMinVolume: parseFloat(e.target.value) || 0 })}
                                  className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                />
                              </label>

                              <div className="grid grid-cols-2 gap-3.5">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Мин. размер фигуры (px)</span>
                                  <input
                                    type="number"
                                    value={selectedIndicator.settings.csLargeMinSize ?? 10}
                                    onChange={(e) => updateSettings({ csLargeMinSize: parseInt(e.target.value) || 0 })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Макс. размер фигуры (px)</span>
                                  <input
                                    type="number"
                                    value={selectedIndicator.settings.csLargeMaxSize ?? 20}
                                    onChange={(e) => updateSettings({ csLargeMaxSize: parseInt(e.target.value) || 0 })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>
                              </div>

                              <div className="grid grid-cols-2 gap-3.5">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Объединение уровней</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={selectedIndicator.settings.csLargeMergeLevels ?? selectedIndicator.settings.csMergeLevels ?? 1}
                                    onChange={(e) => updateSettings({ csLargeMergeLevels: Math.max(1, parseInt(e.target.value) || 1) })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>

                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Перевес по bid/ask (%)</span>
                                  <div className="relative">
                                    <input
                                      type="number"
                                      min="50"
                                      max="100"
                                      value={selectedIndicator.settings.csLargeImbalancePercent ?? selectedIndicator.settings.csImbalancePercent ?? 60}
                                      onChange={(e) => updateSettings({ csLargeImbalancePercent: Math.max(50, Math.min(100, parseInt(e.target.value) || 50)) })}
                                      className={`w-full rounded-xl px-3 py-2 pr-8 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                    />
                                    <span className="absolute right-3 top-2.5 text-slate-500 font-mono text-xs font-bold">%</span>
                                  </div>
                                </label>
                              </div>

                              <div className="grid grid-cols-2 gap-3.5">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Фильтрация по дельте</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={selectedIndicator.settings.csLargeMinDelta ?? 0}
                                    onChange={(e) => updateSettings({ csLargeMinDelta: Math.max(0, parseFloat(e.target.value) || 0) })}
                                    className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  />
                                </label>

                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Расположение в свече</span>
                                  <select
                                    value={selectedIndicator.settings.csLargeLocation ?? "any"}
                                    onChange={(e) => updateSettings({ csLargeLocation: e.target.value as any })}
                                    className={`rounded-xl px-2 py-2 text-xs outline-none cursor-pointer transition-all border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  >
                                    <option value="any">Вся свеча</option>
                                    <option value="body">Тело свечи</option>
                                    <option value="lowerWick">Нижняя тень</option>
                                    <option value="upperWick">Верхняя тень</option>
                                  </select>
                                </label>
                              </div>

                              <div className="grid grid-cols-3 gap-2">
                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Форма</span>
                                  <select
                                    value={selectedIndicator.settings.csLargeShape ?? "rhombus"}
                                  onChange={(e) => updateSettings({ csLargeShape: e.target.value as any })}
                                  className={`rounded-xl px-2 py-2 text-xs outline-none cursor-pointer transition-all border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                  >
                                    <option value="circle">Круг (Circle)</option>
                                    <option value="square">Квадрат (Square)</option>
                                    <option value="rhombus">Ромб (Rhombus)</option>
                                  </select>
                                </label>

                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Цвет Ask</span>
                                  <div className="flex items-center gap-1 mt-1">
                                    <input
                                      type="color"
                                      value={selectedIndicator.settings.csLargeColorAsk ?? "#34d399"}
                                      onChange={(e) => updateSettings({ csLargeColorAsk: e.target.value })}
                                      className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                                    />
                                    <span className="text-[9px] font-mono text-slate-400 truncate">{selectedIndicator.settings.csLargeColorAsk ?? "#34d399"}</span>
                                  </div>
                                </label>

                                <label className="flex flex-col gap-1.5 text-xs">
                                  <span className={isLight ? "text-slate-700 font-medium" : "text-slate-350"}>Цвет Bid</span>
                                  <div className="flex items-center gap-1 mt-1">
                                    <input
                                      type="color"
                                      value={selectedIndicator.settings.csLargeColorBid ?? "#f43f5e"}
                                      onChange={(e) => updateSettings({ csLargeColorBid: e.target.value })}
                                      className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                                    />
                                    <span className="text-[9px] font-mono text-slate-400 truncate">{selectedIndicator.settings.csLargeColorBid ?? "#f43f5e"}</span>
                                  </div>
                                </label>
                              </div>

                              <div className="flex flex-col gap-1.5 mt-1.5">
                                <div className={`flex justify-between font-bold text-xs ${isLight ? "text-slate-700" : "text-slate-300"}`}>
                                  <span>Прозрачность выделения</span>
                                  <span className="font-mono text-yellow-500">{Math.round((selectedIndicator.settings.csLargeOpacity ?? 0.90) * 100)}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="0.1"
                                  max="1.0"
                                  step="0.05"
                                  value={selectedIndicator.settings.csLargeOpacity ?? 0.9}
                                  onChange={(e) => updateSettings({ csLargeOpacity: parseFloat(e.target.value) })}
                                  className="w-full accent-blue-600 rounded-lg h-1 bg-slate-800"
                                />
                              </div>

                              <label className={`flex items-center gap-2.5 p-2 rounded-xl cursor-pointer mt-1 ${isLight ? "hover:bg-slate-150 bg-slate-200/50 text-slate-700 border-slate-300" : "hover:bg-white/5 bg-slate-950/45 text-slate-200 border-white/5"} border`}>
                                <input
                                  type="checkbox"
                                  checked={selectedIndicator.settings.csLargeTgAlert ?? false}
                                  onChange={(e) => updateSettings({ csLargeTgAlert: e.target.checked })}
                                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                                />
                                <div className="flex flex-col">
                                  <span className="font-bold text-[11px]">Уведомление в Телеграм канал / чат</span>
                                  <span className={`text-[9.5px] font-medium ${isLight ? "text-slate-500" : "text-slate-400"}`}>Только для VIP & Admin</span>
                                </div>
                              </label>
                            </div>
                          </div>
                        </>
                      )}

                      {(selectedIndicator.id === "volume" || selectedIndicator.id === "volumeOnChart" || selectedIndicator.id === "volumeProfile") && (
                        <div className="flex flex-col gap-4 font-sans text-xs">
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black font-mono">
                            ВИЗУАЛИЗАЦИЯ
                          </span>

                          <div className="flex flex-col gap-2">
                            <div className="flex justify-between font-bold">
                              <span className={isLight ? "text-slate-700" : "text-slate-300"}>Opacity / Прозрачность</span>
                              <span className={`font-mono font-bold ${isLight ? "text-blue-700" : "text-yellow-500"}`}>
                                {Math.round((selectedIndicator.settings.opacity || 0.4) * 100)}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.1"
                              max="1.0"
                              step="0.05"
                              value={selectedIndicator.settings.opacity || 0.4}
                              onChange={(e) => updateSettings({ opacity: parseFloat(e.target.value) })}
                              className={`w-full accent-blue-600 rounded-lg h-1 ${isLight ? "bg-slate-200" : "bg-slate-800"}`}
                            />
                          </div>

                          {selectedIndicator.id === "volumeOnChart" && (
                            <>
                              <div className="flex flex-col gap-2">
                                <div className="flex justify-between font-bold">
                                  <span className={isLight ? "text-slate-700" : "text-slate-300"}>Max Height % / Макс. высота %</span>
                                  <span className={`font-mono font-bold ${isLight ? "text-blue-700" : "text-yellow-500"}`}>
                                    {selectedIndicator.settings.volumeOnChartMaxHeightPercent ?? 20}%
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="5"
                                  max="100"
                                  step="5"
                                  value={selectedIndicator.settings.volumeOnChartMaxHeightPercent ?? 20}
                                  onChange={(e) => updateSettings({ volumeOnChartMaxHeightPercent: parseInt(e.target.value) })}
                                  className={`w-full accent-blue-600 rounded-lg h-1 ${isLight ? "bg-slate-200" : "bg-slate-800"}`}
                                />
                                <span className={`text-[10px] ${isLight ? "text-slate-500/80" : "text-slate-400/80"}`}>
                                  Максимальная высота гистограммы объемов на основном графике.
                                </span>
                              </div>

                              <div className="flex flex-col gap-1.5 text-xs">
                                <span className={isLight ? "text-slate-700 font-bold" : "text-slate-300 font-bold"}>Порог дельты для подсветки / Delta Threshold</span>
                                <input
                                  type="number"
                                  value={selectedIndicator.settings.volumeOnChartDeltaThreshold ?? 500}
                                  onChange={(e) => updateSettings({ volumeOnChartDeltaThreshold: parseFloat(e.target.value) || 0 })}
                                  className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                                />
                                <span className={`text-[10px] ${isLight ? "text-slate-500/80" : "text-slate-400/80"}`}>
                                  Столбцы с абсолютной дельтой в свече выше этого значения станут зелеными / красными, иначе будут серыми.
                                </span>
                              </div>
                            </>
                          )}

                          <label className={`flex items-center gap-2.5 p-1 rounded cursor-pointer mt-1 ${isLight ? "hover:bg-slate-100" : "hover:bg-white/5"}`}>
                            <input
                              type="checkbox"
                              checked={selectedIndicator.settings.showLabels !== false}
                              onChange={(e) => updateSettings({ showLabels: e.target.checked })}
                              className={`rounded w-4 h-4 ${isLight ? "border-slate-350 bg-white text-blue-600" : "border-white/10 bg-slate-900 text-blue-500"}`}
                            />
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-200"}`}>Draw Footprint Volume numbers</span>
                          </label>
                        </div>
                      )}

                      {selectedIndicator.id === "delta" && (
                        <div className="flex flex-col gap-4 font-sans text-xs">
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black font-mono">
                            НАСТРОЙКИ ДЕЛЬТЫ
                          </span>

                          <div className="flex flex-col gap-2">
                            <div className="flex justify-between font-bold">
                              <span className={isLight ? "text-slate-700" : "text-slate-300"}>Extreme Delta sensitivity</span>
                              <span className={`font-mono font-bold ${isLight ? "text-blue-700" : "text-yellow-500"}`}>
                                {selectedIndicator.settings.sensitivity || 5}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="1"
                              max="10"
                              value={selectedIndicator.settings.sensitivity || 5}
                              onChange={(e) => updateSettings({ sensitivity: parseInt(e.target.value) })}
                              className={`w-full accent-blue-600 rounded-lg h-1 ${isLight ? "bg-slate-200" : "bg-slate-800"}`}
                            />
                          </div>

                          <div className="flex flex-col gap-1.5 border-t border-dashed border-slate-700/20 pt-3">
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Тип отображения</span>
                            <div className="flex gap-1 bg-slate-900/50 p-1 rounded-xl border border-white/5">
                              <button
                                type="button"
                                onClick={() => updateSettings({ deltaPlotType: "candles" })}
                                className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all duration-200 ${(selectedIndicator.settings.deltaPlotType || "candles") === "candles" ? isLight ? "bg-white text-slate-800 shadow-sm" : "bg-slate-850 text-white shadow" : "text-slate-400 hover:text-slate-300"}`}
                              >
                                Свечи
                              </button>
                              <button
                                type="button"
                                onClick={() => updateSettings({ deltaPlotType: "bars" })}
                                className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all duration-200 ${selectedIndicator.settings.deltaPlotType === "bars" ? isLight ? "bg-white text-slate-800 shadow-sm" : "bg-slate-850 text-white shadow" : "text-slate-400 hover:text-slate-300"}`}
                              >
                                Столбики
                              </button>
                            </div>
                          </div>

                          <label className={`flex items-center gap-2.5 p-1 rounded cursor-pointer mt-1 ${isLight ? "hover:bg-slate-100" : "hover:bg-white/5"}`}>
                            <input
                              type="checkbox"
                              checked={selectedIndicator.settings.showLabels !== false}
                              onChange={(e) => updateSettings({ showLabels: e.target.checked })}
                              className={`rounded w-4 h-4 ${isLight ? "border-slate-350 bg-white text-blue-600" : "border-white/10 bg-slate-900 text-blue-500"}`}
                            />
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-200"}`}>Show Volume Delta Labels under chart</span>
                          </label>
                        </div>
                      )}

                      {selectedIndicator.id === "cvd" && (
                        <div className={`flex flex-col gap-4 font-sans text-xs p-4.5 rounded-2xl border transition-all duration-300 ${isLight ? "bg-slate-100/40 border-slate-200/85" : "bg-slate-950/20 border-white/5"}`}>
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black font-mono">
                            ПАРАМЕТРЫ СГЛАЖИВАНИЯ И СТИЛИЗАЦИИ CVD
                          </span>

                          <div className="flex flex-col gap-2 mt-1">
                            <div className="flex justify-between font-bold">
                              <span className={isLight ? "text-slate-700" : "text-slate-300"}>Smoothing period</span>
                              <span className={`font-mono font-bold ${isLight ? "text-blue-700" : "text-yellow-500"}`}>
                                {selectedIndicator.settings.smoothing || 10}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="1"
                              max="40"
                              value={selectedIndicator.settings.smoothing || 10}
                              onChange={(e) => updateSettings({ smoothing: parseInt(e.target.value) })}
                              className={`w-full accent-blue-600 rounded-lg h-1 ${isLight ? "bg-slate-250" : "bg-slate-800"}`}
                            />
                          </div>

                          <div className="flex items-center justify-between border-t border-dashed border-slate-700/20 pt-3 mt-1">
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Цвет линии индикатора</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={selectedIndicator.settings.cvdLineColor ?? "#a855f7"}
                                onChange={(e) => updateSettings({ cvdLineColor: e.target.value })}
                                className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                              />
                              <span className="text-[10px] font-mono text-slate-400 truncate w-14">
                                {selectedIndicator.settings.cvdLineColor ?? "#a855f7"}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1.5 border-t border-dashed border-slate-700/20 pt-3">
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Период группировки</span>
                            <select
                              value={selectedIndicator.settings.cvdPeriod ?? "all"}
                              onChange={(e) => updateSettings({ cvdPeriod: e.target.value as any })}
                              className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40 hover:border-white/20"}`}
                            >
                              <option value="all">Все бары</option>
                              <option value="day">День</option>
                              <option value="week">Неделя</option>
                              <option value="month">Месяц</option>
                              <option value="visible">Видимые бары</option>
                            </select>
                          </div>

                          <div className="flex flex-col gap-1.5 border-t border-dashed border-slate-700/20 pt-3">
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Тип отображения</span>
                            <div className="flex gap-1 bg-slate-900/50 p-1 rounded-xl border border-white/5">
                              <button
                                type="button"
                                onClick={() => updateSettings({ cvdPlotType: "line" })}
                                className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all duration-200 ${(selectedIndicator.settings.cvdPlotType || "line") === "line" ? isLight ? "bg-white text-slate-800 shadow-sm" : "bg-slate-850 text-white shadow" : "text-slate-400 hover:text-slate-300"}`}
                              >
                                Линия
                              </button>
                              <button
                                type="button"
                                onClick={() => updateSettings({ cvdPlotType: "candles" })}
                                className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all duration-200 ${selectedIndicator.settings.cvdPlotType === "candles" ? isLight ? "bg-white text-slate-800 shadow-sm" : "bg-slate-850 text-white shadow" : "text-slate-400 hover:text-slate-300"}`}
                              >
                                Свечи
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedIndicator.id === "stackedImbalance" && (
                        <div className={`flex flex-col gap-4 font-sans text-xs p-4.5 rounded-2xl border transition-all duration-300 ${isLight ? "bg-slate-100/40 border-slate-200/85" : "bg-slate-950/20 border-white/5"}`}>
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black font-mono">
                            ПАРАМЕТРЫ ATAS STACKED IMBALANCE
                          </span>

                          <div className="grid grid-cols-2 gap-4 mt-1">
                            <label className="flex flex-col gap-1.5 font-sans text-xs">
                              <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Дисбаланс (%)</span>
                              <input
                                type="number"
                                step="10"
                                min="50"
                                max="1000"
                                value={selectedIndicator.settings.siRatio ?? 300}
                                onChange={(e) => updateSettings({ siRatio: parseInt(e.target.value) || 300 })}
                                className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40 hover:border-white/20"}`}
                              />
                            </label>

                            <label className="flex flex-col gap-1.5 font-sans text-xs">
                              <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Диапазон уровней</span>
                              <input
                                type="number"
                                step="1"
                                min="1"
                                max="10"
                                value={selectedIndicator.settings.siRange ?? 3}
                                onChange={(e) => updateSettings({ siRange: parseInt(e.target.value) || 3 })}
                                className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40 hover:border-white/20"}`}
                              />
                            </label>

                            <label className="flex flex-col gap-1.5 font-sans text-xs">
                              <span className={`font-bold ${isLight ? "text-slate-705" : "text-slate-300"}`}>Мин. объем стороны</span>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={selectedIndicator.settings.siVolume ?? 10}
                                onChange={(e) => updateSettings({ siVolume: parseFloat(e.target.value) ?? 10 })}
                                className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40 hover:border-white/20"}`}
                              />
                            </label>

                            <label className="flex flex-col gap-1.5 font-sans text-xs">
                              <span className={`font-bold ${isLight ? "text-slate-707" : "text-slate-300"}`}>Толщина линий (px)</span>
                              <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="10"
                                value={selectedIndicator.settings.siLineWidth ?? 2}
                                onChange={(e) => updateSettings({ siLineWidth: parseFloat(e.target.value) || 2 })}
                                className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-blue-400" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40 hover:border-white/20"}`}
                              />
                            </label>
                          </div>

                          <div className="flex items-center justify-between border-t border-dashed border-slate-700/20 pt-3 mt-1">
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>{"Положительный (Asks > Bids)"}</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={
                                  (selectedIndicator.settings.siColorPos ?? "#FF228B22").length === 9
                                    ? "#" + (selectedIndicator.settings.siColorPos ?? "#FF228B22").slice(3)
                                    : (selectedIndicator.settings.siColorPos ?? "#FF228B22")
                                }
                                onChange={(e) => updateSettings({ siColorPos: e.target.value })}
                                className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                              />
                              <span className="text-[10px] font-mono text-slate-400 truncate w-16">
                                {selectedIndicator.settings.siColorPos ?? "#FF228B22"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between border-t border-dashed border-slate-700/20 pt-3">
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>{"Отрицательный (Bids > Asks)"}</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={
                                  (selectedIndicator.settings.siColorNeg ?? "#FFC80000").length === 9
                                    ? "#" + (selectedIndicator.settings.siColorNeg ?? "#FFC80000").slice(3)
                                    : (selectedIndicator.settings.siColorNeg ?? "#FFC80000")
                                }
                                onChange={(e) => updateSettings({ siColorNeg: e.target.value })}
                                className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                              />
                              <span className="text-[10px] font-mono text-slate-400 truncate w-16">
                                {selectedIndicator.settings.siColorNeg ?? "#FFC80000"}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedIndicator.id === "depthOfMarket" && (
                        <div className={`flex flex-col gap-4 font-sans text-xs p-4.5 rounded-2xl border transition-all duration-300 ${isLight ? "bg-slate-100/40 border-slate-200/85" : "bg-slate-950/20 border-white/5"}`}>
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black font-mono">
                            ПАРАМЕТРЫ DEPTH OF MARKET (DOM)
                          </span>

                          <div className="grid grid-cols-2 gap-4 mt-1">
                            <label className="flex flex-col gap-1.5 font-sans text-xs col-span-2 sm:col-span-1">
                              <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Режим ширины</span>
                              <select
                                value={selectedIndicator.settings.domWidthMode ?? "auto"}
                                onChange={(e) => updateSettings({ domWidthMode: e.target.value as any })}
                                className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${isLight ? "bg-white border-slate-200 text-slate-800" : "bg-[#0b0f19] border border-white/10 text-slate-200 focus:ring-1 focus:ring-yellow-500/40"}`}
                              >
                                <option value="auto">Авто (Макс. 100px)</option>
                                <option value="manual">Вручную (Ввод ширины)</option>
                              </select>
                            </label>

                            <label className="flex flex-col gap-1.5 font-sans text-xs col-span-2 sm:col-span-1">
                              <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Макс. ширина шкалы (px)</span>
                              <input
                                type="number"
                                step="10"
                                min="30"
                                max="500"
                                disabled={(selectedIndicator.settings.domWidthMode ?? "auto") === "auto"}
                                value={selectedIndicator.settings.domMaxWidth ?? 100}
                                onChange={(e) => updateSettings({ domMaxWidth: parseInt(e.target.value) || 100 })}
                                className={`rounded-xl px-3 py-2 text-xs outline-none transition-all duration-300 border ${(selectedIndicator.settings.domWidthMode ?? "auto") === "auto" ? "opacity-50 cursor-not-allowed bg-slate-150" : ""} ${isLight ? "bg-white border-slate-200 text-slate-800" : "bg-[#0b0f19] border border-white/10 text-slate-200"}`}
                              />
                            </label>

                            <label className="flex flex-col gap-1.5 font-sans text-xs col-span-2">
                              <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Прозрачность гистограммы ({selectedIndicator.settings.domOpacity ?? 40}%)</span>
                              <input
                                type="range"
                                min="10"
                                max="100"
                                step="5"
                                value={selectedIndicator.settings.domOpacity ?? 40}
                                onChange={(e) => updateSettings({ domOpacity: parseInt(e.target.value) || 40 })}
                                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                              />
                            </label>
                          </div>

                          <div className="flex items-center justify-between border-t border-dashed border-slate-700/20 pt-3 mt-1">
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Цвет Лимитов Покупок (Bids)</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={selectedIndicator.settings.domColorBid ?? "#228B22"}
                                onChange={(e) => updateSettings({ domColorBid: e.target.value })}
                                className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                              />
                              <span className="text-[10px] font-mono text-slate-400 truncate w-16">{selectedIndicator.settings.domColorBid ?? "#228B22"}</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between border-t border-dashed border-slate-700/20 pt-3">
                            <span className={`font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>Цвет Лимитов Продаж (Asks)</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={selectedIndicator.settings.domColorAsk ?? "#C80000"}
                                onChange={(e) => updateSettings({ domColorAsk: e.target.value })}
                                className="w-7 h-7 rounded cursor-pointer border-0 p-0 overflow-hidden bg-transparent shrink-0"
                              />
                              <span className="text-[10px] font-mono text-slate-400 truncate w-16">{selectedIndicator.settings.domColorAsk ?? "#C80000"}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedIndicator.id !== "clusterSearch" &&
                        selectedIndicator.id !== "volume" &&
                        selectedIndicator.id !== "volumeOnChart" &&
                        selectedIndicator.id !== "volumeProfile" &&
                        selectedIndicator.id !== "delta" &&
                        selectedIndicator.id !== "cvd" &&
                        selectedIndicator.id !== "stackedImbalance" &&
                        selectedIndicator.id !== "depthOfMarket" && (
                          <div className="text-slate-500 italic text-xs py-3 font-sans">
                            Дополнительные параметры конфигурирования будут добавлены в следующих обновлениях.
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs font-sans">
                  Пожалуйста, выберите индикатор для настройки
                </div>
              )}
            </div>
          </div>

          {/* FOOTER */}
          <div className={`flex items-center justify-between px-6 py-4.5 border-t transition-all duration-300 ${isLight ? "bg-white/30 border-slate-200" : "border-white/5 bg-slate-950/20"}`}>
            <div className="flex items-center gap-4.5 select-none text-[10.5px] font-mono text-slate-500 pb-0.5">
              <span>
                Хоткей: <span className={`font-bold px-1.5 py-0.5 rounded border transition-colors ${isLight ? "bg-slate-105 text-slate-600 border-slate-200" : "bg-white/5 text-slate-400 border-white/5"}`}>/</span>
              </span>
              <div className="flex items-center gap-1.5 text-emerald-500 font-sans font-semibold">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Изменения применяются мгновенно</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleCancel}
                className={`px-5 py-2 rounded-xl text-xs font-bold font-sans transition cursor-pointer ${isLight ? "hover:bg-slate-200/80 text-slate-600 hover:text-slate-800" : "hover:bg-white/5 text-slate-400 hover:text-slate-200"}`}
              >
                Отмена
              </button>
              <button
                onClick={handleApply}
                className="px-6 py-2 bg-[#2563eb] hover:bg-blue-600 text-white rounded-xl text-xs font-extrabold font-sans transition-all active:scale-[0.98] shadow-lg cursor-pointer flex items-center gap-1.5"
              >
                <Activity className="w-3.5 h-3.5 text-blue-200" />
                <span>Применить</span>
              </button>
            </div>
          </div>

          {/* RESIZE HANDLE */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute bottom-[6px] right-[6px] w-[21px] h-[21px] cursor-se-resize flex items-end justify-end p-0.5 select-none z-50 no-drag"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" className="text-slate-400 hover:text-blue-500 transition-colors">
              <path d="M11 0 L0 11 M11 4 L4 11 M11 8 L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
