import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { useTheme } from "@/contexts/ThemeContext"
import { useTranslation } from "@/i18n"
import type { Indicator, IndicatorSettings } from "@/chart2d/types"
import { X, Search, Star, Trash2, Eye, EyeOff, Layers, Activity, ChevronDown, ArrowUp, ArrowDown, Info, Plus, Check, Pencil, Shield, Lock } from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { MODULAR_INDICATORS } from "@/chart2d/indicators"
import { INDICATOR_DESCRIPTIONS } from "@/chart2d/indicators/descriptions"
import { useUserLimits } from "@/contexts/LimitsContext"
import type { IndicatorPreset, IndicatorsSource, StoredIndicator } from "@/features/indicators/types"
import { useIndicatorsStorage } from "@/features/indicators/IndicatorsStorageContext"
import { useAuthContext } from "@/features/auth/AuthContext"
import { apiPatchAdminIndicatorDefault, apiDeleteAdminIndicatorDefaultForIndicator } from "@/features/admin/api"
import { notify } from "@/features/notify/toast"

interface IndicatorsModalProps {
  isOpen: boolean
  onClose: () => void
  symbol?: string
  market?: string
  timeframe?: string
  indicators?: Indicator[]
  source?: IndicatorsSource
  focusIndicatorId?: string | null
  onApplyIndicators?: (indicators: Indicator[], settingsChanged: boolean) => void
  onToggleVisibility?: (id: string) => void
  /**
   * Propagate ONE indicator (replace-or-append by id) into the '*' row and
   * every existing per-tf row of (symbol, market). Called on Apply for each
   * indicator with its per-id checkbox ticked. Indicators routed through here
   * do NOT also go through onApplyIndicators — propagate writes the current
   * TF too, so a parallel per-tf save would race the upsert.
   */
  onPropagateIndicator?: (indicator: Indicator) => void
  /**
   * Live preview hook. Fires on every draft change while the modal is open so
   * the chart can render the in-progress edit without going through the
   * persistence layer. No network — pure local state in the parent.
   */
  onPreviewIndicators?: (draft: Indicator[]) => void
  /**
   * Cancel hook. Fires on Cancel / X / Esc to tell the parent to drop the
   * preview and fall back to the persisted indicators.
   */
  onCancelPreview?: () => void
  /**
   * Snapshot of admin_indicator_defaults rows for the current key. Used to
   * render the virtual "Дефолт от админа" preset row (visible to everyone)
   * and to drive the admin-only "Дефолт" toggle state. Tf takes precedence
   * over allTf when both contain the same indicator id (mirrors cascade).
   */
  adminDefaultsTf?: StoredIndicator[]
  adminDefaultsAllTf?: StoredIndicator[]
  /**
   * Called after a successful admin PATCH/DELETE so the parent re-fetches
   * adminDefaultsTf/AllTf and the modal re-renders with up-to-date state.
   */
  onRefreshAdminDefaults?: () => Promise<void>
}

export default function IndicatorsModal({ isOpen, onClose, symbol = "", market = "futures", timeframe = "", indicators, source, focusIndicatorId, onApplyIndicators, onToggleVisibility, onPropagateIndicator, onPreviewIndicators, onCancelPreview, adminDefaultsTf, adminDefaultsAllTf, onRefreshAdminDefaults }: IndicatorsModalProps) {
  const { limits } = useUserLimits()
  const maxIndicators = limits.maxIndicators >= 100 ? Infinity : limits.maxIndicators
  const { user } = useAuthContext()
  const isAdmin = (user?.role ?? '').toLowerCase() === 'admin'

  const [draft, setDraft] = useState<Indicator[]>([])
  // Variant B tier-overflow set: items past the tier max in the active-filtered
  // order are "blocked by tier" — visible in the active list with settings
  // preserved, but the eye toggle is disabled until the user frees a slot by
  // removing one of the first N actives. Mirrors the backend rule (no
  // mutation of isActive on read/write); FE and BE compute the set
  // independently from the same array order.
  const blockedIds = useMemo(() => {
    const blocked = new Set<string>()
    if (!Number.isFinite(maxIndicators)) return blocked
    let activeIdx = 0
    for (const ind of draft) {
      if (!ind.isActive) continue
      activeIdx++
      if (activeIdx > maxIndicators) blocked.add(ind.id)
    }
    return blocked
  }, [draft, maxIndicators])
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedId, setSelectedId] = useState("clusterSearch")
  const { language } = useTranslation()
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 960)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const [activeMobileView, setActiveMobileView] = useState<'list' | 'settings'>('list')
  const selectIndicatorMobile = (id: string) => {
    setSelectedId(id)
    if (window.innerWidth < 960) setActiveMobileView('settings')
  }
  // Per-indicator "apply to all TFs" intent. Each id ticked on Apply is sent
  // through onPropagateIndicator instead of the normal per-tf save, so it
  // lands in the '*' row plus every existing per-tf row at once. Resets to
  // empty on every modal open — never persisted.
  const [propagateIds, setPropagateIds] = useState<Set<string>>(new Set())
  const togglePropagate = (id: string) => {
    setPropagateIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ===== Preset panel state — per-indicator =====
  const indicatorsStore = useIndicatorsStorage()
  const [presetsByIndicator, setPresetsByIndicator] = useState<Record<string, IndicatorPreset[]>>({})
  const [presetsLoading, setPresetsLoading] = useState<Record<string, boolean>>({})
  const [presetsError, setPresetsError] = useState<string | null>(null)
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false)
  const [createPresetOpen, setCreatePresetOpen] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const presetBtnRef = useRef<HTMLButtonElement>(null)
  const presetPopoverRef = useRef<HTMLDivElement>(null)
  const [presetPopoverPos, setPresetPopoverPos] = useState<{ top: number; left: number } | null>(null)

  const loadPresetsFor = useCallback(async (indicatorId: string) => {
    setPresetsLoading((prev) => ({ ...prev, [indicatorId]: true }))
    try {
      const { presets } = await indicatorsStore.listPresets(indicatorId)
      setPresetsByIndicator((prev) => ({ ...prev, [indicatorId]: presets }))
    } catch (err) {
      console.warn('[indicators-modal] load presets failed', err)
    } finally {
      setPresetsLoading((prev) => ({ ...prev, [indicatorId]: false }))
    }
  }, [indicatorsStore])

  const [size, setSize] = useState({ width: 855, height: 720 })
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0 })
  const sizeStart = useRef({ width: 855, height: 720 })
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
  // Snapshot of settings keyed by indicator id captured at seed time. Drives
  // the 'add_only' vs 'settings_changed' intent on save: if no settings object
  // changed compared to this snapshot, the request goes as 'add_only' so users
  // with the custom_indicator_settings policy off can still edit composition.
  const initialSettingsRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (isOpen && !prevIsOpen.current) {
      // Seed draft as the FULL catalog with stored state overlayed per id.
      // Catalog provides the visible set; stored entries (server cascade
      // result) override isActive/isVisible/settings for ids they cover.
      // Catalog-only entries land as isActive:false so untouched indicators
      // are not silently activated on the next Apply.
      const storedById = new Map((indicators ?? []).map((i) => [i.id, i]))
      const seeded: Indicator[] = MODULAR_INDICATORS.map((mod) => {
        const fromStored = storedById.get(mod.id)
        if (fromStored) {
          return JSON.parse(JSON.stringify(fromStored)) as Indicator
        }
        return {
          id: mod.id,
          label: mod.label,
          category: mod.category,
          type: mod.type,
          isFavorite: false,
          isActive: false,
          isVisible: true,
          settings: { ...mod.defaultSettings },
        }
      })
      setDraft(seeded)
      const snapshot = new Map<string, string>()
      for (const ind of seeded) snapshot.set(ind.id, JSON.stringify(ind.settings))
      initialSettingsRef.current = snapshot
      if (focusIndicatorId) setSelectedId(focusIndicatorId)
      setOffset({ x: 0, y: 0 })
      setSize({ width: 855, height: 720 })
      setPropagateIds(new Set())
      setPresetDropdownOpen(false)
      setCreatePresetOpen(false)
      setNewPresetName('')
      setRenamingId(null)
      setPresetsError(null)
    }
    prevIsOpen.current = isOpen
  }, [isOpen, indicators, focusIndicatorId])

  // Load presets whenever the selected indicator changes (or modal opens).
  useEffect(() => {
    if (!isOpen) return
    if (!selectedId) return
    if (presetsByIndicator[selectedId] !== undefined) return
    void loadPresetsFor(selectedId)
  }, [isOpen, selectedId, presetsByIndicator, loadPresetsFor])

  // Preset popover lives in a Portal (document.body) to escape the modal's
  // overflow-hidden / overflow-y-auto ancestors. Position is recalculated on
  // open, on window resize, and on internal scroll of the right column.
  useEffect(() => {
    if (!presetDropdownOpen) { setPresetPopoverPos(null); return }
    const recalc = () => {
      const r = presetBtnRef.current?.getBoundingClientRect()
      if (r) setPresetPopoverPos({ top: r.bottom + 6, left: r.left })
    }
    recalc()
    window.addEventListener('resize', recalc)
    const rightCol = presetBtnRef.current?.closest('.overflow-y-auto') as HTMLElement | null
    rightCol?.addEventListener('scroll', recalc, { passive: true })
    return () => {
      window.removeEventListener('resize', recalc)
      rightCol?.removeEventListener('scroll', recalc)
    }
  }, [presetDropdownOpen])

  // Click outside closes the portal-mounted popover.
  useEffect(() => {
    if (!presetDropdownOpen) return
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (presetBtnRef.current?.contains(t)) return
      if (presetPopoverRef.current?.contains(t)) return
      setPresetDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [presetDropdownOpen])

  // Live preview: every draft change while the modal is open is mirrored to
  // the parent so the chart re-renders against the in-progress edit. The
  // initial fire on open writes a value equal to persisted (clone of source),
  // so it's a visual no-op but lets the parent take over rendering.
  useEffect(() => {
    if (!isOpen) return
    if (!onPreviewIndicators) return
    onPreviewIndicators(draft)
  }, [draft, isOpen, onPreviewIndicators])

  const handleCancel = () => {
    onCancelPreview?.()
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

      const maxAllowedHeight = Math.min(950, window.innerHeight - 80)
      const newWidth = Math.max(700, Math.min(1300, sizeStart.current.width + dx))
      const newHeight = Math.max(480, Math.min(maxAllowedHeight, sizeStart.current.height + dy))

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

  // selectedIndicator + admin-defaults useMemo MUST live above the early
  // return so the hook order is stable between renders where isOpen flips.
  // React tracks hooks by call position; new hooks placed below `return null`
  // would skip on closed renders and trip the Rules-of-Hooks check.
  const selectedIndicator = draft.find((i) => i.id === selectedId) || draft[0]

  // Selected indicator's admin-default settings, cascade-style: per-tf wins
  // over all-tf. Drives the virtual "Дефолт от админа" row in the dropdown.
  const adminDefaultForSelected = useMemo<StoredIndicator | null>(() => {
    if (!selectedIndicator) return null
    const fromTf = adminDefaultsTf?.find((d) => d.id === selectedIndicator.id)
    if (fromTf) return fromTf
    const fromAllTf = adminDefaultsAllTf?.find((d) => d.id === selectedIndicator.id)
    return fromAllTf ?? null
  }, [selectedIndicator, adminDefaultsTf, adminDefaultsAllTf])

  // True iff THIS tf has an admin-default for the selected indicator (per-tf
  // row only, not all-tf). The toggle writes/clears the per-tf row regardless
  // of all-tf, so the toggle state must reflect per-tf only.
  const adminTfHasSelected = useMemo<boolean>(() => {
    if (!selectedIndicator) return false
    return adminDefaultsTf?.some((d) => d.id === selectedIndicator.id) ?? false
  }, [selectedIndicator, adminDefaultsTf])

  const { theme } = useTheme()
  const isLight = theme === 'light'

  if (!isOpen) return null

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
    setDraft((prev) => {
      const target = prev.find((ind) => ind.id === id)
      if (!target) return prev
      const turningOn = !target.isActive
      if (turningOn) {
        const activeCount = prev.filter((ind) => ind.isActive).length
        if (activeCount >= maxIndicators) {
          notify(`Лимит индикаторов: ${maxIndicators}. Удалите другой или выберите платный тариф.`, { kind: 'warn' })
          return prev
        }
      }
      return prev.map((ind) => (ind.id === id ? { ...ind, isActive: !ind.isActive } : ind))
    })
  }

  const deactivateIndicator = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft((prev) => prev.map((ind) => (ind.id === id ? { ...ind, isActive: false } : ind)))
  }

  const toggleVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // Variant B: items past the tier cap are "blocked by tier" — the eye
    // toggle is locked until the user frees a slot by removing one of the
    // first N actives. Voluntarily hidden items within the cap stay
    // togglable as before.
    if (blockedIds.has(id)) {
      notify(`Лимит тарифа: освободите место, чтобы показать этот индикатор.`, { kind: 'warn' })
      return
    }
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

  // ===== Preset actions =====
  const handleSavePreset = async () => {
    if (!selectedIndicator) return
    const name = newPresetName.trim()
    if (!name) {
      setPresetsError('Введите имя пресета')
      return
    }
    setPresetsError(null)
    try {
      const created = await indicatorsStore.savePreset(selectedIndicator.id, name, selectedIndicator.settings)
      setPresetsByIndicator((prev) => ({
        ...prev,
        [selectedIndicator.id]: [created, ...(prev[selectedIndicator.id] ?? [])],
      }))
      setCreatePresetOpen(false)
      setNewPresetName('')
    } catch (err) {
      const e = err as { code?: string; message?: string }
      setPresetsError(e.code === 'NAME_EXISTS' ? 'Имя уже занято' : e.message ?? 'Не удалось сохранить пресет')
    }
  }

  const handleRenamePreset = async (preset: IndicatorPreset) => {
    const name = renameDraft.trim()
    if (!name) {
      setRenamingId(null)
      return
    }
    try {
      await indicatorsStore.renamePreset(preset.id, preset.indicatorId, name)
      setPresetsByIndicator((prev) => ({
        ...prev,
        [preset.indicatorId]: (prev[preset.indicatorId] ?? []).map((p) =>
          p.id === preset.id ? { ...p, name } : p,
        ),
      }))
      setRenamingId(null)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      setPresetsError(e.code === 'NAME_EXISTS' ? 'Имя уже занято' : e.message ?? 'Не удалось переименовать')
    }
  }

  const handleDeletePreset = async (preset: IndicatorPreset) => {
    try {
      await indicatorsStore.deletePreset(preset.id, preset.indicatorId)
      setPresetsByIndicator((prev) => ({
        ...prev,
        [preset.indicatorId]: (prev[preset.indicatorId] ?? []).filter((p) => p.id !== preset.id),
      }))
    } catch (err) {
      console.warn('[indicators-modal] delete preset failed', err)
    }
  }

  const handleApplyPreset = async (preset: IndicatorPreset) => {
    if (!selectedIndicator) return
    if (!symbol || !market || !timeframe) {
      setPresetsError('Откройте график перед применением')
      return
    }
    // Patch draft so the preview reflects the preset immediately. Server-side
    // apply also happens (when authed) via applyPresetToCurrent.
    setDraft((prev) =>
      prev.map((ind) =>
        ind.id === preset.indicatorId
          ? { ...ind, isActive: true, isVisible: true, settings: { ...preset.settings } }
          : ind,
      ),
    )
    try {
      await indicatorsStore.applyPresetToCurrent(
        preset.id,
        preset.indicatorId,
        preset.settings,
        symbol,
        market,
        timeframe,
      )
      setPresetDropdownOpen(false)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      setPresetsError(e.message ?? 'Не удалось применить пресет')
    }
  }

  // ===== Admin defaults (Feature 1) — handlers; useMemo hoisted above the
  // early return — see comment near selectedIndicator declaration. =====

  const handleApplyAdminDefault = (settings: IndicatorSettings) => {
    if (!selectedIndicator) return
    setDraft((prev) =>
      prev.map((ind) =>
        ind.id === selectedIndicator.id
          ? { ...ind, isActive: true, isVisible: true, settings: { ...settings } }
          : ind,
      ),
    )
    setPresetDropdownOpen(false)
  }

  const handleToggleAdminDefault = async () => {
    if (!selectedIndicator) return
    if (!symbol || !market || !timeframe) {
      setPresetsError('Откройте график перед сохранением дефолта')
      return
    }
    setPresetsError(null)
    try {
      if (adminTfHasSelected) {
        await apiDeleteAdminIndicatorDefaultForIndicator(symbol, market, timeframe, selectedIndicator.id)
      } else {
        const oneStored: StoredIndicator = {
          id: selectedIndicator.id,
          isActive: selectedIndicator.isActive,
          ...(selectedIndicator.isVisible === undefined ? {} : { isVisible: selectedIndicator.isVisible }),
          settings: selectedIndicator.settings,
        }
        await apiPatchAdminIndicatorDefault(symbol, market, timeframe, oneStored)
      }
      await onRefreshAdminDefaults?.()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      setPresetsError(e.message ?? 'Не удалось обновить админ-дефолт')
    }
  }

  const handleApply = () => {
    // Indicators whose "apply to all TFs" checkbox is ticked go through
    // propagate only — that path also writes the current TF, so a parallel
    // per-tf save would race. Everything else flows through the normal per-tf
    // save.
    const perTfSave = draft.filter((ind) => !propagateIds.has(ind.id))
    const initial = initialSettingsRef.current
    const settingsChanged = draft.some((ind) => {
      const before = initial.get(ind.id)
      if (before === undefined) return false
      return before !== JSON.stringify(ind.settings)
    })
    onApplyIndicators?.(perTfSave, settingsChanged)
    if (onPropagateIndicator) {
      for (const ind of draft) {
        if (propagateIds.has(ind.id)) onPropagateIndicator(ind)
      }
    }
    onClose()
  }

  const addedIndicators = draft.filter((ind) => ind.isActive)

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-2 sm:p-4 pointer-events-none bg-transparent">
      <div
        className="pointer-events-auto relative"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 15 }}
          className={`rounded-3xl flex flex-col overflow-hidden font-sans border shadow-2xl relative muddy-glass-popover max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] ${isLight ? "border-slate-200/50 text-slate-850" : "border-white/10 text-slate-200"}`}
          style={isMobile
            ? { width: 'calc(100vw - 16px)', maxWidth: '500px', height: 'calc(100vh - 20px)', maxHeight: '720px' }
            : { width: `${size.width}px`, height: `${size.height}px`, maxHeight: 'calc(100vh - 80px)', maxWidth: 'calc(100vw - 32px)' }}
        >
          {/* HEADER */}
          <div
            onMouseDown={isMobile ? undefined : handleMouseDown}
            className={`flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4.5 border-b transition-all duration-300 ${isMobile ? '' : 'cursor-grab active:cursor-grabbing select-none'} ${isLight ? "bg-white/30 border-slate-200/80 text-slate-800" : "border-white/5 bg-slate-950/20"}`}
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

          {/* SOURCE BADGE — informs the user which cascade layer their current
              view comes from. Without this the "all-tf changes leave per-tf
              overrides alone" semantics looks like a bug. */}
          {source && (source === 'admin-tf' || source === 'admin-all-tf' || source === 'system') && (
            <div className={`px-6 py-2 text-[11px] font-medium flex items-center gap-2 border-b ${isLight ? "bg-amber-50 text-amber-800 border-amber-100" : "bg-amber-500/10 text-amber-300 border-amber-500/20"}`}>
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Вы видите настройки по умолчанию — измените что-нибудь, чтобы создать свои.</span>
            </div>
          )}
          {source === 'user-all-tf' && (
            <div className={`px-6 py-2 text-[11px] font-medium flex items-center gap-2 border-b ${isLight ? "bg-blue-50 text-blue-800 border-blue-100" : "bg-blue-500/10 text-blue-300 border-blue-500/20"}`}>
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Применено ко всем ТФ. Изменение настроек затронет только текущий ТФ{timeframe ? ` (${timeframe})` : ""}.</span>
            </div>
          )}

          {/* WORKSPACE */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* LEFT SIDEBAR */}
            <div className={`${
              isMobile
                ? activeMobileView === 'list'
                  ? 'w-full border-r-0'
                  : 'hidden'
                : 'w-[335px] border-r shrink-0'
            } p-3 sm:p-4 flex flex-col gap-1.5 sm:gap-2 select-none transition-all duration-300 ${isLight ? "bg-slate-50/50 border-slate-200" : "bg-slate-900/10 border-white/5"}`}>
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
              <div className={`flex flex-col min-h-0 border-b pb-2 shrink-0 flex-[0.7] ${isLight ? "border-slate-200" : "border-white/5"}`}>
                <span className="text-[10px] font-bold text-slate-500 tracking-widest uppercase mb-1 block font-mono pl-1">
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
                            onClick={() => selectIndicatorMobile(ind.id)}
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
                                onClick={(e) => {
                                  if (blockedIds.has(ind.id)) { toggleVisibility(ind.id, e); return }
                                  toggleVisibility(ind.id, e); onToggleVisibility?.(ind.id)
                                }}
                                aria-disabled={blockedIds.has(ind.id)}
                                className={`p-1 rounded transition ${
                                  blockedIds.has(ind.id)
                                    ? "cursor-not-allowed text-amber-500 hover:bg-amber-500/10"
                                    : isLight ? "hover:bg-slate-200/80 text-slate-500 hover:text-slate-850" : "hover:bg-white/10 text-slate-400 hover:text-slate-200"
                                }`}
                                title={
                                  blockedIds.has(ind.id)
                                    ? "Лимит тарифа: освободите место, чтобы показать этот индикатор"
                                    : isVisible ? "Скрыть на графике" : "Показать на графике"
                                }
                              >
                                {blockedIds.has(ind.id)
                                  ? <Lock className="w-3.5 h-3.5" />
                                  : isVisible
                                    ? <Eye className="w-3.5 h-3.5" />
                                    : <EyeOff className="w-3.5 h-3.5 text-rose-500 font-bold" />}
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
                                    onClick={() => selectIndicatorMobile(ind.id)}
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
            <div className={`${
              isMobile
                ? activeMobileView === 'settings'
                  ? 'w-full flex-1'
                  : 'hidden'
                : 'flex-1'
            } min-w-0 p-3 sm:p-5 overflow-y-auto flex flex-col gap-3 sm:gap-5 select-none transition-all duration-300 ${isLight ? "bg-slate-50/70 scrollbar-thin-light" : "bg-slate-950/5 scrollbar-thin-dark"}`}>
              {isMobile && (
                <button
                  onClick={() => setActiveMobileView('list')}
                  className={`self-start inline-flex items-center gap-1.5 py-1.5 px-3.5 rounded-xl text-xs font-bold tracking-wide transition border cursor-pointer no-drag ${
                    isLight
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                      : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10'
                  }`}
                >
                  ← {language === 'RU' ? 'Назад к выбору' : language === 'KZ' ? 'Таңдауға қайту' : 'Back to list'}
                </button>
              )}
              {selectedIndicator ? (
                <div className="flex flex-col gap-5">
                  {/* Title Card */}
                  <div className={`flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 pb-3 border-b transition-all duration-300 ${isLight ? "border-slate-200" : "border-white/5"}`}>
                    <div className="min-w-0 flex flex-col gap-1">
                      <h3 className={`text-base sm:text-[15px] font-extrabold tracking-tight font-sans flex items-center gap-1.5 leading-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                        {selectedIndicator.label.replace("(PROCLUSTER) ", "")}
                      </h3>
                      {/* Desktop-only meta row (TYPE + PRESETS); mobile duplicates of these live in chip row below */}
                      <div className="hidden sm:flex flex-wrap items-center gap-2 mt-1">
                        <span className={`inline-flex items-center h-8 px-2 rounded font-bold uppercase tracking-wide font-mono text-[10px] ${isLight ? "bg-slate-200 text-slate-750" : "bg-white/10 text-slate-300"}`}>
                          ТИП: {selectedIndicator.type.toUpperCase()}
                        </span>
                        <button
                          ref={!isMobile ? presetBtnRef : undefined}
                          onClick={() => { setPresetDropdownOpen((v) => !v); setPresetsError(null) }}
                          className={`inline-flex items-center h-8 gap-1 px-3 rounded border text-xs font-extrabold cursor-pointer transition-all uppercase tracking-wider font-mono ${isLight ? "bg-slate-50 border-slate-250 hover:bg-slate-250 text-slate-700" : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"}`}
                          title="Пресеты настроек этого индикатора"
                        >
                          <Layers className="w-3 h-3 text-emerald-500" />
                          <span>Пресеты ({(presetsByIndicator[selectedIndicator.id] ?? []).length})</span>
                          <ChevronDown className={`w-2.5 h-2.5 opacity-60 transition-transform ${presetDropdownOpen ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-row flex-wrap items-center gap-1 sm:gap-2 no-drag">
                      {/* Mobile-only TYPE + PRESETS — flat in chip row with DEFAULT+ACTIVATE */}
                      <span className={`sm:hidden inline-flex items-center h-6 px-1.5 rounded font-bold uppercase tracking-wide font-mono text-[9px] ${isLight ? "bg-slate-200 text-slate-750" : "bg-white/10 text-slate-300"}`}>
                        ТИП: {selectedIndicator.type.toUpperCase()}
                      </span>
                      <button
                        ref={isMobile ? presetBtnRef : undefined}
                        onClick={() => { setPresetDropdownOpen((v) => !v); setPresetsError(null) }}
                        className={`sm:hidden inline-flex items-center h-6 gap-1 px-1.5 rounded border text-[9px] font-extrabold cursor-pointer transition-all uppercase tracking-wider font-mono ${isLight ? "bg-slate-50 border-slate-250 hover:bg-slate-250 text-slate-700" : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"}`}
                        title="Пресеты"
                      >
                        <Layers className="w-3 h-3 text-emerald-500" />
                        <span>Пресеты ({(presetsByIndicator[selectedIndicator.id] ?? []).length})</span>
                        <ChevronDown className={`w-2.5 h-2.5 opacity-60 transition-transform ${presetDropdownOpen ? "rotate-180" : ""}`} />
                      </button>
                      {presetDropdownOpen && presetPopoverPos && createPortal(
                        <div
                          ref={presetPopoverRef}
                          style={{ position: 'fixed', top: presetPopoverPos.top, left: presetPopoverPos.left }}
                          className={`w-[345px] max-w-[345px] z-[9999] rounded-xl border shadow-2xl p-3 flex flex-col gap-2 no-drag ${isLight ? "bg-white border-slate-200" : "bg-[#0b0f19] border-white/10"}`}
                        >
                            <div className="flex items-center justify-between">
                              <span className={`text-[10px] font-bold uppercase tracking-widest font-mono ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                                Пресеты — {selectedIndicator.label.replace("(PROCLUSTER) ", "")}
                              </span>
                              <button
                                onClick={() => { setCreatePresetOpen((v) => !v); setNewPresetName(''); setPresetsError(null) }}
                                disabled={!limits.customIndicatorSettings}
                                title={!limits.customIndicatorSettings ? "Доступно на платных тарифах" : undefined}
                                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${isLight ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"}`}
                              >
                                <Plus className="w-3 h-3" />
                                Новый
                              </button>
                            </div>

                            {createPresetOpen && (
                              <div className={`p-2 rounded-lg flex gap-1.5 ${isLight ? "bg-slate-50 border border-slate-200" : "bg-white/5 border border-white/10"}`}>
                                <input
                                  autoFocus
                                  type="text"
                                  value={newPresetName}
                                  placeholder="Имя пресета"
                                  maxLength={64}
                                  onChange={(e) => setNewPresetName(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSavePreset() }}
                                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] outline-none border ${isLight ? "bg-white border-slate-200 text-slate-800" : "bg-[#030712]/60 border-white/10 text-slate-100"}`}
                                />
                                <button
                                  onClick={() => void handleSavePreset()}
                                  className="px-2 py-1.5 rounded-md text-[11px] font-bold bg-blue-600 hover:bg-blue-500 text-white"
                                >
                                  Сохранить
                                </button>
                              </div>
                            )}

                            {presetsError && (
                              <div className={`text-[10px] font-medium px-1 ${isLight ? "text-rose-600" : "text-rose-400"}`}>
                                {presetsError}
                              </div>
                            )}

                            <div className="flex flex-col gap-1 max-h-[260px] overflow-y-auto pr-1">
                              {/* Virtual admin-default row for the current key
                                  (Feature 1). Visible to everyone when an
                                  admin_indicator_defaults row exists for this
                                  indicator at (symbol, market, tf) or all-tf.
                                  Read-only: Apply only — no rename, no delete. */}
                              {adminDefaultForSelected && (
                                <div className={`flex items-center justify-between px-2 py-1.5 rounded-lg border ${isLight ? "bg-emerald-50 border-emerald-200" : "bg-emerald-500/5 border-emerald-500/20"}`}>
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <Shield className={`w-3 h-3 shrink-0 ${isLight ? "text-emerald-600" : "text-emerald-400"}`} />
                                    <span className={`text-[11px] font-bold truncate ${isLight ? "text-emerald-900" : "text-emerald-200"}`}>Дефолт от админа</span>
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider font-mono shrink-0 ${isLight ? "bg-emerald-200 text-emerald-900" : "bg-emerald-500/30 text-emerald-200"}`}>
                                      ДЕФОЛТ
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => handleApplyAdminDefault(adminDefaultForSelected.settings)}
                                    className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500 hover:bg-emerald-400 text-white"
                                  >
                                    Применить
                                  </button>
                                </div>
                              )}

                              {presetsLoading[selectedIndicator.id] && (
                                <div className={`text-[10px] italic px-1 py-1 ${isLight ? "text-slate-500" : "text-slate-400"}`}>Загрузка…</div>
                              )}

                              {(presetsByIndicator[selectedIndicator.id] ?? []).length === 0 && !presetsLoading[selectedIndicator.id] && !adminDefaultForSelected && (
                                <div className={`text-[10px] italic px-1 py-2 ${isLight ? "text-slate-500" : "text-slate-400"}`}>Нет пресетов</div>
                              )}

                              {(presetsByIndicator[selectedIndicator.id] ?? []).map((preset) => (
                                <div key={preset.id} className={`flex items-center justify-between px-2 py-1.5 rounded-lg border transition ${isLight ? "bg-white border-slate-200 hover:bg-slate-50" : "bg-white/[0.02] border-white/10 hover:bg-white/[0.06]"}`}>
                                  {renamingId === preset.id ? (
                                    <input
                                      autoFocus
                                      type="text"
                                      value={renameDraft}
                                      maxLength={64}
                                      onChange={(e) => setRenameDraft(e.target.value)}
                                      onBlur={() => void handleRenamePreset(preset)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') void handleRenamePreset(preset)
                                        if (e.key === 'Escape') setRenamingId(null)
                                      }}
                                      className={`flex-1 rounded-md px-1.5 py-0.5 text-[11px] outline-none border mr-2 ${isLight ? "bg-white border-slate-300" : "bg-[#030712]/60 border-white/20 text-slate-100"}`}
                                    />
                                  ) : (
                                    <span className={`text-[11px] font-semibold truncate ${isLight ? "text-slate-800" : "text-slate-200"}`} title={preset.name}>
                                      {preset.name}
                                    </span>
                                  )}
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    <button
                                      onClick={() => void handleApplyPreset(preset)}
                                      title="Применить пресет к текущему графику"
                                      className={`p-1 rounded ${isLight ? "hover:bg-emerald-100 text-emerald-700" : "hover:bg-emerald-500/20 text-emerald-400"}`}
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => { setRenamingId(preset.id); setRenameDraft(preset.name) }}
                                      disabled={!limits.customIndicatorSettings}
                                      title={!limits.customIndicatorSettings ? "Доступно на платных тарифах" : "Переименовать"}
                                      className={`p-1 rounded disabled:opacity-40 disabled:cursor-not-allowed ${isLight ? "hover:bg-slate-200 text-slate-600" : "hover:bg-white/10 text-slate-400"}`}
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => void handleDeletePreset(preset)}
                                      disabled={!limits.customIndicatorSettings}
                                      title={!limits.customIndicatorSettings ? "Доступно на платных тарифах" : "Удалить"}
                                      className={`p-1 rounded disabled:opacity-40 disabled:cursor-not-allowed ${isLight ? "hover:bg-rose-100 text-rose-600" : "hover:bg-rose-500/20 text-rose-400"}`}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>,
                        document.body
                      )}
                      {/* Admin-only "Дефолт" toggle (Feature 1). Writes the
                          CURRENT live settings as admin default for the
                          current (symbol, market, tf) via PATCH-single so
                          sibling indicators are preserved. Pressing again
                          removes this indicator from the per-tf admin row. */}
                      {isAdmin && symbol && market && timeframe && (
                        <div className="flex flex-col items-end gap-0.5">
                          <button
                            onClick={() => void handleToggleAdminDefault()}
                            title={adminTfHasSelected ? `Снять админ-дефолт (${timeframe.toUpperCase()})` : "Сохранить текущие настройки как админ-дефолт для этого ТФ"}
                            className={`inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 h-6 sm:h-8 font-bold text-[9px] sm:text-[11px] rounded-md sm:rounded-lg cursor-pointer transition-all active:scale-[0.98] border ${adminTfHasSelected
                              ? "bg-emerald-500 hover:bg-emerald-400 text-white border-emerald-600"
                              : isLight
                                ? "bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                : "bg-white/5 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                              }`}
                          >
                            <Shield className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            {adminTfHasSelected ? "Дефолт ✓" : "Дефолт"}
                          </button>
                          <span className={`hidden sm:block text-[9px] sm:text-[10px] font-bold font-mono leading-none ${adminTfHasSelected ? isLight ? "text-emerald-600" : "text-emerald-400" : "text-slate-500"}`}>
                            {adminTfHasSelected ? `Для ${timeframe.toUpperCase()}` : "Не задан"}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-col items-end gap-0.5">
                      <button
                        onClick={() => toggleActive(selectedIndicator.id)}
                        title={selectedIndicator.isActive ? "Активно: 1 шт." : "Деактивирован"}
                        className={`inline-flex items-center px-1.5 sm:px-3 h-6 sm:h-8 font-bold text-[9px] sm:text-[11px] rounded-md sm:rounded-lg cursor-pointer transition-all active:scale-[0.98] text-white ${selectedIndicator.isActive ? "bg-emerald-600 hover:bg-emerald-500" : "bg-blue-650 hover:bg-blue-600/90"}`}
                      >
                        {selectedIndicator.isActive ? (
                          <>
                            <span className="sm:hidden">АКТИВЕН</span>
                            <span className="hidden sm:inline">Добавить еще</span>
                          </>
                        ) : "Активировать"}
                      </button>
                      <span className={`hidden sm:block text-[10px] font-bold font-mono leading-none ${selectedIndicator.isActive ? isLight ? "text-emerald-600" : "text-emerald-400" : isLight ? "text-amber-600" : "text-amber-500"}`}>
                        {selectedIndicator.isActive ? "Активно: 1 шт." : "Деактивирован"}
                      </span>
                      </div>
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
                        <span>Настройки индикаторов заблокированы для вашего тарифа ({limits.tier.toUpperCase()})! Выберите платный тариф для разблокировки.</span>
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
                                value={
                                  (selectedIndicator.settings.domColorBid ?? "#228B22").length === 9
                                    ? "#" + (selectedIndicator.settings.domColorBid ?? "#228B22").slice(3)
                                    : (selectedIndicator.settings.domColorBid ?? "#228B22")
                                }
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
                                value={
                                  (selectedIndicator.settings.domColorAsk ?? "#C80000").length === 9
                                    ? "#" + (selectedIndicator.settings.domColorAsk ?? "#C80000").slice(3)
                                    : (selectedIndicator.settings.domColorAsk ?? "#C80000")
                                }
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

                      {/* Per-indicator "apply to all TFs" — pushes this id to the
                          '*' row and every existing per-tf row of (symbol, market)
                          on Apply. Default OFF on every open; never persisted. */}
                      {onPropagateIndicator && (
                        <div className={`mt-3 pt-3 border-t flex items-center gap-2 no-drag ${isLight ? "border-slate-200" : "border-white/5"}`}>
                          <input
                            type="checkbox"
                            id={`propagate-${selectedIndicator.id}`}
                            checked={propagateIds.has(selectedIndicator.id)}
                            disabled={!limits.customIndicatorSettings}
                            onChange={() => togglePropagate(selectedIndicator.id)}
                            className="w-3.5 h-3.5 cursor-pointer accent-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                          <label
                            htmlFor={`propagate-${selectedIndicator.id}`}
                            className={`text-[11px] font-medium select-none ${!limits.customIndicatorSettings ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${isLight ? "text-slate-600 hover:text-slate-800" : "text-slate-400 hover:text-slate-200"}`}
                            title={!limits.customIndicatorSettings ? "Доступно на платных тарифах" : "Применить настройки этого индикатора ко всем ТФ. Снимается при каждом открытии модалки."}
                          >
                            Применить ко всем ТФ ({selectedIndicator.label.replace("(PROCLUSTER) ", "")})
                          </label>
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
          <div className={`flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-4.5 border-t transition-all duration-300 ${isLight ? "bg-white/30 border-slate-200" : "border-white/5 bg-slate-950/20"}`}>
            <div className="hidden sm:flex items-center gap-4.5 select-none text-[10.5px] font-mono text-slate-500 pb-0.5">
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
            <div className="flex items-center gap-2 sm:gap-3 ml-auto">
              <button
                onClick={handleCancel}
                className={`px-3 sm:px-5 py-1.5 sm:py-2 rounded-xl text-xs font-bold font-sans transition cursor-pointer ${isLight ? "hover:bg-slate-200/80 text-slate-600 hover:text-slate-800" : "hover:bg-white/5 text-slate-400 hover:text-slate-200"}`}
              >
                Отмена
              </button>
              <button
                onClick={handleApply}
                className="px-4 sm:px-6 py-1.5 sm:py-2 bg-[#2563eb] hover:bg-blue-600 text-white rounded-xl text-xs font-extrabold font-sans transition-all active:scale-[0.98] shadow-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#2563eb]"
              >
                <Activity className="w-3.5 h-3.5 text-blue-200" />
                <span>Сохранить</span>
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
