/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// @ts-nocheck — design-src code uses less strict TS; kept as-is to avoid mass rewrites.

import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { ClusterCandle, ClusterCell, CryptoPair, IndicatorSettings, Indicator, OrderBook } from "./types";
import { ZoomIn, ZoomOut, Maximize2, Compass, Move, Layers, Activity, Eye, EyeOff, Settings, Trash2, Globe, Slash, Minus, Square, Grid3X3, Ruler, Type, BarChart3, Check, ChevronDown, ChevronUp, LayoutGrid, ArrowUpRight, TrendingUp, TrendingDown, Equal } from "lucide-react";
import { Portal } from "@/components/Portal";
import logoWatermark from "@/assets/images/procluster_logo_1779485281399.png";
import { storage } from "./lib/storage";
import { volumeOnChartIndicator, deltaIndicator, cvdIndicator, clusterSearchIndicator, rsiIndicator } from "./indicators";
import { macdHist, zToScale } from "./indicators/math";
import { drawDrawingObjects } from "./utils/drawingRenderer";
import { DrawingToolbar } from "./DrawingToolbar";
import { ChartToolsHeader } from "./ChartToolsHeader";
import { useDrawingDefaults, getClientDefaults } from "@/contexts/DrawingDefaultsContext";
import { apiGetDrawings, apiPutDrawings } from "@/features/drawings/api";
import { useAuthContext } from "@/features/auth/AuthContext";
import { fetchBookDepthRatio, type BookDepthRatioPoint } from "@/features/bookdepth/api";
import { fetchLongShortRatio, type LongShortRatioPoint } from "@/features/longshort/api";

// Abbreviates a magnitude (>=1000) to "к/м" (RU/KZ) or "k/m" (EN), rounded to 1 decimal,
// trailing ".0" trimmed: 2000→"2к", 2629→"2.6к", 25720→"25.7к", 1101565→"1.1м".
// Operates on the absolute value only — the +/- sign is preserved by the caller.
const abbreviateNum = (v: number, lang: "RU" | "EN" | "KZ"): string => {
  const abs = Math.abs(v);
  const kSuf = lang === "EN" ? "k" : "к";
  const mSuf = lang === "EN" ? "m" : "м";
  if (abs >= 1_000_000) {
    return String(Math.round(abs / 1e5) / 10) + mSuf;
  }
  const n = Math.round(abs / 100) / 10; // thousands, 1 decimal
  if (n >= 1000) return String(Math.round(abs / 1e5) / 10) + mSuf; // rounded up into millions
  return String(n) + kSuf;
};

const rgbaToHex = (rgba: string): string => {
  const m = rgba.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return rgba;
  const r = parseInt(m[1]).toString(16).padStart(2, "0");
  const g = parseInt(m[2]).toString(16).padStart(2, "0");
  const b = parseInt(m[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
};

// hexToRgba: "#rrggbb" (or "#rrggbbaa") + alpha[0..1] -> "rgba(...)". Falls back
// to the input string if it can't be parsed (e.g. already rgba()).
const hexToRgba = (hex: string, alpha: number): string => {
  if (!hex || !hex.startsWith("#")) return hex;
  const clean = hex.slice(1);
  if (clean.length !== 6 && clean.length !== 8) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const baseA = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
  const a = Math.max(0, Math.min(1, alpha)) * baseA;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const parseHexColor = (hex: string): string => {
  if (!hex) return "#ffffff";
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 8) {
    // ARGB to RGBA: AARRGGBB -> RRGGBBAA
    const aa = h.slice(0, 2);
    const rr = h.slice(2, 4);
    const gg = h.slice(4, 6);
    const bb = h.slice(6, 8);
    return `#${rr}${gg}${bb}${aa}`;
  }
  return hex;
};

// Footer ("Подвальный") panels that can be reordered with the arrows on their plate.
// Overlays/global indicators are NOT included here.
const REORDERABLE_PANEL_IDS = ["delta", "cvd", "rsi", "bidAskRatio", "longShortRatio", "buySellZone"] as const;

// --- Price-scale tick helpers (TradingView-style "nice" round levels) ---
// niceStep: pick a round step (1/2/5 * 10^n) so labels land ~targetPx apart.
function niceStep(range: number, chartHeightPx: number, targetPx: number): number {
  const tickCount = Math.max(1, chartHeightPx / targetPx);
  const rawStep = range / tickCount;
  if (!isFinite(rawStep) || rawStep <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / magnitude;
  let mul: number;
  if (norm <= 1) mul = 1;
  else if (norm <= 2) mul = 2;
  else if (norm <= 5) mul = 5;
  else mul = 10;
  return mul * magnitude;
}

// decimalsForStep: how many fraction digits to show given the step and pair tick size.
function decimalsForStep(step: number, priceStep: number): number {
  const fromStep = step > 0 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
  const fromTick = priceStep > 0 && priceStep < 0.1
    ? Math.max(0, Math.ceil(-Math.log10(priceStep))) : 0;
  return Math.min(8, Math.max(fromStep, fromTick));
}

// snapStepToTick: round the nice step up to a whole multiple of the pair tick size.
function snapStepToTick(niceS: number, priceStep: number): number {
  if (!(priceStep > 0)) return niceS;
  if (niceS < priceStep) return priceStep;
  return Math.ceil(niceS / priceStep) * priceStep;
}

interface ClusterChartProps {
  candles: ClusterCandle[];
  activePair: CryptoPair;
  indicators?: Indicator[];
  activeIndicators?: Record<string, boolean>;
  marketType?: "SPOT" | "FUTURES";
  onToggleMarketType?: () => void;
  theme?: "dark" | "light";
  candleType?: "auto" | "japanese" | "footprint" | "clusters" | "bars";
  candleDataType?: "bid_ask" | "delta" | "volume";
  candlePalette?: "default" | "alternative";
  abbreviateNumbers?: boolean;
  onToggleAbbreviateNumbers?: () => void;
  hideClusterNumbers?: boolean;
  onToggleHideClusterNumbers?: () => void;
  timeframe?: string;
  onToggleIndicator?: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
  onRemoveIndicator?: (id: string) => void;
  onShowIndicatorsSettings?: (id?: string) => void;
  language?: "RU" | "EN" | "KZ";
  workspaceLayout?: "1" | "2h" | "2v";
  onWorkspaceLayoutChange?: (layout: "1" | "2h" | "2v") => void;
  workspacesCount?: number;
  orderBook?: OrderBook;
  clusterStep?: number;
  onNeedHistory?: (oldestTimestamp: number) => void;
  onVisibleTimestampsChange?: (timestamps: number[]) => void;
  showAnomalies?: boolean | undefined;
  onChangeShowAnomalies?: ((show: boolean) => void) | undefined;
  userRole?: string;
  prependScrollRef?: React.MutableRefObject<((addedCount: number) => void) | null>;
  isLoadingHistory?: boolean;
}

export default function ClusterChart({
  candles,
  activePair,
  indicators,
  activeIndicators = {
    clusterSearch: false,
    delta: false,
    volume: false,
    cvd: false,
    stackedImbalance: false,
    depthOfMarket: false,
    bidAskRatio: false,
    longShortRatio: false,
    buySellZone: false
  },
  marketType = "SPOT",
  onToggleMarketType,
  theme = "dark",
  candleType = "auto",
  candleDataType = "bid_ask",
  candlePalette = "default",
  abbreviateNumbers = false,
  onToggleAbbreviateNumbers,
  hideClusterNumbers = false,
  onToggleHideClusterNumbers,
  timeframe,
  onToggleIndicator,
  onToggleVisibility,
  onRemoveIndicator,
  onShowIndicatorsSettings,
  language = "EN",
  workspaceLayout,
  onWorkspaceLayoutChange,
  workspacesCount = 1,
  orderBook,
  clusterStep,
  onNeedHistory,
  onVisibleTimestampsChange,
  showAnomalies = true,
  onChangeShowAnomalies,
  userRole,
  prependScrollRef,
  isLoadingHistory = false,
}: ClusterChartProps) {
  
  const isLight = theme === "light";
  const effectiveStep = (clusterStep && clusterStep > 0) ? clusterStep : activePair.priceStep;
  const currentPrice = candles.length > 0 ? candles[candles.length - 1]!.close : undefined;
  const { drawingDefaults, updateDrawingDefault } = useDrawingDefaults();
  const { accessToken } = useAuthContext();
  const comboKey = `${activePair.symbol}_${timeframe}_${marketType}`;
  const drawingsLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevComboKeyRef = useRef(comboKey);
  const hadTokenRef = useRef(false);

  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  const [fpsDisplay, setFpsDisplay] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const indicatorSettings = useMemo(() => {
    if (!indicators) return undefined
    return Object.fromEntries(indicators.map(i => [i.id, i.settings]))
  }, [indicators])

  // CVD indicator specific settings
  const cvdSettings = indicatorSettings?.cvd || {};
  const cvdPeriod = cvdSettings.cvdPeriod || "all";
  const cvdLineColor = cvdSettings.cvdLineColor || "#a855f7";
  const cvdPlotType = cvdSettings.cvdPlotType || "line";
  const cvdSmoothing = typeof cvdSettings.smoothing === "number" ? cvdSettings.smoothing : 10;

  // RSI indicator specific settings (footer panel, fixed 0-100 scale)
  const rsiSettings = indicatorSettings?.rsi || {};
  const rsiPeriod = typeof rsiSettings.rsiPeriod === "number" ? rsiSettings.rsiPeriod : 14;
  const rsiLineColor = rsiSettings.rsiLineColor || "#a855f7";
  const rsiZoneColor = rsiSettings.rsiZoneColor || "#64748b";
  const rsiZoneOpacity = typeof rsiSettings.rsiZoneOpacity === "number" ? rsiSettings.rsiZoneOpacity : 12;

  // Bid & Ask Ratio indicator specific settings (footer panel, fixed -1..+1 scale,
  // data fetched from the backend — see bidAskRatioData effect below)
  const bidAskRatioSettings = indicatorSettings?.bidAskRatio || {};
  const bidAskRatioBand = bidAskRatioSettings.bidAskRatioBand || "5";
  const bidAskRatioBullColor = bidAskRatioSettings.bidAskRatioBullColor || "#10b981";
  const bidAskRatioBearColor = bidAskRatioSettings.bidAskRatioBearColor || "#ef4444";
  const bidAskRatioOpacity = typeof bidAskRatioSettings.bidAskRatioOpacity === "number" ? bidAskRatioSettings.bidAskRatioOpacity : 100;
  const bidAskRatioRKey: "r1" | "r3" | "r5" = bidAskRatioBand === "1" ? "r1" : bidAskRatioBand === "3" ? "r3" : "r5";

  // Long/Short Account Ratio indicator settings (footer panel, line, auto-scale;
  // data fetched from the backend — see longShortRatioData effect below)
  const longShortRatioSettings = indicatorSettings?.longShortRatio || {};
  const longShortRatioLineColor = longShortRatioSettings.longShortRatioLineColor || "#a855f7";
  const longShortRatioDisplayMode: "ratio" | "longPct" = longShortRatioSettings.longShortRatioDisplayMode === "longPct" ? "longPct" : "ratio";

  // Buy/Sell Zone — composite 0..100 footer oscillator. Combines RSI/MACD (from
  // candles) with long/short ratio and bid/ask depth (from the backend). futures-only.
  const bsZoneSettings = indicatorSettings?.buySellZone || {};
  const bsZoneWLS = typeof bsZoneSettings.bsZoneWLS === "number" ? bsZoneSettings.bsZoneWLS : 0.35;
  const bsZoneWRSI = typeof bsZoneSettings.bsZoneWRSI === "number" ? bsZoneSettings.bsZoneWRSI : 0.25;
  const bsZoneWMACD = typeof bsZoneSettings.bsZoneWMACD === "number" ? bsZoneSettings.bsZoneWMACD : 0.2;
  const bsZoneWBAR = typeof bsZoneSettings.bsZoneWBAR === "number" ? bsZoneSettings.bsZoneWBAR : 0.2;
  const bsZoneBand: "1" | "3" | "5" = bsZoneSettings.bsZoneBand === "1" ? "1" : bsZoneSettings.bsZoneBand === "3" ? "3" : "5";
  const bsZoneRKey: "r1" | "r3" | "r5" = bsZoneBand === "1" ? "r1" : bsZoneBand === "3" ? "r3" : "r5";
  const bsZoneRsiLen = typeof bsZoneSettings.bsZoneRsiLen === "number" ? bsZoneSettings.bsZoneRsiLen : 14;
  const bsZoneMacdZlen = typeof bsZoneSettings.bsZoneMacdZlen === "number" ? bsZoneSettings.bsZoneMacdZlen : 50;
  const bsZoneLsZlen = typeof bsZoneSettings.bsZoneLsZlen === "number" ? bsZoneSettings.bsZoneLsZlen : 150;
  const bsZoneBalUp = typeof bsZoneSettings.bsZoneBalUp === "number" ? bsZoneSettings.bsZoneBalUp : 65;
  const bsZoneBalDown = typeof bsZoneSettings.bsZoneBalDown === "number" ? bsZoneSettings.bsZoneBalDown : 35;
  const bsZoneOverUp = typeof bsZoneSettings.bsZoneOverUp === "number" ? bsZoneSettings.bsZoneOverUp : 80;
  const bsZoneOverDown = typeof bsZoneSettings.bsZoneOverDown === "number" ? bsZoneSettings.bsZoneOverDown : 20;
  const bsZoneLineColor = bsZoneSettings.bsZoneLineColor || "#22d3ee";
  const bsZoneBalColor = bsZoneSettings.bsZoneBalColor || "#64748b";
  const bsZoneBalOpacity = typeof bsZoneSettings.bsZoneBalOpacity === "number" ? bsZoneSettings.bsZoneBalOpacity : 10;
  const bsZoneOverUpColor = bsZoneSettings.bsZoneOverUpColor || "#ef4444";
  const bsZoneOverDownColor = bsZoneSettings.bsZoneOverDownColor || "#10b981";
  const bsZoneOverOpacity = typeof bsZoneSettings.bsZoneOverOpacity === "number" ? bsZoneSettings.bsZoneOverOpacity : 30;
  const bsZoneShowBadges = bsZoneSettings.bsZoneShowBadges !== false;

  // Delta indicator specific settings
  const deltaSettings = indicatorSettings?.delta || {};
  const deltaPlotType = deltaSettings.deltaPlotType || "candles";

  // Stacked Imbalance indicator specific settings
  const siSettings = indicatorSettings?.stackedImbalance || {};
  const siLineWidth = typeof siSettings.siLineWidth === "number" ? siSettings.siLineWidth : 2;

  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<any[]>([]);
  const [drawingInProgress, setDrawingInProgress] = useState<any | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<number | null>(null);
  const [drawingDragState, setDrawingDragState] = useState<any | null>(null);
  const [textInputModal, setTextInputModal] = useState<{
    id: number;
    startTs: number;
    startPrice: number;
    endTs: number;
    endPrice: number;
  } | null>(null);
  const [textInputValue, setTextInputValue] = useState("");
  const [textInputFontSize, setTextInputFontSize] = useState<number>(11);
  const [textInputColor, setTextInputColor] = useState<string>("#3b82f6");
  const [areDrawingsVisible, setAreDrawingsVisible] = useState<boolean>(() => {
    try { return storage.get("procluster_drawings_visible") !== "false" } catch { return true }
  });
  // Branch A step 1: stable callbacks for the memoized DrawingToolbar — functional
  // setState updaters mean these never need to be recreated, so React.memo never
  // breaks on reference identity.
  const onToggleDrawingsVisibility = useCallback(() => {
    setAreDrawingsVisible(prev => {
      const next = !prev;
      try { storage.set("procluster_drawings_visible", String(next)); } catch {}
      return next;
    });
  }, []);
  const onClearAllDrawings = useCallback(() => {
    setDrawings([]);
    setSelectedDrawingId(null);
  }, []);
  const [isOverlayLegendCollapsed, setIsOverlayLegendCollapsed] = useState<boolean>(() => {
    return storage.get("chart_overlay_legend_collapsed") === "true";
  });

  const [volumeSettingsDrawingId, setVolumeSettingsDrawingId] = useState<number | null>(null);
  const [positionSettingsDrawingId, setPositionSettingsDrawingId] = useState<number | null>(null);

  const [positionGlobalSettings, setPositionGlobalSettings] = useState(() => {
    return storage.getJson<any>("procluster_position_settings", {
      deposit: 10000,
      risk: 1,
      riskType: "percent",
      colorTarget: "rgba(16, 185, 129, 0.22)",
      colorStop: "rgba(239, 68, 68, 0.22)",
      opacity: 0.22,
      fontSize: 10,
      makerFee: 0.02,
      takerFee: 0.05,
      entryFeeType: "maker",
      exitFeeType: "taker"
    });
  });

  const updatePositionSettings = (newSettings: Partial<typeof positionGlobalSettings>) => {
    const updated = { ...positionGlobalSettings, ...newSettings };
    setPositionGlobalSettings(updated);
    storage.setJson("procluster_position_settings", updated);
    updateDrawingDefault("position", updated);
    if (positionSettingsDrawingId !== null) {
      setDrawings(prev => prev.map(d =>
        d.id === positionSettingsDrawingId ? { ...d, ...newSettings } : d
      ));
    } else {
      setDrawings(prev => prev.map(d =>
        (d.type === "long" || d.type === "short") ? { ...d, ...newSettings } : d
      ));
    }
  };

  const [volProfileGlobalSettings, setVolProfileGlobalSettings] = useState(() => {
    const defaults = {
      extendPoc: false,
      volColor: "#3b82f6",
      pocColor: "#3b82f6",
      vpVaOpacity: 0.28,
      vpOutVaOpacity: 0.28 * 0.3,
      vpPocOpacity: 1.0,
      vpBgOpacity: 0.03,
      vpBorderOpacity: 0.8
    };
    const stored = storage.getJson<any>("procluster_volume_profile_settings", defaults);
    if (stored && stored.opacity !== undefined && stored.vpVaOpacity === undefined) {
      const legacy = stored.opacity;
      const migrated = {
        ...defaults,
        ...stored,
        vpVaOpacity: legacy,
        vpOutVaOpacity: legacy * 0.3
      };
      delete migrated.opacity;
      storage.setJson("procluster_volume_profile_settings", migrated);
      return migrated;
    }
    return { ...defaults, ...stored };
  });

  const updateVolProfileSettings = (newSettings: Partial<typeof volProfileGlobalSettings>) => {
    const updated = { ...volProfileGlobalSettings, ...newSettings };
    setVolProfileGlobalSettings(updated);
    storage.setJson("procluster_volume_profile_settings", updated);
    updateDrawingDefault("volume", updated);
    setDrawings(prev => prev.map(d => d.type === "volume" ? { ...d, ...updated } : d));
  };

  const [showCandleOutline, setShowCandleOutline] = useState(() => storage.get("chart_settings_show_candle_outline") !== "false");
  const [showChartSettings, setShowChartSettings] = useState(false);
  // Anchor rect of the settings button (lives in ChartToolsHeader) for the dropdown.
  const [settingsBtnRect, setSettingsBtnRect] = useState<DOMRect | null>(null);
  const settingsBtnRectRef = useRef<DOMRect | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    storage.set("chart_settings_show_candle_outline", String(showCandleOutline));
  }, [showCandleOutline]);

  // Sync drawing defaults from backend (Phase 14 Step 1)
  useEffect(() => {
    if (drawingDefaults["volume"]) {
      setVolProfileGlobalSettings(prev => ({ ...prev, ...drawingDefaults["volume"] }));
    }
    if (drawingDefaults["position"]) {
      setPositionGlobalSettings(prev => ({ ...prev, ...drawingDefaults["position"] }));
    }
  }, [drawingDefaults]);

  // Phase 14 Step 2: load drawings on mount / combo change / token arrival
  useEffect(() => {
    const comboChanged = comboKey !== prevComboKeyRef.current;
    prevComboKeyRef.current = comboKey;

    // Guest or logout: clear local drawings, block nothing
    if (!accessToken) {
      drawingsLoadedRef.current = true;
      setDrawings([]);
      return;
    }

    // Token refresh (already had a token, same combo): skip reload
    if (!comboChanged && hadTokenRef.current) {
      return;
    }
    hadTokenRef.current = true;

    drawingsLoadedRef.current = false;
    const symbol = activePair.symbol;
    const interval = timeframe;
    const market = (marketType || "SPOT").toLowerCase();
    let cancelled = false;

    if (comboChanged) {
      setDrawings([]);
    }

    apiGetDrawings(symbol, interval, market, accessToken)
      .then(loaded => {
        if (cancelled) return;
        const mapped = loaded.map(d => ({ id: Number(d.id), type: d.drawingType, ...d.payload }));
        setDrawings(prev => {
          if (prev.length === 0) return mapped;
          const existingIds = new Set(prev.map(d => d.id));
          const merged = [...prev];
          for (const d of mapped) {
            if (!existingIds.has(d.id)) merged.push(d);
          }
          return merged;
        });
      })
      .catch(err => console.warn('[Drawings] load error:', err))
      .finally(() => { if (!cancelled) drawingsLoadedRef.current = true; });

    return () => { cancelled = true; };
  }, [comboKey, accessToken]);

  // Migrate legacy startIdx/endIdx -> startTs/endTs once candles are available.
  // Idempotent: runs only on drawings that still lack startTs. Order-independent
  // wrt initial drawings load and first setCandles — whichever lands later kicks
  // it off. Returning the same array reference makes setDrawings bail, so this
  // effect cannot loop on its own changes.
  useEffect(() => {
    if (candles.length === 0) return;
    const needsMigration = drawings.some(d => d.startTs == null && d.startIdx != null);
    if (!needsMigration) return;
    setDrawings(prev => {
      let changed = false;
      const next = prev.map(d => {
        if (d.startTs == null && d.startIdx != null) {
          const i = Math.max(0, Math.min(candles.length - 1, Math.floor(d.startIdx)));
          const j = Math.max(0, Math.min(candles.length - 1, Math.floor(d.endIdx ?? d.startIdx)));
          const startTs = candles[i]?.timestamp;
          const endTs = candles[j]?.timestamp;
          if (startTs == null || endTs == null) return d;
          if (i === 0 && d.startIdx < 0) console.warn("[Drawings] migrated anchor clamped to oldest candle (id=", d.id, ")");
          if (i === candles.length - 1 && d.startIdx > candles.length - 1) console.warn("[Drawings] migrated anchor clamped to newest candle (id=", d.id, ")");
          changed = true;
          const migrated: any = { ...d, startTs, endTs };
          delete migrated.startIdx;
          delete migrated.endIdx;
          return migrated;
        }
        return d;
      });
      return changed ? next : prev;
    });
  }, [candles, drawings]);

  // Phase 14 Step 2: auto-save drawings with 800ms debounce
  useEffect(() => {
    if (!accessToken || !drawingsLoadedRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const symbol = activePair.symbol;
      const interval = timeframe;
      const market = (marketType || "SPOT").toLowerCase();
      const items = drawings.map(d => ({
        id: String(d.id),
        drawingType: d.type,
        payload: Object.fromEntries(Object.entries(d).filter(([k]) => k !== "id" && k !== "type")),
      }));
      apiPutDrawings(symbol, interval, market, items, accessToken)
        .catch(err => console.warn('[Drawings] save error for', symbol, interval, market, err));
    }, 800);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [drawings]);

  const [selectedTimezone, setSelectedTimezone] = useState<string>(() => {
    return storage.get("procluster_chart_timezone") || "local";
  });

  useEffect(() => {
    storage.set("procluster_chart_timezone", selectedTimezone);
  }, [selectedTimezone]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && (
        activeEl.tagName === "INPUT" || 
        activeEl.tagName === "TEXTAREA" || 
        activeEl.contentEditable === "true"
      )) {
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawingId !== null) {
        e.preventDefault();
        setDrawings(prev => prev.filter(d => d.id !== selectedDrawingId));
        setSelectedDrawingId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedDrawingId]);

  const formatTimezoneString = (timestamp: number, isHovered: boolean) => {
    const date = new Date(timestamp);
    const timezoneOpt = selectedTimezone === "local" ? undefined : selectedTimezone;
    
    const timeStr = date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezoneOpt,
    });
    
    if (isHovered) {
      const dateStr = date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: timezoneOpt,
      });
      return `${timeStr} ${dateStr}`;
    }
    
    return timeStr;
  };
  // Zoom state: width of each candlestick in pixels
  const [candleWidth, setCandleWidth] = useState<number>(145);
  const candleSpacing = Math.max(1, candleWidth < 30 ? Math.floor(candleWidth * 0.35) : 12);
  const margin = { top: 30, right: 66, bottom: 40, left: 60 };
  const VISIBLE_CANDLES = 100;

  const candleWidthSpacing = candleWidth + candleSpacing;
  const indexToX = (idx: number) => margin.left + idx * candleWidthSpacing;
  const xToIndex = (x: number) => (x - margin.left) / candleWidthSpacing;

  // Domain time axis. intervalMs comes from the current TF — not from neighbor
  // candle diffs, because real data has gaps (weekends/missing bars) that would
  // poison extrapolation outside the loaded window.
  const TF_MS: Record<string, number> = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
  };
  const intervalMs = TF_MS[timeframe ?? ""] ?? 60_000;

  // Binary-search ts<->X mapping. Hot path: called per drawing per frame.
  const tsToIndex = (ts: number): number => {
    const n = candles.length;
    if (n === 0) return 0;
    const firstTs = candles[0]!.timestamp;
    const lastTs = candles[n - 1]!.timestamp;
    if (ts <= firstTs) return (ts - firstTs) / intervalMs;
    if (ts >= lastTs) return (n - 1) + (ts - lastTs) / intervalMs;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (candles[mid]!.timestamp <= ts) lo = mid; else hi = mid - 1;
    }
    const tsLo = candles[lo]!.timestamp;
    const tsHi = candles[lo + 1]!.timestamp;
    const span = tsHi - tsLo || intervalMs;
    return lo + (ts - tsLo) / span;
  };
  const tsToX = (ts: number): number => indexToX(tsToIndex(ts));
  const xToTs = (x: number): number => {
    const idx = xToIndex(x);
    const n = candles.length;
    if (n === 0) return idx * intervalMs;
    const firstTs = candles[0]!.timestamp;
    const lastTs = candles[n - 1]!.timestamp;
    if (idx <= 0) return firstTs + idx * intervalMs;
    if (idx >= n - 1) return lastTs + (idx - (n - 1)) * intervalMs;
    const i = Math.floor(idx);
    const frac = idx - i;
    const tsLo = candles[i]!.timestamp;
    const tsHi = candles[i + 1]!.timestamp;
    return tsLo + frac * (tsHi - tsLo);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerHeight, setContainerHeight] = useState<number>(550);
  const [verticalScale, setVerticalScale] = useState<number>(0.812);

  const hasInitializedZoomRef = useRef<string | null>(null);

  // Height configurations dynamic calculations
  const [deltaPanelHeight, setDeltaPanelHeight] = useState<number>(() => {
    const saved = storage.get("procluster_delta_panel_height");
    return saved ? parseInt(saved, 10) : 120;
  });
  const [cvdPanelHeight, setCvdPanelHeight] = useState<number>(() => {
    const saved = storage.get("procluster_cvd_panel_height");
    return saved ? parseInt(saved, 10) : 120;
  });
  const [rsiPanelHeight, setRsiPanelHeight] = useState<number>(() => {
    const saved = storage.get("procluster_rsi_panel_height");
    return saved ? parseInt(saved, 10) : 120;
  });
  const [bidAskRatioPanelHeight, setBidAskRatioPanelHeight] = useState<number>(() => {
    const saved = storage.get("procluster_bidaskratio_panel_height");
    return saved ? parseInt(saved, 10) : 120;
  });
  const [longShortRatioPanelHeight, setLongShortRatioPanelHeight] = useState<number>(() => {
    const saved = storage.get("procluster_longshortratio_panel_height");
    return saved ? parseInt(saved, 10) : 120;
  });
  const [buySellZonePanelHeight, setBuySellZonePanelHeight] = useState<number>(() => {
    const saved = storage.get("procluster_buysellzone_panel_height");
    return saved ? parseInt(saved, 10) : 120;
  });

  useEffect(() => {
    storage.set("procluster_delta_panel_height", deltaPanelHeight.toString());
  }, [deltaPanelHeight]);

  useEffect(() => {
    storage.set("procluster_cvd_panel_height", cvdPanelHeight.toString());
  }, [cvdPanelHeight]);

  useEffect(() => {
    storage.set("procluster_rsi_panel_height", rsiPanelHeight.toString());
  }, [rsiPanelHeight]);

  useEffect(() => {
    storage.set("procluster_bidaskratio_panel_height", bidAskRatioPanelHeight.toString());
  }, [bidAskRatioPanelHeight]);

  useEffect(() => {
    storage.set("procluster_longshortratio_panel_height", longShortRatioPanelHeight.toString());
  }, [longShortRatioPanelHeight]);

  useEffect(() => {
    storage.set("procluster_buysellzone_panel_height", buySellZonePanelHeight.toString());
  }, [buySellZonePanelHeight]);

  // Vertical stacking order of footer panels (top -> bottom). Persisted in LS.
  // Default is EMPTY: order is then built by activation order (append-on-enable effect below).
  // Existing users keep their saved order. On first mount the append effect seeds any
  // already-active panels in catalogue order (REORDERABLE_PANEL_IDS) as a one-time start.
  const [panelOrder, setPanelOrder] = useState<string[]>(() => {
    const saved = storage.get("procluster_panel_order");
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
      } catch { /* ignore malformed */ }
    }
    return [];
  });

  useEffect(() => {
    storage.set("procluster_panel_order", JSON.stringify(panelOrder));
  }, [panelOrder]);

  // Newly activated panels get appended to the END (last enabled = lowest). Disabled ids stay in
  // the array (just not rendered), so toggling a panel off/on keeps its previous position context.
  useEffect(() => {
    setPanelOrder(prev => {
      let next = prev;
      for (const id of REORDERABLE_PANEL_IDS) {
        if (activeIndicators[id] && !next.includes(id)) {
          next = next === prev ? [...prev] : next;
          next.push(id);
        }
      }
      return next;
    });
  }, [activeIndicators]);

  const [resizingPanel, setResizingPanel] = useState<"delta" | "cvd" | "rsi" | "bidAskRatio" | "longShortRatio" | "buySellZone" | null>(null);

  const panelGap = 24;
  const getPanelHeight = (id: string): number =>
    id === "delta" ? deltaPanelHeight : id === "cvd" ? cvdPanelHeight : id === "rsi" ? rsiPanelHeight : id === "bidAskRatio" ? bidAskRatioPanelHeight : id === "longShortRatio" ? longShortRatioPanelHeight : id === "buySellZone" ? buySellZonePanelHeight : 0;

  // Active footer panels in render order (top -> bottom).
  const activePanels = panelOrder.filter(id => activeIndicators[id]);

  // Total vertical space consumed by all active footer panels. The gap sits ABOVE
  // each divider (between panels), so only (n-1) gaps — content of every panel is
  // flush to its top divider, no dead strip below it.
  const panelsHeightTotal =
    activePanels.reduce((sum, id) => sum + getPanelHeight(id), 0) +
    panelGap * Math.max(0, activePanels.length - 1);

  // Calculate base chart height to fill container exactly, ensuring footer panels are pinned at the bottom
  const chartHeight = Math.max(150, containerHeight - margin.top - margin.bottom - panelsHeightTotal);

  // Single source of truth for each active panel's top Y. Inactive panels are absent.
  const panelTopY: Record<string, number> = {};
  {
    let y = margin.top + chartHeight;
    activePanels.forEach((id, i) => {
      // First panel is flush to the chart/panel boundary (no leading gap). The gap
      // goes above each subsequent panel's divider, not below the divider.
      if (i > 0) y += panelGap;
      panelTopY[id] = y;
      y += getPanelHeight(id);
    });
  }

  // Backwards-compatible aliases used by guarded single-panel render code (canvas panels, ticks, resize).
  const deltaTopY = panelTopY["delta"] ?? 0;
  const cvdTopY = panelTopY["cvd"] ?? 0;
  const rsiTopY = panelTopY["rsi"] ?? 0;
  const bidAskRatioTopY = panelTopY["bidAskRatio"] ?? 0;
  const longShortRatioTopY = panelTopY["longShortRatio"] ?? 0;
  const buySellZoneTopY = panelTopY["buySellZone"] ?? 0;

  const totalSvgHeight = margin.top + chartHeight + panelsHeightTotal + margin.bottom;

  // Move a footer panel up/down by swapping with its visible neighbour (clamped at edges).
  const movePanel = (id: string, dir: -1 | 1) => {
    setPanelOrder(prev => {
      const active = prev.filter(x => activeIndicators[x]);
      const ai = active.indexOf(id);
      const ni = ai + dir;
      if (ai < 0 || ni < 0 || ni >= active.length) return prev;
      const neighbor = active[ni];
      const next = [...prev];
      const i1 = next.indexOf(id);
      const i2 = next.indexOf(neighbor);
      if (i1 < 0 || i2 < 0) return prev;
      [next[i1], next[i2]] = [next[i2], next[i1]];
      return next;
    });
  };

  // S1: crosshair/hover state moved from useState to useRef so mousemove does not
  // re-render the chart. Consumers updated to read refs / be updated imperatively.
  const hoveredCellRef = useRef<{ candleIndex: number; cell: ClusterCell } | null>(null);
  const hoveredClusterSearchRef = useRef<{
    x: number;
    y: number;
    sumVolume: number;
    usdtVolume: number;
    bidPercent: number;
    askPercent: number;
    isBidDominant: boolean;
    isAskDominant: boolean;
    baseAsset: string;
    price: number;
    color: string;
    filterType: "medium" | "large";
  } | null>(null);
  const crosshairRef = useRef<{ x: number; y: number; price: number } | null>(null);

  // S1: dedicated overlay canvas — crosshair, hovered timestamp box, column highlights.
  // Sized to match main canvas, pointer-events:none, z-index above main.
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlaySizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 0 });

  // S1: imperative DOM refs for overlay UI that used to re-render with crosshair state.
  const crosshairPriceGroupRef = useRef<SVGGElement>(null);
  const crosshairPriceRectRef = useRef<SVGRectElement>(null);
  const crosshairPriceTextRef = useRef<SVGTextElement>(null);
  const deltaValueSpanRef = useRef<HTMLSpanElement>(null);
  const cvdValueSpanRef = useRef<HTMLSpanElement>(null);
  const rsiValueSpanRef = useRef<HTMLSpanElement>(null);
  const bidAskRatioValueSpanRef = useRef<HTMLSpanElement>(null);
  const longShortRatioValueSpanRef = useRef<HTMLSpanElement>(null);
  const buySellZoneValueSpanRef = useRef<HTMLSpanElement>(null);
  const clusterTooltipRef = useRef<HTMLDivElement>(null);
  const clusterTooltipTitleWrapRef = useRef<HTMLSpanElement>(null);
  const clusterTooltipTitleTextRef = useRef<HTMLSpanElement>(null);
  const clusterTooltipBadgeRef = useRef<HTMLSpanElement>(null);
  const clusterTooltipVolumeCoinsRef = useRef<HTMLSpanElement>(null);
  const clusterTooltipVolumeUsdtRef = useRef<HTMLSpanElement>(null);
  const clusterTooltipImbalanceRef = useRef<HTMLSpanElement>(null);

  // Drag-to-scroll panning variables supporting full vertical + horizontal scrolling
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleScrollLeft, setVisibleScrollLeft] = useState(0);
  // S3: hot-path mirror of visibleScrollLeft. onScroll writes here every event;
  // the draw closure reads this ref so canvas culling/translation tracks the
  // real scroll position at frame time. The React state above is updated only
  // on half-candle moves or on debounce, so it stops driving the monolith
  // re-render at 60 Hz — it stays available for effects/memos that need to
  // know "the viewport changed meaningfully".
  const visibleScrollLeftRef = useRef<number>(0);
  const visibleScrollLeftLastSyncedRef = useRef<number>(0);
  const scrollSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visibleClientWidth, setVisibleClientWidth] = useState(800);
  const [priceCenterOffset, setPriceCenterOffset] = useState<number>(0);
  const [startPriceOffset, setStartPriceOffset] = useState<number>(0);

  // Synchronize state references for smooth zero-drift mouse wheel zooming
  const candleWidthRef = useRef<number>(145);
  const verticalScaleRef = useRef<number>(0.812);
  const priceCenterOffsetRef = useRef<number>(0);

  // candleWidthRef is now written synchronously at every setCandleWidth call-site
  // (wheel ctrl/combo, auto-fit, handleZoom, handleResetZoom, time-scale-drag).
  // The previous async useEffect bridge caused stale reverts during ctrl-wheel bursts
  // because React 18 ran queued effects with closure-captured old state.

  useEffect(() => {
    verticalScaleRef.current = verticalScale;
  }, [verticalScale]);

  useEffect(() => {
    priceCenterOffsetRef.current = priceCenterOffset;
  }, [priceCenterOffset]);

  // Expose imperative scroll compensation for prepend — called synchronously after setCandles
  // in the same JS task, before React processes batched updates and before browser can paint.
  useEffect(() => {
    if (!prependScrollRef) return;
    prependScrollRef.current = (addedCount: number) => {
      const container = containerRef.current;
      if (!container) return;
      const beforeScrollLeft = container.scrollLeft;
      void container.scrollWidth;
      const cw = candleWidthRef.current;
      const spacing = Math.max(1, cw < 30 ? Math.floor(cw * 0.35) : 12);
      const addedWidth = addedCount * (cw + spacing);
      container.scrollLeft = beforeScrollLeft + addedWidth;
      // S3: sync ref + state + lastSynced — anti-jump needs the state to match
      // the DOM scrollLeft immediately, no throttle.
      setVisibleScrollLeftSync(container.scrollLeft);
      // Suppress LayoutEffect if within tolerance (5px masks fractional rounding, real clamping is >>50px)
      if (Math.abs(container.scrollLeft - (beforeScrollLeft + addedWidth)) <= 5) {
        prependCompensatedRef.current = true;
      }
    };
    return () => { prependScrollRef.current = null; };
  }, [prependScrollRef]);

  // Refs for history-on-scroll and cluster-on-scroll
  const prevCandlesLengthRef = useRef(0);
  const prevFirstTsRef = useRef(0);
  const lastRequestedOldestRef = useRef(0);
  const lastVisibleTimestampsRef = useRef<string>('');
  const visibleTimestampsTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingScrollAnchorRef = useRef<{ ts: number; offset: number } | null>(null);
  const prependCompensatedRef = useRef(false);
  const frozenPriceBoundsRef = useRef<{ maxPriceRaw: number; minPriceRaw: number; priceRange: number; basePriceCenter: number } | null>(null);

  // S2: single rAF planner for the main canvas draw.
  // The draw used to run synchronously inside useLayoutEffect on every React commit
  // (scroll event, WS live tick, any setState) — see CHART_ENGINE.md "перерисовка
  // только при изменении". Now the layout effect just sets the latest draw closure
  // on drawRef.current and asks for one frame; multiple setState within a tick collapse
  // into a single paint.
  const rafIdRef = useRef<number | null>(null);
  const dirtyRef = useRef<boolean>(false);
  const drawRef = useRef<() => void>(() => {});
  const fpsFrameCountRef = useRef<number>(0);
  const fpsLastTimeRef = useRef<number>(performance.now());
  const fpsRef = useRef<number>(0);
  const scheduleDraw = () => {
    dirtyRef.current = true;
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const fn = drawRef.current;
      if (fn) fn();
    });
  };
  useEffect(() => () => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (scrollSyncTimerRef.current != null) {
      clearTimeout(scrollSyncTimerRef.current);
      scrollSyncTimerRef.current = null;
    }
  }, []);

  // Idle detection: reset FPS display to null ("—") if no draw for >1 s.
  // Interval runs only for admin — zero overhead for other roles.
  useEffect(() => {
    if ((userRole ?? "").toLowerCase() !== "admin") return;
    const id = setInterval(() => {
      if (performance.now() - fpsLastTimeRef.current > 1000) {
        setFpsDisplay(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [userRole]);

  // S3: push the throttled scrollLeft into React state. Called from onScroll on
  // half-candle deltas (immediate) and from a debounce when scrolling stops.
  // Effects depending on visibleScrollLeft (history-on-scroll, visible timestamps,
  // visibleCandlesList memo, CVD min/max memo) react on these pushes only.
  const flushScrollState = (force: boolean) => {
    const latest = visibleScrollLeftRef.current;
    if (!force && latest === visibleScrollLeftLastSyncedRef.current) return;
    visibleScrollLeftLastSyncedRef.current = latest;
    setVisibleScrollLeft(latest);
  };
  // S3: helper for imperative scrollLeft writes that MUST keep ref + state +
  // lastSynced in lockstep (zoom anchors, history prepend compensation, initial
  // mount, container-resize reclamp). Bypasses the throttle on purpose.
  const setVisibleScrollLeftSync = (v: number) => {
    visibleScrollLeftRef.current = v;
    visibleScrollLeftLastSyncedRef.current = v;
    if (scrollSyncTimerRef.current != null) {
      clearTimeout(scrollSyncTimerRef.current);
      scrollSyncTimerRef.current = null;
    }
    setVisibleScrollLeft(v);
  };
  const requestScrollStateSync = (latest: number) => {
    // R: pure debounce. The earlier "half-candle immediate flush" branch was
    // pushing ~3 setState/sec during continuous scroll, each costing a ~160 ms
    // monolith re-render (Branch A would require subtree extraction; out of
    // scope). With debounce-only we get zero React commits during active
    // scroll — state catches up 100 ms after the user stops. History-loading
    // and timestamp-tracking effects still see the final position. The
    // near-left-edge case is force-flushed below so onNeedHistory still fires
    // mid-scroll when the user actually needs more data.
    if (latest < 200) {
      // Approaching the historic edge — flush now so the parent can prefetch.
      if (scrollSyncTimerRef.current != null) {
        clearTimeout(scrollSyncTimerRef.current);
        scrollSyncTimerRef.current = null;
      }
      flushScrollState(false);
      return;
    }
    if (scrollSyncTimerRef.current != null) {
      clearTimeout(scrollSyncTimerRef.current);
    }
    scrollSyncTimerRef.current = setTimeout(() => {
      scrollSyncTimerRef.current = null;
      flushScrollState(false);
    }, 100);
  };

  // Adjust scrollLeft after history prepend to prevent viewport jump (sync before paint)
  // Uses timestamp-anchor from the trigger effect to find the candle at the same position in the new array
  useLayoutEffect(() => {
    // If imperative prepend compensation already ran in the same JS task, skip to avoid overwrite
    if (prependCompensatedRef.current) {
      prependCompensatedRef.current = false;
      pendingScrollAnchorRef.current = null;
      return;
    }
    const anchor = pendingScrollAnchorRef.current;
    const prevLen = prevCandlesLengthRef.current;
    const currLen = candles.length;
    const currFirstTs = candles[0]?.timestamp ?? 0;
    const prevFirstTs = prevFirstTsRef.current;
    prevCandlesLengthRef.current = currLen;
    prevFirstTsRef.current = currFirstTs;

    if (anchor && currLen > prevLen && prevLen > 0 && currFirstTs !== prevFirstTs && containerRef.current) {
      pendingScrollAnchorRef.current = null;
      const newIdx = candles.findIndex(c => c.timestamp === anchor.ts);
      if (newIdx >= 0) {
        containerRef.current.scrollLeft = margin.left + newIdx * (candleWidth + candleSpacing) + anchor.offset;
        setVisibleScrollLeftSync(containerRef.current.scrollLeft);
      }
      // If after correction we're at the left edge and history isn't exhausted,
      // force another prepend — no more scroll events will fire.
      if (onNeedHistory && containerRef.current.scrollLeft <= margin.left + candleWidth) {
        const oldest = candles[0]?.timestamp;
        if (oldest) {
          lastRequestedOldestRef.current = 0;
          onNeedHistory(oldest);
        }
      }
    }
  }, [candles.length, candleWidth]);

  // Fire onNeedHistory when scroll approaches the left edge
  useEffect(() => {
    if (!onNeedHistory || candles.length === 0) return;
    // Skip until zoom/scroll init has completed — prevents false anchor on initial mount (visibleScrollLeft=0)
    if (hasInitializedZoomRef.current !== activePair.symbol) return;
    const firstVisibleIdx = Math.floor((visibleScrollLeft - margin.left) / (candleWidth + candleSpacing));
    const oldest = candles[0].timestamp;
    // Only trigger when user has actually scrolled near the left edge (not when visibleScrollLeft=0 on mount)
    if (firstVisibleIdx >= 0 && firstVisibleIdx < 100 && oldest !== lastRequestedOldestRef.current) {
      // Capture scroll anchor BEFORE prepend (only if no anchor is pending, to prevent
      // overwrite by subsequent scroll events while a prepend is in flight).
      if (!pendingScrollAnchorRef.current) {
        const idx = Math.max(0, Math.min(firstVisibleIdx, candles.length - 1));
        pendingScrollAnchorRef.current = {
          ts: candles[idx]!.timestamp,
          offset: (visibleScrollLeft - margin.left) - idx * (candleWidth + candleSpacing),
        };
      }
      lastRequestedOldestRef.current = oldest;
      onNeedHistory(oldest);
    }
  }, [visibleScrollLeft, candleWidth, onNeedHistory, candles]);

  // Fire onVisibleTimestampsChange (debounced) when visible candles change
  useEffect(() => {
    if (!onVisibleTimestampsChange || candles.length === 0) return;
    const firstIdx = Math.max(0, Math.floor((visibleScrollLeft - margin.left) / (candleWidth + candleSpacing)));
    const visibleCount = Math.ceil((visibleClientWidth || 800) / (candleWidth + candleSpacing)) + 2;
    const timestamps: number[] = [];
    for (let i = firstIdx; i < Math.min(firstIdx + visibleCount, candles.length); i++) {
      timestamps.push(candles[i].timestamp);
    }
    const key = timestamps.join(',');
    if (key === lastVisibleTimestampsRef.current) return;
    lastVisibleTimestampsRef.current = key;

    if (visibleTimestampsTimerRef.current) clearTimeout(visibleTimestampsTimerRef.current);
    visibleTimestampsTimerRef.current = setTimeout(() => {
      onVisibleTimestampsChange(timestamps);
    }, 300);
  }, [visibleScrollLeft, visibleClientWidth, candleWidth, onVisibleTimestampsChange, candles]);

  // Cleanup visible timestamps timer on unmount
  useEffect(() => {
    return () => {
      if (visibleTimestampsTimerRef.current) clearTimeout(visibleTimestampsTimerRef.current);
    };
  }, []);

  // States and refs for interactive vertical scroll/zoom dragging on the price scale
  const [isDraggingPriceScale, setIsDraggingPriceScale] = useState(false);
  const startPriceScaleYRef = useRef<number>(0);
  const startVerticalScaleRef = useRef<number>(1.0);

  const [deltaScale, setDeltaScale] = useState<number>(1.0);
  const [cvdScale, setCvdScale] = useState<number>(1.0);

  const [isDraggingDeltaScale, setIsDraggingDeltaScale] = useState(false);
  const startDeltaScaleYRef = useRef<number>(0);
  const startDeltaScaleRef = useRef<number>(1.0);

  const [isDraggingCvdScale, setIsDraggingCvdScale] = useState(false);
  const startCvdScaleYRef = useRef<number>(0);
  const startCvdScaleRef = useRef<number>(1.0);

  const [rsiScale, setRsiScale] = useState<number>(1.0);
  const [isDraggingRsiScale, setIsDraggingRsiScale] = useState(false);
  const startRsiScaleYRef = useRef<number>(0);
  const startRsiScaleRef = useRef<number>(1.0);

  const [bidAskRatioScale, setBidAskRatioScale] = useState<number>(1.0);
  const [isDraggingBidAskRatioScale, setIsDraggingBidAskRatioScale] = useState(false);
  const startBidAskRatioScaleYRef = useRef<number>(0);
  const startBidAskRatioScaleRef = useRef<number>(1.0);

  const [longShortRatioScale, setLongShortRatioScale] = useState<number>(1.0);
  const [isDraggingLongShortRatioScale, setIsDraggingLongShortRatioScale] = useState(false);
  const startLongShortRatioScaleYRef = useRef<number>(0);
  const startLongShortRatioScaleRef = useRef<number>(1.0);

  const [buySellZoneScale, setBuySellZoneScale] = useState<number>(1.0);
  const [isDraggingBuySellZoneScale, setIsDraggingBuySellZoneScale] = useState(false);
  const startBuySellZoneScaleYRef = useRef<number>(0);
  const startBuySellZoneScaleRef = useRef<number>(1.0);

  // Per-panel vertical body-pan offsets (px). A drag that starts on a footer panel
  // body moves that panel's line/bars vertically within the panel instead of
  // panning the main price chart. Horizontal (time) scroll is unaffected.
  const [deltaOffset, setDeltaOffset] = useState(0);
  const [cvdOffset, setCvdOffset] = useState(0);
  const [rsiOffset, setRsiOffset] = useState(0);
  const [bidAskRatioOffset, setBidAskRatioOffset] = useState(0);
  const [longShortRatioOffset, setLongShortRatioOffset] = useState(0);
  const [buySellZoneOffset, setBuySellZoneOffset] = useState(0);
  // Which panel (if any) is being body-dragged, and its offset at mousedown.
  const activePanelDragIdRef = useRef<string | null>(null);
  const panelDragStartOffsetRef = useRef<number>(0);

  const getPanelOffset = (id: string): number =>
    id === "delta" ? deltaOffset : id === "cvd" ? cvdOffset : id === "rsi" ? rsiOffset : id === "bidAskRatio" ? bidAskRatioOffset : id === "longShortRatio" ? longShortRatioOffset : id === "buySellZone" ? buySellZoneOffset : 0;
  const setPanelOffset = (id: string, v: number) => {
    if (id === "delta") setDeltaOffset(v);
    else if (id === "cvd") setCvdOffset(v);
    else if (id === "rsi") setRsiOffset(v);
    else if (id === "bidAskRatio") setBidAskRatioOffset(v);
    else if (id === "longShortRatio") setLongShortRatioOffset(v);
    else if (id === "buySellZone") setBuySellZoneOffset(v);
  };
  const resetPanelScale = (id: string) => {
    if (id === "delta") setDeltaScale(1.0);
    else if (id === "cvd") setCvdScale(1.0);
    else if (id === "rsi") setRsiScale(1.0);
    else if (id === "bidAskRatio") setBidAskRatioScale(1.0);
    else if (id === "longShortRatio") setLongShortRatioScale(1.0);
    else if (id === "buySellZone") setBuySellZoneScale(1.0);
  };

  // States and refs for interactive horizontal timescale zoom/scale dragging
  const [isDraggingTimeScale, setIsDraggingTimeScale] = useState(false);
  const startTimeScaleXRef = useRef<number>(0);
  const startCandleWidthRef = useRef<number>(145);
  const zoomAnchorIndexRef = useRef<number | null>(null);
  const zoomAnchorClickXRef = useRef<number>(0);

  // Touch gesture refs (mobile pan / pinch-zoom / timescale drag).
  // Mirror reference impl in PROCLUSTER3 (handleTouchStart/Move/End). Mouse path
  // is untouched. Drawing tools intentionally not wired to touch in v1.
  // isDraggingPriceScaleRef is SEPARATE from the isDraggingPriceScale state
  // (820) because the state setter triggers a window-level mousemove listener
  // (2855) that's wrong for touch — touch tracks its own deltaY via the ref.
  // Same separation for Delta/CVD scales — touch tracks via refs, mouse via state.
  const isDraggingPriceScaleRef = useRef<boolean>(false);
  const isDraggingDeltaScaleRefTouch = useRef<boolean>(false);
  const isDraggingCvdScaleRefTouch = useRef<boolean>(false);
  const isDraggingRsiScaleRefTouch = useRef<boolean>(false);
  const isDraggingBidAskRatioScaleRefTouch = useRef<boolean>(false);
  const isDraggingLongShortRatioScaleRefTouch = useRef<boolean>(false);
  const isDraggingBuySellZoneScaleRefTouch = useRef<boolean>(false);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    priceCenterOffset: number;
  } | null>(null);
  const touchZoomRef = useRef<{
    initialDistance: number;
    initialCandleWidth: number;
    initialVerticalScale: number;
    initialPriceCenterOffset: number;
    initialScrollLeft: number;
    touchCenterX: number;
    touchCenterY: number;
  } | null>(null);

  // Dynamically measure container dimensions with ResizeObserver so CVD/delta are pinned perfectly to the bottom
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const height = containerRef.current?.clientHeight || entry.contentRect.height;
        if (height && height > 100) {
          setContainerHeight(height);
        }
        const width = containerRef.current?.clientWidth || entry.contentRect.width;
        if (width && width > 100) {
          setVisibleClientWidth(width);
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    const initialHeight = containerRef.current.clientHeight;
    if (initialHeight && initialHeight > 100) {
      setContainerHeight(initialHeight);
    }
    const initialWidth = containerRef.current.clientWidth;
    if (initialWidth && initialWidth > 100) {
      setVisibleClientWidth(initialWidth);
    }

    return () => resizeObserver.disconnect();
  }, [candles.length]);

  const candlesToScale = useMemo(() => {
    // Use only the last VISIBLE_CANDLES candles so vertical scaling centers on visible data
    const targetCount = Math.min(VISIBLE_CANDLES, candles.length);
    return candles.length > 0 ? candles.slice(-targetCount) : candles;
  }, [candles]);

  const priceBounds = useMemo(() => {
    // During prepend (anchor != null), return FROZEN values — priceRange/basePriceCenter don't change
    // until the prepend is applied and anchor is cleared in useLayoutEffect.
    if (pendingScrollAnchorRef.current && frozenPriceBoundsRef.current) {
      return frozenPriceBoundsRef.current;
    }

    if (candlesToScale.length === 0) {
      const base = { maxPriceRaw: 100, minPriceRaw: 0, priceRange: 100, basePriceCenter: 50 };
      frozenPriceBoundsRef.current = base;
      return base;
    }

    let maxPriceRaw = candlesToScale[0].high;
    let minPriceRaw = candlesToScale[0].low;
    for (let i = 0; i < candlesToScale.length; i++) {
      const c = candlesToScale[i];
      if (c.high > maxPriceRaw) maxPriceRaw = c.high;
      if (c.low < minPriceRaw) minPriceRaw = c.low;
    }
    const priceRange = maxPriceRaw - minPriceRaw || 1;
    const basePriceCenter = (maxPriceRaw + minPriceRaw) / 2;
    const result = { maxPriceRaw, minPriceRaw, priceRange, basePriceCenter };
    frozenPriceBoundsRef.current = result;
    return result;
  }, [candlesToScale]);

  const { maxPriceRaw, minPriceRaw, priceRange, basePriceCenter } = priceBounds;

  // latest-ref: keeps resetZoom stable ([] deps) while reading fresh candles/prices
  const resetZoomDataRef = useRef({ candles, visibleClientWidth, priceRange, basePriceCenter });
  resetZoomDataRef.current = { candles, visibleClientWidth, priceRange, basePriceCenter };

  // We apply the vertical scale to the price range projection to stretch/compress candles visually!
  // verticalScale > 1.0 means we stretch vertically (narrower visible price range = taller candles)
  // verticalScale < 1.0 means we compress vertically (wider visible price range = flatter candles)
  const zoomedPriceRange = useMemo(() => priceRange / Math.max(0.1, verticalScale), [priceRange, verticalScale]);
  
  const priceCenter = useMemo(() => basePriceCenter + priceCenterOffset, [basePriceCenter, priceCenterOffset]);
  
  const maxPrice = useMemo(() => priceCenter + zoomedPriceRange * 0.58, [priceCenter, zoomedPriceRange]);
  const minPrice = useMemo(() => priceCenter - zoomedPriceRange * 0.58, [priceCenter, zoomedPriceRange]);

  const priceToY = (price: number) => {
    const range = maxPrice - minPrice || 1;
    return margin.top + chartHeight * (1 - (price - minPrice) / range);
  };

  const yToPrice = (y: number) => {
    const range = maxPrice - minPrice || 1;
    return minPrice + (1 - (y - margin.top) / Math.max(1, chartHeight)) * range;
  };

  // Standard trading wheel zoom engine (Standard wheel = zoom both directions at cursor; Ctrl+wheel = Horizontal zoom; Shift+wheel = Vertical zoom)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const delta = e.deltaY;
      const direction = Math.sign(delta);
      if (direction === 0) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      const curCandleWidth = candleWidthRef.current;
      const curVerticalScale = verticalScaleRef.current;
      const curPriceCenterOffset = priceCenterOffsetRef.current;

      const rect = container.getBoundingClientRect();

      // Dynamic local helper to extract unclamped price from a physical Y coordinate given vertical scale and offset
      const extractPriceFromY = (yCoord: number, scaleVal: number, offsetVal: number) => {
        const zoomedRange = priceRange / Math.max(0.1, scaleVal);
        const centerPrice = basePriceCenter + offsetVal;
        const maxP = centerPrice + zoomedRange * 0.58;
        const minP = centerPrice - zoomedRange * 0.58;
        const range = maxP - minP || 1;
        return minP + (1 - (yCoord - margin.top) / Math.max(1, chartHeight)) * range;
      };

      if (isShift) {
        // Shift + Wheel -> zoom/stretch vertically centered on mouse position!
        const relativeY = e.clientY - rect.top;
        if (relativeY >= margin.top && relativeY <= margin.top + chartHeight) {
          const mousePrice = extractPriceFromY(relativeY, curVerticalScale, curPriceCenterOffset);
          const multiplier = direction < 0 ? 1.08 : 0.92;
          const nextVerticalScale = Math.min(2000.0, Math.max(0.1, curVerticalScale * multiplier));
          const actualMultiplier = nextVerticalScale / curVerticalScale;

          if (actualMultiplier !== 1) {
            const currentPriceCenter = basePriceCenter + curPriceCenterOffset;
            const newPriceCenter = mousePrice - (mousePrice - currentPriceCenter) / actualMultiplier;
            const nextPriceCenterOffset = newPriceCenter - basePriceCenter;

            setVerticalScale(nextVerticalScale);
            setPriceCenterOffset(nextPriceCenterOffset);

            // Update refs synchronously for any consecutive ticks in the same frame
            verticalScaleRef.current = nextVerticalScale;
            priceCenterOffsetRef.current = nextPriceCenterOffset;
          }
        }
      } else if (isCtrl) {
        // Ctrl + Wheel -> zoom horizontally centered on mouse position!
        const multiplier = direction < 0 ? 1.08 : 0.92;
        const nextWidth = curCandleWidth * multiplier;
        const minW = (candleType === "japanese" || candleType === "auto" || candleType === "bars") ? 1 : 8;
        const nextWidthClamped = Math.min(100, Math.max(minW, nextWidth));

        if (nextWidthClamped !== curCandleWidth) {
          const mouseRelativeX = e.clientX - rect.left;
          const currentScrollLeft = container.scrollLeft;
          const chartCursorX = currentScrollLeft + mouseRelativeX;

          const activeChartX = chartCursorX - margin.left;

          const prevSpacing = Math.max(1, curCandleWidth < 30 ? Math.floor(curCandleWidth * 0.35) : 12);
          const nextSpacing = Math.max(1, nextWidthClamped < 30 ? Math.floor(nextWidthClamped * 0.35) : 12);

          const ratio = (nextWidthClamped + nextSpacing) / (curCandleWidth + prevSpacing);
          const newChartCursorX = margin.left + activeChartX * ratio;
          const nextScrollLeft = Math.max(0, newChartCursorX - mouseRelativeX);

          // Synchronously resize the HTML scroll spacer before scrolling to prevent clamping/drift
          const currentScrollRightPadding = Math.round(Number(container.clientWidth || 800) * 0.85);
          const nextScrollWidth = candles.length * (nextWidthClamped + nextSpacing) + margin.left + margin.right + currentScrollRightPadding;
          const spacer = container.querySelector("#procluster-chart-spacer") as HTMLElement;
          if (spacer) {
            spacer.style.width = `${nextScrollWidth}px`;
            void spacer.offsetWidth;
          }

          // Upper-clamp against the NEW spacer width so DOM can't silently clamp
          // below what we store in ref/state — that desync caused jerk-and-return
          // and full drift on strong zoom-out.
          const containerClientWidth = container.clientWidth || 800;
          const maxScroll = Math.max(0, nextScrollWidth - containerClientWidth);
          const clampedScrollLeft = Math.min(maxScroll, nextScrollLeft);

          // Single source of truth: write ref FIRST, synchronously, then queue state.
          candleWidthRef.current = nextWidthClamped;
          setCandleWidth(nextWidthClamped);
          container.scrollLeft = clampedScrollLeft;
          setVisibleScrollLeftSync(clampedScrollLeft);

          // Fix #3: paint in the same wheel tick so the first visible frame is
          // consistent (new candleWidth from ref shadow + new scrollLeft).
          // scheduleDraw at the end of handleWheel still fires post-commit
          // (useLayoutEffect rebinds drawRef) — that second frame is identical
          // and confirms state catch-up. Only ctrl branch; combo/shift untouched.
          if (drawRef.current) drawRef.current();
        }
      } else {
        // Standard Wheel -> zoom BOTH horizontally and vertically centered on mouse position!
        
        // 1. Horizontal zoom
        const hMultiplier = direction < 0 ? 1.08 : 0.92;
        const nextWidth = curCandleWidth * hMultiplier;
        const minW = (candleType === "japanese" || candleType === "auto" || candleType === "bars") ? 1 : 8;
        const nextWidthClamped = Math.min(100, Math.max(minW, nextWidth));

        let updatedScaleCandleWidth = curCandleWidth;
        if (nextWidthClamped !== curCandleWidth) {
          const mouseRelativeX = e.clientX - rect.left;
          const currentScrollLeft = container.scrollLeft;
          const chartCursorX = currentScrollLeft + mouseRelativeX;
          
          const activeChartX = chartCursorX - margin.left;
          
          const prevSpacing = Math.max(1, curCandleWidth < 30 ? Math.floor(curCandleWidth * 0.35) : 12);
          const nextSpacing = Math.max(1, nextWidthClamped < 30 ? Math.floor(nextWidthClamped * 0.35) : 12);
          
          const ratio = (nextWidthClamped + nextSpacing) / (curCandleWidth + prevSpacing);
          const newChartCursorX = margin.left + activeChartX * ratio;
          const nextScrollLeft = Math.max(0, newChartCursorX - mouseRelativeX);

          // Synchronously resize the HTML scroll spacer before scrolling to prevent clamping/drift
          const currentScrollRightPadding = Math.round(Number(container.clientWidth || 800) * 0.85);
          const nextScrollWidth = candles.length * (nextWidthClamped + nextSpacing) + margin.left + margin.right + currentScrollRightPadding;
          const spacer = container.querySelector("#procluster-chart-spacer") as HTMLElement;
          if (spacer) {
            spacer.style.width = `${nextScrollWidth}px`;
            void spacer.offsetWidth;
          }

          // Upper-clamp against the NEW spacer width (see ctrl branch above).
          const containerClientWidth = container.clientWidth || 800;
          const maxScroll = Math.max(0, nextScrollWidth - containerClientWidth);
          const clampedScrollLeft = Math.min(maxScroll, nextScrollLeft);

          // Single source of truth: ref synchronously FIRST, then state.
          candleWidthRef.current = nextWidthClamped;
          setCandleWidth(nextWidthClamped);
          container.scrollLeft = clampedScrollLeft;
          setVisibleScrollLeftSync(clampedScrollLeft);
          updatedScaleCandleWidth = nextWidthClamped;
        }

        // 2. Vertical zoom
        const relativeY = e.clientY - rect.top;
        if (relativeY >= margin.top && relativeY <= margin.top + chartHeight) {
          const mousePrice = extractPriceFromY(relativeY, curVerticalScale, curPriceCenterOffset);
          const vMultiplier = direction < 0 ? 1.08 : 0.92; // Use matching multiplier style for professional visual experience
          const nextVerticalScale = Math.min(2000.0, Math.max(0.1, curVerticalScale * vMultiplier));
          const actualMultiplier = nextVerticalScale / curVerticalScale;

          if (actualMultiplier !== 1) {
            const currentPriceCenter = basePriceCenter + curPriceCenterOffset;
            const newPriceCenter = mousePrice - (mousePrice - currentPriceCenter) / actualMultiplier;
            const nextPriceCenterOffset = newPriceCenter - basePriceCenter;

            setVerticalScale(nextVerticalScale);
            setPriceCenterOffset(nextPriceCenterOffset);

            // Update refs synchronously for any consecutive ticks in the same frame
            verticalScaleRef.current = nextVerticalScale;
            priceCenterOffsetRef.current = nextPriceCenterOffset;
          }
        }
      }

      // Paint canvas once with NEW candleWidth + NEW scrollLeft in the same frame
      // as this wheel event. Without this, paint depends on React's useLayoutEffect
      // or the async native scroll event — either can land after the browser already
      // repainted the old canvas at the new container scroll position.
      scheduleDraw();
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [
    candles.length, 
    candleType, 
    basePriceCenter, 
    priceRange, 
    chartHeight
  ]);

  // Auto-scroll to show the latest candles with a comfortable padding from the right price scale on mount or symbol change
  useEffect(() => {
    const container = containerRef.current;
    if (container && candles.length > 0) {
      const clientWidth = container.clientWidth;
      if (clientWidth <= 100) return;

      // Detect combo change (symbol/timeframe/marketType/clusterStep) vs same-combo length growth
      const isComboChange = hasInitializedZoomRef.current !== activePair.symbol;

      // Ensure default zoom configuration on symbol change: VISIBLE_CANDLES candles filling ~70% vertical height
      let currentWidth = candleWidth;
      if (isComboChange) {
        const visibleWidth = clientWidth - margin.left - margin.right;
        const spacePerCandle = visibleWidth / VISIBLE_CANDLES;
        
        let bestWidth = 10;
        for (let w = 2; w < 120; w++) {
          const spacing = Math.max(1, w < 30 ? Math.floor(w * 0.35) : 12);
          if (w + spacing <= spacePerCandle) {
            bestWidth = w;
          } else {
            break;
          }
        }
        currentWidth = Math.max(2, bestWidth);
        candleWidthRef.current = currentWidth;
        setCandleWidth(currentWidth);

        // Centering on last VISIBLE_CANDLES candles; since candlesToScale already uses the
        // same set, basePriceCenter and priceRange already reflect visible data, so
        // verticalScale = 0.812 and priceCenterOffset = 0 produce the correct centered view.
        const visibleCandles = candles.slice(-VISIBLE_CANDLES);
        let maxV = candles[0]?.high || 100;
        let minV = candles[0]?.low || 0;
        if (visibleCandles.length > 0) {
          maxV = visibleCandles[0].high;
          minV = visibleCandles[0].low;
          for (let i = 0; i < visibleCandles.length; i++) {
            const c = visibleCandles[i];
            if (c.high > maxV) maxV = c.high;
            if (c.low < minV) minV = c.low;
          }
        }
        const rangeV = maxV - minV || 1;
        const centerV = (maxV + minV) / 2;
        const targetVerticalScale = (priceRange * 0.812) / rangeV;

        setVerticalScale(Math.min(2000.0, Math.max(0.1, targetVerticalScale)));
        setPriceCenterOffset(centerV - basePriceCenter);

        hasInitializedZoomRef.current = activePair.symbol;
      }

      const spacingVal = Math.max(1, currentWidth < 30 ? Math.floor(currentWidth * 0.35) : 12);
      const candlesTotalWidth = candles.length * (currentWidth + spacingVal);
      const lastCandleRight = margin.left + candlesTotalWidth;
      
      // Position the last candle with a neat 120px margin from the fixed price scale
      const targetScrollLeft = lastCandleRight - (clientWidth - margin.right - 120);
      
      // Calculate max scroll bounds using the extended scrollWidth padding
      const rightPadding = Math.round(clientWidth * 0.85);
      const computedScrollWidth = candlesTotalWidth + margin.left + margin.right + rightPadding;
      const maxScroll = computedScrollWidth - clientWidth;
      
      // Follow-mode: scroll to right edge only on combo change (init) or if user is already near the right edge
      const isNearRightEdge = container.scrollLeft >= maxScroll - 50;
      if (isComboChange || isNearRightEdge) {
        const finalScrollLeft = Math.max(0, Math.min(maxScroll, targetScrollLeft));
        container.scrollLeft = finalScrollLeft;
        setVisibleScrollLeftSync(finalScrollLeft);
      }
      setVisibleClientWidth(prev => prev === clientWidth ? prev : clientWidth);
    }
  }, [activePair.symbol, visibleClientWidth, candles.length, timeframe, marketType, clusterStep]);

  // Adjust canvas zoom
  const handleZoom = useCallback((factor: number) => {
    const prev = candleWidthRef.current;
    const minW = (candleType === "japanese" || candleType === "auto" || candleType === "bars") ? 1 : 8;
    const next = Math.min(100, Math.max(minW, prev + factor));
    candleWidthRef.current = next;
    setCandleWidth(next);
  }, [candleType]);

  const handleVerticalZoom = useCallback((factor: number) => {
    setVerticalScale(prev => {
      const multiplier = factor > 0 ? 1.25 : 0.8;
      const next = prev * multiplier;
      return Math.min(2000.0, Math.max(0.1, next));
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    const { candles, visibleClientWidth, priceRange, basePriceCenter } = resetZoomDataRef.current;
    if (visibleClientWidth > 100) {
      const visibleWidth = visibleClientWidth - margin.left - margin.right;
      const spacePerCandle = visibleWidth / 40;
      let bestWidth = 10;
      for (let w = 2; w < 120; w++) {
        const spacing = Math.max(1, w < 30 ? Math.floor(w * 0.35) : 12);
        if (w + spacing <= spacePerCandle) {
          bestWidth = w;
        } else {
          break;
        }
      }
      const W = Math.max(2, bestWidth);
      candleWidthRef.current = W;
      setCandleWidth(W);
    } else {
      candleWidthRef.current = 10;
      setCandleWidth(10);
    }

    // Centering on last 40 candles and scaling so they take up 70% of vertical height
    const last40 = candles.slice(-40);
    let maxL40 = candles[0]?.high || 100;
    let minL40 = candles[0]?.low || 0;
    if (last40.length > 0) {
      maxL40 = last40[0].high;
      minL40 = last40[0].low;
      for (let i = 0; i < last40.length; i++) {
        const c = last40[i];
        if (c.high > maxL40) maxL40 = c.high;
        if (c.low < minL40) minL40 = c.low;
      }
    }
    const rangeL40 = maxL40 - minL40 || 1;
    const centerL40 = (maxL40 + minL40) / 2;
    const targetVerticalScale = (priceRange * 0.812) / rangeL40;

    setVerticalScale(Math.min(2000.0, Math.max(0.1, targetVerticalScale)));
    setPriceCenterOffset(centerL40 - basePriceCenter);
  }, []);

  const onTimezoneChange = useCallback((tz: string) => {
    setSelectedTimezone(tz);
  }, []);

  const onToggleChartSettings = useCallback((rect?: DOMRect) => {
    if (rect) {
      setSettingsBtnRect(rect);
      settingsBtnRectRef.current = rect;
    }
    setShowChartSettings(prev => !prev);
  }, []);

  // Close the settings dropdown on outside click. A click on the settings button itself
  // (detected via its cached rect) is ignored here so the button's own onClick toggles it
  // instead of this handler closing then the button re-opening.
  useEffect(() => {
    if (!showChartSettings) return;
    function handleDown(e: MouseEvent) {
      const target = e.target as Node;
      if (settingsDropdownRef.current && settingsDropdownRef.current.contains(target)) return;
      const r = settingsBtnRectRef.current;
      if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
      setShowChartSettings(false);
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [showChartSettings]);

  // R: visibleCandlesList useMemo deleted. It only fed visibleMaxCellVol /
  // visibleMaxSingleVol below, both of which are consumed only inside drawRef.
  // Those two are now computed inline in drawRef.current from startIdx/endIdx,
  // so this whole chain no longer participates in React render. Removing
  // visibleScrollLeft from React-tracked state for these computations cuts
  // ~half of the ~160 ms commit on every throttled scroll-state push.



  // Compute scrollable content width - add a generous scroll zone on the right (85% of screen width) so users can freely drag the last candles away from the price scale
  const scrollRightPadding = Math.round(Number(visibleClientWidth || 800) * 0.85);
  const scrollWidth = candles.length * (candleWidth + candleSpacing) + margin.left + margin.right + scrollRightPadding;

  // Zoom threshold: Detailed cluster footprint mode vs default Candlestick view
  const isDetailedModeCalculated = candleWidth >= 15;
  const isDetailedMode = (candleType === "japanese" || candleType === "bars")
    ? false
    : (candleType === "footprint" || candleType === "clusters"
        ? true
        : isDetailedModeCalculated);

  const effectiveCandleType = candleType === "auto"
    ? (isDetailedMode ? "footprint" : "japanese")
    : candleType;

  const finalShowAnomalies = showAnomalies;

  // Panning drag-to-scroll handlers (supports 2D movement)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("select")) return; // skip for controls
    // S3: ref-current scroll so drawing-tool clicks land on the visible canvas
    // even when state is throttled.
    const visibleScrollLeft = visibleScrollLeftRef.current;

    // If drawing tool is active, handle drawing instead of panning!
    if (activeDrawingTool) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Skip margin zones if needed, allow drawing in main chart panel
        if (clickY >= margin.top && clickY <= totalSvgHeight - margin.bottom && clickX >= margin.left) {
          const scrollRelativeX = clickX + visibleScrollLeft;
          const price = yToPrice(clickY);

          if (drawingInProgress && drawingInProgress.type === "channel" && drawingInProgress.stage === 2) {
            // COMPLETE THE CHANNEL DRAWING!
            const cursorTs = xToTs(scrollRelativeX);
            const sTs = drawingInProgress.startTs;
            const eTs = drawingInProgress.endTs;
            const baselinePriceAtX = drawingInProgress.startPrice + (drawingInProgress.endPrice - drawingInProgress.startPrice) *
              (eTs === sTs ? 0 : (cursorTs - sTs) / (eTs - sTs));
            const finalOffsetPrice = price - baselinePriceAtX;
            
            const finalDrawing = {
              ...drawingInProgress,
              offsetPrice: finalOffsetPrice,
              stage: undefined
            };
            
            setDrawings(prev => [...prev, finalDrawing]);
            setDrawingInProgress(null);
            setActiveDrawingTool(null);
            return;
          }

          if (activeDrawingTool === "horizontal") {
            // Horizontal level is placed instantly on one click!
            const tsAtClick = xToTs(scrollRelativeX);
            const newDrawing = {
              id: Date.now(),
              type: "horizontal",
              startTs: tsAtClick,
              startPrice: price,
              endTs: tsAtClick,
              endPrice: price,
              text: "",
            };
            setDrawings(prev => [...prev, newDrawing]);
            setActiveDrawingTool(null); // Reset drawing tool after placement
          } else {
            // Start a dragging drawing
            const isChannel = activeDrawingTool === "channel";
            // Phase 14 Step 1: bake inherited settings into the in-progress drawing
            let inherited: Record<string, unknown> = {};
            if (activeDrawingTool === "volume") {
              inherited = { volColor: volProfileGlobalSettings.volColor, pocColor: volProfileGlobalSettings.pocColor, opacity: volProfileGlobalSettings.opacity, extendPoc: volProfileGlobalSettings.extendPoc };
            } else if (activeDrawingTool === "long" || activeDrawingTool === "short") {
              inherited = { deposit: positionGlobalSettings.deposit, risk: positionGlobalSettings.risk, riskType: positionGlobalSettings.riskType, colorTarget: positionGlobalSettings.colorTarget, colorStop: positionGlobalSettings.colorStop, opacity: positionGlobalSettings.opacity, fontSize: positionGlobalSettings.fontSize, makerFee: positionGlobalSettings.makerFee, takerFee: positionGlobalSettings.takerFee, entryFeeType: positionGlobalSettings.entryFeeType, exitFeeType: positionGlobalSettings.exitFeeType };
            }
            const tsAtClick = xToTs(scrollRelativeX);
            setDrawingInProgress({
              id: Date.now(),
              type: activeDrawingTool,
              startTs: tsAtClick,
              startPrice: price,
              endTs: tsAtClick,
              endPrice: price,
              stage: isChannel ? 1 : undefined,
              offsetPrice: isChannel ? 0 : undefined,
              text: "",
              ...inherited,
            });
          }
          return; // Skip normal panning
        }
      }
    }

    // If not drawing, check if click hit a drawing or handle to drag/select it
    if (!activeDrawingTool && areDrawingsVisible && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      if (clickY >= margin.top && clickY <= totalSvgHeight - margin.bottom && clickX >= margin.left) {
        let foundDrawingId: number | null = null;
        let foundHandleIdx: number | null = null;

        // 1. Check selected drawing handles first
        if (selectedDrawingId !== null) {
          const d = drawings.find(item => item.id === selectedDrawingId);
          if (d) {
            const y1 = priceToY(d.startPrice);
            const y2 = priceToY(d.endPrice);
            const x1 = (d.startTs != null ? tsToX(d.startTs) : indexToX(d.startIdx)) - visibleScrollLeft;
            const x2 = (d.endTs != null ? tsToX(d.endTs) : indexToX(d.endIdx)) - visibleScrollLeft;
            
            let handles = [
              { x: x1, y: y1, idx: 1 },
              { x: x2, y: y2, idx: 2 },
              { x: x2, y: y1, idx: 3 },
              { x: x1, y: y2, idx: 4 }
            ];

            if (d.type === "channel") {
              const offset = d.offsetPrice !== undefined ? d.offsetPrice : ((activePair.priceStep || 0.1) * 20);
              const y1_offset = priceToY(d.startPrice + offset);
              const y2_offset = priceToY(d.endPrice + offset);
              handles = [
                { x: x1, y: y1, idx: 1 },
                { x: x2, y: y2, idx: 2 },
                { x: x2, y: y2_offset, idx: 3 },
                { x: x1, y: y1_offset, idx: 4 }
              ];
            } else if (d.type === "long" || d.type === "short") {
              const yEntry = priceToY(d.startPrice);
              const yTarget = priceToY(d.endPrice);
              const yStop = priceToY(d.stopPrice !== undefined ? d.stopPrice : (d.type === "long" ? (d.startPrice - (d.endPrice - d.startPrice)) : (d.startPrice + (d.startPrice - d.endPrice))));
              handles = [
                { x: x1, y: yEntry, idx: 1 },
                { x: x2, y: yEntry, idx: 2 },
                { x: (x1 + x2) / 2, y: yTarget, idx: 3 },
                { x: (x1 + x2) / 2, y: yStop, idx: 4 }
              ];
            }
            
            const clickedHandle = handles.find(h => {
              const dx = clickX - h.x;
              const dy = clickY - h.y;
              return Math.sqrt(dx * dx + dy * dy) <= 10;
            });
            
            if (clickedHandle) {
              foundDrawingId = d.id;
              foundHandleIdx = clickedHandle.idx;
            }
          }
        }

        // 2. If no handle, check if we clicked inside any drawing
        if (foundDrawingId === null) {
          for (let i = drawings.length - 1; i >= 0; i--) {
            const d = drawings[i];
            const y1 = priceToY(d.startPrice);
            const y2 = priceToY(d.endPrice);
            const x1 = (d.startTs != null ? tsToX(d.startTs) : indexToX(d.startIdx)) - visibleScrollLeft;
            const x2 = (d.endTs != null ? tsToX(d.endTs) : indexToX(d.endIdx)) - visibleScrollLeft;
            
            if (d.type === "volume" || d.type === "rect" || d.type === "ruler") {
              const minX = Math.min(x1, x2);
              const maxX = Math.max(x1, x2);
              const minY = Math.min(y1, y2);
              const maxY = Math.max(y1, y2);
              if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
                foundDrawingId = d.id;
                break;
              }
            } else if (d.type === "long" || d.type === "short") {
              const minX = Math.min(x1, x2);
              const maxX = Math.max(x1, x2);
              const yStop = priceToY(d.stopPrice !== undefined ? d.stopPrice : (d.type === "long" ? (d.startPrice - (d.endPrice - d.startPrice)) : (d.startPrice + (d.startPrice - d.endPrice))));
              const minY = Math.min(y1, y2, yStop);
              const maxY = Math.max(y1, y2, yStop);
              if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
                foundDrawingId = d.id;
                break;
              }
            } else if (d.type === "trend" || d.type === "arrow" || d.type === "channel") {
              const dx1 = clickX - x1;
              const dy1 = clickY - y1;
              const dStart = Math.sqrt(dx1 * dx1 + dy1 * dy1);
              
              const dx2 = clickX - x2;
              const dy2 = clickY - y2;
              const dEnd = Math.sqrt(dx2 * dx2 + dy2 * dy2);
              
              const offsetVal = d.offsetPrice !== undefined ? d.offsetPrice : ((activePair.priceStep || 0.1) * 20);
              const y1_off = priceToY(d.startPrice + offsetVal);
              const y2_off = priceToY(d.endPrice + offsetVal);
              
              const dx1_off = clickX - x1;
              const dy1_off = clickY - y1_off;
              const dStart_off = Math.sqrt(dx1_off * dx1_off + dy1_off * dy1_off);
              
              const dx2_off = clickX - x2;
              const dy2_off = clickY - y2_off;
              const dEnd_off = Math.sqrt(dx2_off * dx2_off + dy2_off * dy2_off);

              if (dStart <= 10 || dEnd <= 10 || dStart_off <= 10 || dEnd_off <= 10) {
                foundDrawingId = d.id;
                break;
              }

              const checkLine = (px1: number, py1: number, px2: number, py2: number) => {
                const lineLen = Math.sqrt((px2 - px1) * (px2 - px1) + (py2 - py1) * (py2 - py1));
                if (lineLen > 0) {
                  const u = ((clickX - px1) * (px2 - px1) + (clickY - py1) * (py2 - py1)) / (lineLen * lineLen);
                  if (u >= 0 && u <= 1) {
                    const projX = px1 + u * (px2 - px1);
                    const projY = py1 + u * (py2 - py1);
                    const realDist = Math.sqrt((clickX - projX) * (clickX - projX) + (clickY - projY) * (clickY - projY));
                    if (realDist <= 8) return true;
                  }
                }
                return false;
              };

              if (checkLine(x1, y1, x2, y2) || checkLine(x1, y1_off, x2, y2_off)) {
                foundDrawingId = d.id;
                break;
              }
            } else if (d.type === "horizontal") {
              if (Math.abs(clickY - y1) <= 8) {
                foundDrawingId = d.id;
                break;
              }
            } else if (d.type === "text" || d.type === "fibonacci") {
              const minX = Math.min(x1, x2) - 10;
              const maxX = Math.max(x1, x2) + 10;
              const minY = Math.min(y1, y2) - 10;
              const maxY = Math.max(y1, y2) + 10;
              if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
                foundDrawingId = d.id;
                break;
              }
            }
          }
        }

        if (foundDrawingId !== null) {
          setSelectedDrawingId(foundDrawingId);
          const d = drawings.find(item => item.id === foundDrawingId);
          if (d) {
            setDrawingDragState({
              id: foundDrawingId,
              type: foundHandleIdx !== null ? "handle" : "move",
              handleIndex: foundHandleIdx || undefined,
              initialX: clickX,
              initialY: clickY,
              initialStartTs: d.startTs ?? (d.startIdx != null ? candles[Math.max(0, Math.min(candles.length - 1, Math.floor(d.startIdx)))]?.timestamp : 0),
              initialStartPrice: d.startPrice,
              initialEndTs: d.endTs ?? (d.endIdx != null ? candles[Math.max(0, Math.min(candles.length - 1, Math.floor(d.endIdx)))]?.timestamp : 0),
              initialEndPrice: d.endPrice,
              initialStopPrice: d.stopPrice,
            });
            return; // Skip normal panning
          }
        } else {
          setSelectedDrawingId(null);
        }
      }
    }

    // Check if the click is in the timeline zone (at the bottom margin area of the canvas/container)
    const rect = containerRef.current?.getBoundingClientRect();
    activePanelDragIdRef.current = null;
    if (rect) {
      const clickY = e.clientY - rect.top;
      if (clickY >= totalSvgHeight - margin.bottom) {
        setIsDraggingTimeScale(true);
        startTimeScaleXRef.current = e.clientX;
        startCandleWidthRef.current = candleWidth;

        const clickXInContainer = e.clientX - rect.left;
        const currentScroll = containerRef.current?.scrollLeft || 0;
        const absoluteX = currentScroll + clickXInContainer;
        const xFromLeft = absoluteX - margin.left;
        zoomAnchorIndexRef.current = xFromLeft / (candleWidth + candleSpacing);
        zoomAnchorClickXRef.current = clickXInContainer;
        return; // skip standard 2D panning/dragging
      }

      // Per-panel body drag: a drag starting inside a footer panel body pans that
      // panel's content vertically (offset). We still fall through to the normal
      // pan setup so HORIZONTAL (time) scroll keeps working; only the vertical
      // branch in handleMouseMove diverges (offset instead of price).
      for (const id of REORDERABLE_PANEL_IDS) {
        if (activeIndicators[id] && panelTopY[id] != null &&
            clickY >= panelTopY[id] && clickY < panelTopY[id] + getPanelHeight(id)) {
          activePanelDragIdRef.current = id;
          panelDragStartOffsetRef.current = getPanelOffset(id);
          break;
        }
      }
    }

    setIsDragging(true);
    setStartX(e.pageX - (containerRef.current?.offsetLeft || 0));
    setStartY(e.pageY - (containerRef.current?.offsetTop || 0));
    setScrollLeft(containerRef.current?.scrollLeft || 0);
    setStartPriceOffset(priceCenterOffset);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // S3: ref-current scroll for drawing drag and pan logic below.
    const visibleScrollLeft = visibleScrollLeftRef.current;
    // If we are actively drawing
    if (drawingInProgress && canvasRef.current) {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const scrollRelativeX = mouseX + visibleScrollLeft;
      const price = yToPrice(mouseY);

      setDrawingInProgress(prev => {
        if (!prev) return null;
        if (prev.type === "channel" && prev.stage === 2) {
          const cursorTs = xToTs(scrollRelativeX);
          const sTs = prev.startTs;
          const eTs = prev.endTs;
          const baselinePriceAtX = prev.startPrice + (prev.endPrice - prev.startPrice) * (eTs === sTs ? 0 : (cursorTs - sTs) / (eTs - sTs));
          const offsetPrice = price - baselinePriceAtX;
          return {
            ...prev,
            offsetPrice
          };
        }
        return {
          ...prev,
          endTs: xToTs(scrollRelativeX),
          endPrice: price,
        };
      });
      return; // Skip panning
    }

    // If dragging an existing drawing or handle
    if (drawingDragState && canvasRef.current) {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setDrawings(prev => prev.map(d => {
        if (d.id === drawingDragState.id) {
          // Pixel delta -> ts delta via current TF. Uniform mapping keeps drag
          // visually 1:1 with cursor regardless of where the anchor falls in
          // the candle array (or past its edges).
          const deltaIdx = (mouseX - drawingDragState.initialX) / candleWidthSpacing;
          const deltaTs = deltaIdx * intervalMs;
          if (drawingDragState.type === "move") {
            const initialPrice = yToPrice(drawingDragState.initialY);
            const currentPrice = yToPrice(mouseY);
            const deltaPrice = currentPrice - initialPrice;
            const next: any = {
              ...d,
              startTs: drawingDragState.initialStartTs + deltaTs,
              endTs: drawingDragState.initialEndTs + deltaTs,
              startPrice: drawingDragState.initialStartPrice + deltaPrice,
              endPrice: drawingDragState.initialEndPrice + deltaPrice,
              stopPrice: drawingDragState.initialStopPrice !== undefined
                ? drawingDragState.initialStopPrice + deltaPrice
                : undefined,
            };
            // Drop legacy idx fields so they don't outlive the migration.
            delete next.startIdx;
            delete next.endIdx;
            return next;
          } else {
            const currentPrice = yToPrice(mouseY);
            let nextStartTs = d.startTs ?? drawingDragState.initialStartTs;
            let nextStartPrice = d.startPrice;
            let nextEndTs = d.endTs ?? drawingDragState.initialEndTs;
            let nextEndPrice = d.endPrice;
            let nextOffsetPrice = d.offsetPrice;
            let nextStopPrice = d.stopPrice;

            if (d.type === "channel") {
              if (drawingDragState.handleIndex === 1) {
                nextStartTs = drawingDragState.initialStartTs + deltaTs;
                nextStartPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 2) {
                nextEndTs = drawingDragState.initialEndTs + deltaTs;
                nextEndPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 3) {
                nextOffsetPrice = currentPrice - d.endPrice;
              } else if (drawingDragState.handleIndex === 4) {
                nextOffsetPrice = currentPrice - d.startPrice;
              }
            } else if (d.type === "long" || d.type === "short") {
              if (drawingDragState.handleIndex === 1) {
                nextStartTs = drawingDragState.initialStartTs + deltaTs;
                nextStartPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 2) {
                nextEndTs = drawingDragState.initialEndTs + deltaTs;
                nextStartPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 3) {
                nextEndPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 4) {
                nextStopPrice = currentPrice;
              }
            } else {
              if (drawingDragState.handleIndex === 1) {
                nextStartTs = drawingDragState.initialStartTs + deltaTs;
                nextStartPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 2) {
                nextEndTs = drawingDragState.initialEndTs + deltaTs;
                nextEndPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 3) {
                nextEndTs = drawingDragState.initialEndTs + deltaTs;
                nextStartPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 4) {
                nextStartTs = drawingDragState.initialStartTs + deltaTs;
                nextEndPrice = currentPrice;
              }
            }

            const next: any = {
              ...d,
              startTs: nextStartTs,
              startPrice: nextStartPrice,
              endTs: nextEndTs,
              endPrice: nextEndPrice,
              offsetPrice: nextOffsetPrice,
              stopPrice: nextStopPrice
            };
            delete next.startIdx;
            delete next.endIdx;
            return next;
          }
        }
        return d;
      }));
      return; // Skip panning
    }

    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    
    const x = e.pageX - containerRef.current.offsetLeft;
    const walkX = x - startX; // 1.0 multiplier is mathematically perfect for 1:1 mouse tracking!
    const nextScroll = scrollLeft - walkX;
    containerRef.current.scrollLeft = nextScroll;
    // S3: drag-pan fires at mousemove rate. The native scroll event will reach
    // our onScroll handler (which writes the ref + schedules a draw + lazily
    // updates state). Avoid re-rendering the monolith on every mouse tick here.
    visibleScrollLeftRef.current = nextScroll;
    scheduleDraw();

    const y = e.pageY - containerRef.current.offsetTop;
    const deltaY = y - startY;

    // Vertical: if the drag started on a footer panel body, pan THAT panel's
    // content (offset) — the main price must not move. Otherwise pan the price.
    const panelDragId = activePanelDragIdRef.current;
    if (panelDragId) {
      const limit = getPanelHeight(panelDragId); // clamp so the line can't leave the panel
      const next = Math.max(-limit, Math.min(limit, panelDragStartOffsetRef.current + deltaY));
      setPanelOffset(panelDragId, next);
    } else {
      // Mathematically perfect 1:1 vertical mouse tracking based on current price range
      const currentPriceRange = maxPrice - minPrice;
      const priceChange = (deltaY / Math.max(1, chartHeight)) * currentPriceRange;
      setPriceCenterOffset(startPriceOffset + priceChange);
    }
  };

  const handleMouseUpOrLeave = () => {
    if (drawingInProgress) {
      if (drawingInProgress.type === "channel" && drawingInProgress.stage === 1) {
        // Transition to stage 2!
        setDrawingInProgress(prev => {
          if (!prev) return null;
          return {
            ...prev,
            stage: 2
          };
        });
        return;
      }

      if (drawingInProgress.type === "text") {
        setTextInputModal({
          id: drawingInProgress.id,
          startTs: drawingInProgress.startTs,
          startPrice: drawingInProgress.startPrice,
          endTs: drawingInProgress.endTs,
          endPrice: drawingInProgress.endPrice,
        });
        setTextInputValue("");
      } else {
        // Phase 14 Step 1: bake inherited settings into the new drawing at creation time
        let inherited: Record<string, unknown> = {};
        if (drawingInProgress.type === "volume") {
          inherited = { volColor: volProfileGlobalSettings.volColor, pocColor: volProfileGlobalSettings.pocColor, opacity: volProfileGlobalSettings.opacity, extendPoc: volProfileGlobalSettings.extendPoc };
        } else if (drawingInProgress.type === "long" || drawingInProgress.type === "short") {
          inherited = { deposit: positionGlobalSettings.deposit, risk: positionGlobalSettings.risk, riskType: positionGlobalSettings.riskType, colorTarget: positionGlobalSettings.colorTarget, colorStop: positionGlobalSettings.colorStop, opacity: positionGlobalSettings.opacity, fontSize: positionGlobalSettings.fontSize, makerFee: positionGlobalSettings.makerFee, takerFee: positionGlobalSettings.takerFee, entryFeeType: positionGlobalSettings.entryFeeType, exitFeeType: positionGlobalSettings.exitFeeType };
        }
        setDrawings(prev => [...prev, { ...drawingInProgress, ...inherited }]);
      }
      setDrawingInProgress(null);
      setActiveDrawingTool(null); // Reset tool after drawing
      return;
    }

    if (drawingDragState) {
      setDrawingDragState(null);
      return;
    }

    activePanelDragIdRef.current = null;
    setIsDragging(false);
  };

  // ────────────────────────────────────────────────────────────────────────
  // Touch handlers (mobile)
  // 1 finger on main area = pan X (scroll) + pan Y (price center).
  // 1 finger on bottom timescale strip = candle resize drag.
  // 2 fingers = pinch zoom (horizontal candleWidth + vertical verticalScale).
  // Tap on canvas = crosshair (reuses handleSvgMouseMove via synthetic event).
  // TODO(v2): integrate drawing tools with touch — currently we bail when
  //           activeDrawingTool / drawingDragState is non-null so the existing
  //           mouse-driven drawing pipeline stays the canonical path.
  // ────────────────────────────────────────────────────────────────────────
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("select") || target.closest("input") || target.closest("textarea") || target.closest("[role='dialog']")) {
      return;
    }
    // v1: drawing tools stay mouse-only.
    if (activeDrawingTool || drawingDragState) return;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clickY = touch.clientY - rect.top;

      if (clickY >= totalSvgHeight - margin.bottom) {
        // Timescale strip → candle-width drag.
        setIsDraggingTimeScale(true);
        startTimeScaleXRef.current = touch.clientX;
        startCandleWidthRef.current = candleWidth;

        const clickXInContainer = touch.clientX - rect.left;
        const currentScroll = containerRef.current?.scrollLeft || 0;
        const absoluteX = currentScroll + clickXInContainer;
        const xFromLeft = absoluteX - margin.left;
        zoomAnchorIndexRef.current = xFromLeft / (candleWidth + candleSpacing);
        zoomAnchorClickXRef.current = clickXInContainer;
        // Block native scroll/zoom so subsequent touchmove events stay cancelable.
        if (e.cancelable) e.preventDefault();
        return;
      }

      // Per-panel body drag (1 finger): pan the panel's content vertically.
      activePanelDragIdRef.current = null;
      for (const id of REORDERABLE_PANEL_IDS) {
        if (activeIndicators[id] && panelTopY[id] != null &&
            clickY >= panelTopY[id] && clickY < panelTopY[id] + getPanelHeight(id)) {
          activePanelDragIdRef.current = id;
          panelDragStartOffsetRef.current = getPanelOffset(id);
          break;
        }
      }

      setIsDragging(true);
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        scrollLeft: containerRef.current?.scrollLeft || 0,
        priceCenterOffset: priceCenterOffset,
      };
      if (e.cancelable) e.preventDefault();
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      const initialDistance = Math.sqrt(dx * dx + dy * dy);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && initialDistance > 10) {
        const cx = ((t0.clientX - rect.left) + (t1.clientX - rect.left)) / 2;
        const cy = ((t0.clientY - rect.top) + (t1.clientY - rect.top)) / 2;
        touchZoomRef.current = {
          initialDistance,
          initialCandleWidth: candleWidth,
          initialVerticalScale: verticalScale,
          initialPriceCenterOffset: priceCenterOffset,
          initialScrollLeft: containerRef.current?.scrollLeft || 0,
          touchCenterX: cx,
          touchCenterY: cy,
        };
        if (e.cancelable) e.preventDefault();
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (activeDrawingTool || drawingDragState) return;

    // Price scale vertical zoom (1 finger on right strip).
    // Same exponential feel as mouse path at 2861 (Math.exp(deltaY/200)).
    if (isDraggingPriceScaleRef.current && e.touches.length === 1 && !touchZoomRef.current) {
      if (e.cancelable) e.preventDefault();
      const touch = e.touches[0];
      const deltaY = startPriceScaleYRef.current - touch.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = Math.min(2000.0, Math.max(0.1, startVerticalScaleRef.current * multiplier));
      setVerticalScale(nextScale);
      verticalScaleRef.current = nextScale;
      return;
    }

    // 1-finger pan
    if (e.touches.length === 1 && touchStartRef.current && containerRef.current) {
      if (e.cancelable) e.preventDefault();
      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const nextScroll = touchStartRef.current.scrollLeft - deltaX;
      containerRef.current.scrollLeft = nextScroll;
      setVisibleScrollLeftSync(nextScroll);

      const deltaY = touch.clientY - touchStartRef.current.y;
      const panelDragId = activePanelDragIdRef.current;
      if (panelDragId) {
        const limit = getPanelHeight(panelDragId);
        const next = Math.max(-limit, Math.min(limit, panelDragStartOffsetRef.current + deltaY));
        setPanelOffset(panelDragId, next);
      } else {
        const currentPriceRange = maxPrice - minPrice;
        const priceChange = (deltaY / Math.max(1, chartHeight)) * currentPriceRange;
        const nextOffset = touchStartRef.current.priceCenterOffset + priceChange;
        setPriceCenterOffset(nextOffset);
        priceCenterOffsetRef.current = nextOffset;
      }
      return;
    }

    // 2-finger pinch
    if (e.touches.length === 2 && touchZoomRef.current && containerRef.current) {
      if (e.cancelable) e.preventDefault();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      if (currentDistance <= 10) return;

      const ratio = currentDistance / touchZoomRef.current.initialDistance;

      // Horizontal: candleWidth scale, pivot scrollLeft so touchCenterX stays on the same chart X.
      const minW = (candleType === "japanese" || candleType === "auto" || candleType === "bars") ? 1 : 8;
      const nextWidth = touchZoomRef.current.initialCandleWidth * ratio;
      const nextWidthClamped = Math.min(100, Math.max(minW, nextWidth));

      if (nextWidthClamped !== candleWidth) {
        const mouseRelativeX = touchZoomRef.current.touchCenterX;
        const currentScrollLeft = touchZoomRef.current.initialScrollLeft;
        const chartCursorX = currentScrollLeft + mouseRelativeX;
        const activeChartX = chartCursorX - margin.left;

        const prevSpacing = Math.max(1, touchZoomRef.current.initialCandleWidth < 30
          ? Math.floor(touchZoomRef.current.initialCandleWidth * 0.35) : 12);
        const nextSpacing = Math.max(1, nextWidthClamped < 30
          ? Math.floor(nextWidthClamped * 0.35) : 12);

        const widthRatio = (nextWidthClamped + nextSpacing) / (touchZoomRef.current.initialCandleWidth + prevSpacing);
        const newChartCursorX = margin.left + activeChartX * widthRatio;
        const nextScrollLeft = Math.max(0, newChartCursorX - mouseRelativeX);

        const currentScrollRightPadding = Math.round(Number(containerRef.current.clientWidth || 800) * 0.85);
        const nextScrollWidth = candles.length * (nextWidthClamped + nextSpacing) + margin.left + margin.right + currentScrollRightPadding;
        const spacer = containerRef.current.querySelector("#procluster-chart-spacer") as HTMLElement | null;
        if (spacer) spacer.style.width = `${nextScrollWidth}px`;

        setCandleWidth(nextWidthClamped);
        candleWidthRef.current = nextWidthClamped;
        containerRef.current.scrollLeft = nextScrollLeft;
        setVisibleScrollLeftSync(nextScrollLeft);
      }

      // Vertical: verticalScale scale, pivot priceCenterOffset so price under touchCenterY stays put.
      const relativeY = touchZoomRef.current.touchCenterY;
      if (relativeY >= margin.top && relativeY <= margin.top + chartHeight) {
        // Inline (do not refactor wheel): same formula as extractPriceFromY at line ~952.
        const initScale = touchZoomRef.current.initialVerticalScale;
        const initOffset = touchZoomRef.current.initialPriceCenterOffset;
        const zoomedRange = priceRange / Math.max(0.1, initScale);
        const centerPriceInit = basePriceCenter + initOffset;
        const maxP = centerPriceInit + zoomedRange * 0.58;
        const minP = centerPriceInit - zoomedRange * 0.58;
        const yRange = maxP - minP || 1;
        const mousePrice = minP + (1 - (relativeY - margin.top) / Math.max(1, chartHeight)) * yRange;

        const nextVerticalScale = Math.min(2000.0, Math.max(0.1, initScale * ratio));
        const actualMultiplier = nextVerticalScale / initScale;
        if (actualMultiplier !== 1) {
          const currentPriceCenter = basePriceCenter + initOffset;
          const newPriceCenter = mousePrice - (mousePrice - currentPriceCenter) / actualMultiplier;
          const nextPriceCenterOffset = newPriceCenter - basePriceCenter;
          setVerticalScale(nextVerticalScale);
          setPriceCenterOffset(nextPriceCenterOffset);
          verticalScaleRef.current = nextVerticalScale;
          priceCenterOffsetRef.current = nextPriceCenterOffset;
        }
      }
      return;
    }

    // 1-finger timescale drag
    if (isDraggingTimeScale && containerRef.current && e.touches.length >= 1) {
      if (e.cancelable) e.preventDefault();
      const touch = e.touches[0];
      const deltaX = touch.clientX - startTimeScaleXRef.current;
      const speed = 0.55;
      const nextWidth = startCandleWidthRef.current + deltaX * speed;
      const minW = (candleType === "japanese" || candleType === "auto" || candleType === "bars") ? 1 : 8;
      const nextWidthClamped = Math.min(100, Math.max(minW, nextWidth));

      if (nextWidthClamped !== candleWidth && zoomAnchorIndexRef.current !== null) {
        const nextSpacing = Math.max(1, nextWidthClamped < 30 ? Math.floor(nextWidthClamped * 0.35) : 12);
        const newAnchorAbsoluteX = margin.left + zoomAnchorIndexRef.current * (nextWidthClamped + nextSpacing);
        const nextScrollLeft = Math.max(0, newAnchorAbsoluteX - zoomAnchorClickXRef.current);

        const currentScrollRightPadding = Math.round(Number(containerRef.current.clientWidth || 800) * 0.85);
        const nextScrollWidth = candles.length * (nextWidthClamped + nextSpacing) + margin.left + margin.right + currentScrollRightPadding;
        const spacer = containerRef.current.querySelector("#procluster-chart-spacer") as HTMLElement | null;
        if (spacer) spacer.style.width = `${nextScrollWidth}px`;

        setCandleWidth(nextWidthClamped);
        candleWidthRef.current = nextWidthClamped;
        containerRef.current.scrollLeft = nextScrollLeft;
        setVisibleScrollLeftSync(nextScrollLeft);
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setIsDraggingTimeScale(false);
    isDraggingPriceScaleRef.current = false;
    activePanelDragIdRef.current = null;
    touchStartRef.current = null;
    touchZoomRef.current = null;
    zoomAnchorIndexRef.current = null;
  };

  // Canvas tap → crosshair. Reuses handleSvgMouseMove via a minimal synthetic
  // event since that handler reads only currentTarget + clientX + clientY.
  const handleSvgTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (activeDrawingTool) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const synthetic = {
      currentTarget: e.currentTarget,
      clientX: touch.clientX,
      clientY: touch.clientY,
    } as unknown as React.MouseEvent<HTMLCanvasElement>;
    handleSvgMouseMove(synthetic);
  };

  const handleSvgTouchEnd = () => {
    crosshairRef.current = null;
    hoveredCellRef.current = null;
    hoveredClusterSearchRef.current = null;
    drawOverlay();
    updateCrosshairDom(null, null, null);
    updateClusterTooltipDom(null);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (clickY >= margin.top && clickY <= totalSvgHeight - margin.bottom && clickX >= margin.left) {
      // Double-click on a footer panel body resets that panel's vertical pan + zoom.
      for (const id of REORDERABLE_PANEL_IDS) {
        if (activeIndicators[id] && panelTopY[id] != null &&
            clickY >= panelTopY[id] && clickY < panelTopY[id] + getPanelHeight(id)) {
          setPanelOffset(id, 0);
          resetPanelScale(id);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (areDrawingsVisible) {
        for (let i = drawings.length - 1; i >= 0; i--) {
          const d = drawings[i];
          if (d.type !== "volume" && d.type !== "long" && d.type !== "short") continue;
          const y1 = priceToY(d.startPrice);
          const y2 = priceToY(d.endPrice);
          const x1 = (d.startTs != null ? tsToX(d.startTs) : indexToX(d.startIdx)) - visibleScrollLeft;
          const x2 = (d.endTs != null ? tsToX(d.endTs) : indexToX(d.endIdx)) - visibleScrollLeft;

          const minX = Math.min(x1, x2);
          const maxX = Math.max(x1, x2);
          let minY = Math.min(y1, y2);
          let maxY = Math.max(y1, y2);

          if (d.type === "long" || d.type === "short") {
            const yStop = priceToY(d.stopPrice !== undefined ? d.stopPrice : (d.type === "long" ? (d.startPrice - (d.endPrice - d.startPrice)) : (d.startPrice + (d.startPrice - d.endPrice))));
            minY = Math.min(y1, y2, yStop);
            maxY = Math.max(y1, y2, yStop);
          }

          if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
            setSelectedDrawingId(d.id);
            if (d.type === "volume") {
              setVolumeSettingsDrawingId(d.id);
            } else {
              setPositionSettingsDrawingId(d.id);
            }
            e.preventDefault();
            e.stopPropagation();
            break;
          }
        }
      }
    }
  };

  // S1: light formatter for crosshair price label — mirrors the IIFE one in the price scale.
  const formatPriceForOverlay = (p: number) => {
    const fd = isMobile ? 0 : (activePair.priceStep < 0.1 ? 3 : 1);
    return "$" + p.toLocaleString(undefined, { minimumFractionDigits: fd, maximumFractionDigits: fd });
  };

  // S1: redraws only the overlay canvas — crosshair + hovered timestamp box.
  // Reads from crosshairRef / hoveredCellRef; never triggers a React render.
  const drawOverlay = () => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    // S3: read fresh scroll from the ref so the crosshair / hover-timestamp box
    // tracks the real scroll position even if state has not yet caught up.
    const visibleScrollLeft = visibleScrollLeftRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = visibleClientWidth || 800;
    const h = totalSvgHeight;

    // Size overlay only when geometry actually changed — avoids buffer realloc per mousemove.
    const prev = overlaySizeRef.current;
    if (prev.w !== w || prev.h !== h || prev.dpr !== dpr) {
      overlay.width = w * dpr;
      overlay.height = h * dpr;
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
      overlaySizeRef.current = { w, h, dpr };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ch = crosshairRef.current;
    if (!ch) return;

    // Crosshair lines (was previously on the main canvas; see S1 in main draw).
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = isLight ? "rgba(100, 116, 139, 0.6)" : "rgba(148, 163, 184, 0.4)";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(margin.left, ch.y);
    ctx.lineTo(w, ch.y);
    ctx.moveTo(ch.x, margin.top);
    ctx.lineTo(ch.x, h - margin.bottom);
    ctx.stroke();
    ctx.restore();

    // Hovered candle's timestamp box (was previously emitted inside the main draw label loop).
    const candleSpacingTotal = candleWidth + candleSpacing;
    const hoveredIdx = Math.floor(((ch.x + visibleScrollLeft) - margin.left) / candleSpacingTotal);
    if (hoveredIdx >= 0 && hoveredIdx < candles.length) {
      const candle = candles[hoveredIdx];
      if (candle) {
        const candleAbsX = margin.left + hoveredIdx * candleSpacingTotal;
        const labelX = candleAbsX + candleWidth / 2 - visibleScrollLeft;
        const labelY = h - margin.bottom + 16;
        const timeStr = formatTimezoneString(candle.timestamp, true);

        ctx.save();
        ctx.font = "bold 11.5px 'Inter', sans-serif";
        const textWidth = ctx.measureText(timeStr).width;
        const padX = 8;
        const rectW = textWidth + padX * 2;
        const rectH = 19;
        const rectX = labelX - rectW / 2;
        const rectY = labelY - rectH / 2;

        ctx.beginPath();
        if ((ctx as any).roundRect) {
          (ctx as any).roundRect(rectX, rectY, rectW, rectH, 4);
        } else {
          ctx.rect(rectX, rectY, rectW, rectH);
        }
        ctx.fillStyle = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(245, 158, 11, 0.22)";
        ctx.fill();
        ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.25)" : "rgba(245, 158, 11, 0.55)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = isLight ? "#0f172a" : "#facc15";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(timeStr, labelX, labelY);
        ctx.restore();
      }
    }
  };

  // S1: update the imperative DOM overlays that used to read crosshair / hoveredClusterSearch from state.
  const updateCrosshairDom = (ch: { x: number; y: number; price: number } | null, hoveredCandle: ClusterCandle | null, cvdPoint: { value: number } | null, rsiPoint?: { value: number | null } | null) => {
    // Crosshair price label on the right price scale.
    if (crosshairPriceGroupRef.current) {
      if (ch) {
        crosshairPriceGroupRef.current.style.display = "";
        if (crosshairPriceRectRef.current) crosshairPriceRectRef.current.setAttribute("y", String(ch.y - 10.5));
        if (crosshairPriceTextRef.current) {
          crosshairPriceTextRef.current.setAttribute("y", String(ch.y));
          crosshairPriceTextRef.current.textContent = formatPriceForOverlay(ch.price);
        }
      } else {
        crosshairPriceGroupRef.current.style.display = "none";
      }
    }
    // Delta value span — only updates when a candle is under the cursor.
    if (deltaValueSpanRef.current) {
      if (hoveredCandle) {
        deltaValueSpanRef.current.textContent = `${hoveredCandle.delta >= 0 ? "+" : ""}${hoveredCandle.delta.toFixed(1)}K`;
        deltaValueSpanRef.current.className = hoveredCandle.delta >= 0 ? "text-emerald-500 font-extrabold" : "text-rose-500 font-extrabold";
      } else {
        deltaValueSpanRef.current.textContent = "--";
        deltaValueSpanRef.current.className = "text-slate-500";
      }
    }
    // CVD value span.
    if (cvdValueSpanRef.current) {
      if (cvdPoint) {
        cvdValueSpanRef.current.textContent = `${cvdPoint.value >= 0 ? "+" : ""}${cvdPoint.value.toFixed(1)}K`;
        cvdValueSpanRef.current.style.color = cvdLineColor;
      } else {
        cvdValueSpanRef.current.textContent = "--";
        cvdValueSpanRef.current.style.color = "#64748b";
      }
    }
    // RSI value span (0–100, fixed scale).
    if (rsiValueSpanRef.current) {
      if (rsiPoint && rsiPoint.value !== null && rsiPoint.value !== undefined) {
        rsiValueSpanRef.current.textContent = rsiPoint.value.toFixed(1);
        rsiValueSpanRef.current.style.color = rsiLineColor;
      } else {
        rsiValueSpanRef.current.textContent = "--";
        rsiValueSpanRef.current.style.color = "#64748b";
      }
    }
  };

  // S1: update the floating Cluster Search tooltip imperatively.
  const updateClusterTooltipDom = (cs: typeof hoveredClusterSearchRef.current) => {
    const root = clusterTooltipRef.current;
    if (!root) return;
    if (!cs || !finalShowAnomalies) {
      root.style.display = "none";
      return;
    }
    const TOOLTIP_WIDTH = 265;
    const TOOLTIP_HEIGHT = 220;
    const SAFE_MARGIN = 8;
    const vw = visibleClientWidth || 800;
    const vh = totalSvgHeight || 550;
    const offsetHorizontal = vw < 640 ? 20 : 90;
    const offsetVertical = vw < 640 ? 12 : 15;
    const isLeftIdx = cs.x > vw - (TOOLTIP_WIDTH + offsetHorizontal + SAFE_MARGIN);
    const isTopIdx = cs.y > vh - (TOOLTIP_HEIGHT + offsetVertical + SAFE_MARGIN);
    let leftPos = isLeftIdx ? cs.x - TOOLTIP_WIDTH - offsetHorizontal : cs.x + offsetHorizontal;
    let topPos = isTopIdx ? cs.y - TOOLTIP_HEIGHT - offsetVertical : cs.y + offsetVertical;
    const maxLeft = vw - TOOLTIP_WIDTH - SAFE_MARGIN;
    const maxTop = vh - TOOLTIP_HEIGHT - SAFE_MARGIN;
    leftPos = Math.max(SAFE_MARGIN, Math.min(leftPos, maxLeft));
    topPos = Math.max(SAFE_MARGIN, Math.min(topPos, maxTop));

    root.style.display = "flex";
    root.style.left = `${leftPos}px`;
    root.style.top = `${topPos}px`;

    const isBidGreater = cs.bidPercent > cs.askPercent;
    const imbalanceValueStr = isBidGreater
      ? `-${cs.bidPercent.toFixed(1)}%`
      : `+${cs.askPercent.toFixed(1)}%`;

    let titleText = language === "RU" ? "ПОИСК АНОМАЛИЙ" : "ANOMALY SEARCH";
    let titleColor = cs.color;
    if (isBidGreater && cs.bidPercent >= 60) {
      titleText = language === "RU" ? "АГРЕССИВНЫЙ ПРОДАВЕЦ" : "AGGRESSIVE SELLER";
      titleColor = "#ef4444";
    } else if (!isBidGreater && cs.askPercent >= 60) {
      titleText = language === "RU" ? "АГРЕССИВНЫЙ ПОКУПАТЕЛЬ" : "AGGRESSIVE BUYER";
      titleColor = "#10b981";
    }

    if (clusterTooltipTitleWrapRef.current) clusterTooltipTitleWrapRef.current.style.color = titleColor;
    if (clusterTooltipTitleTextRef.current) clusterTooltipTitleTextRef.current.textContent = titleText;

    if (clusterTooltipBadgeRef.current) {
      const isLarge = cs.filterType === "large";
      const intensity = isLarge
        ? (language === "RU" ? "Высокая" : "HIGH")
        : (language === "RU" ? "Средняя" : "MEDIUM");
      const badgeClass = isLarge
        ? "px-2 py-0.5 rounded text-[9.5px] font-black uppercase bg-rose-500/25 text-rose-400 border border-rose-500/20"
        : "px-2 py-0.5 rounded text-[9.5px] font-black uppercase bg-amber-500/25 text-amber-400 border border-amber-500/20";
      clusterTooltipBadgeRef.current.className = badgeClass;
      clusterTooltipBadgeRef.current.textContent = intensity;
    }

    if (clusterTooltipVolumeCoinsRef.current) clusterTooltipVolumeCoinsRef.current.textContent = formatCoinsVolume(cs.sumVolume, cs.baseAsset);
    if (clusterTooltipVolumeUsdtRef.current) clusterTooltipVolumeUsdtRef.current.textContent = formatUsdtVolume(cs.usdtVolume);
    if (clusterTooltipImbalanceRef.current) {
      clusterTooltipImbalanceRef.current.textContent = imbalanceValueStr;
      clusterTooltipImbalanceRef.current.style.color = titleColor;
    }
  };

  // Mouse crosshair update builder
  const handleSvgMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const viewportWidth = visibleClientWidth || 800;
    // S3: ref-current scroll so cluster-search hit-testing reflects the real
    // viewport even when state is throttled.
    const visibleScrollLeft = visibleScrollLeftRef.current;

    // Check if hovered on the timeline strip at the bottom
    if (y >= totalSvgHeight - margin.bottom && y <= totalSvgHeight) {
      e.currentTarget.style.cursor = "ew-resize";
      crosshairRef.current = null;
      hoveredCellRef.current = null;
      hoveredClusterSearchRef.current = null;
      drawOverlay();
      updateCrosshairDom(null, null, null);
      updateClusterTooltipDom(null);
      return;
    } else {
      e.currentTarget.style.cursor = "";
    }

    if (y >= margin.top && y <= totalSvgHeight - margin.bottom && x >= margin.left && x <= viewportWidth - margin.right) {
      const clampedYForPrice = Math.min(margin.top + chartHeight, Math.max(margin.top, y));
      const price = yToPrice(clampedYForPrice);
      crosshairRef.current = { x, y, price };

      const scrolledX = x + visibleScrollLeft;

      // Identify hovered cell mathematically
      const colIdx = Math.floor((scrolledX - margin.left) / (candleWidth + candleSpacing));
      let hoveredCandleForDom: ClusterCandle | null = null;
      if (colIdx >= 0 && colIdx < candles.length) {
        const candle = candles[colIdx];
        hoveredCandleForDom = candle;
        const candleX = margin.left + colIdx * (candleWidth + candleSpacing);

        if (scrolledX >= candleX && scrolledX <= candleX + candleWidth) {
          const step = effectiveStep;
          const cell = (candle.cells || []).find(cl => price >= cl.price && price <= cl.price + step);
          hoveredCellRef.current = cell ? { candleIndex: colIdx, cell } : null;
        } else {
          hoveredCellRef.current = null;
        }
      } else {
        hoveredCellRef.current = null;
      }

      const cvdPoint = (colIdx >= 0 && colIdx < cumulativeDeltaPoints.length) ? cumulativeDeltaPoints[colIdx] : null;
      const rsiPoint = (colIdx >= 0 && colIdx < rsiPoints.length) ? rsiPoints[colIdx] : null;
      updateCrosshairDom(crosshairRef.current, hoveredCandleForDom, cvdPoint, rsiPoint);

      // --- DYNAMIC CLUSTER SEARCH HOVER DETECTION ---
      let foundCS: any = null;
      if (activeIndicators.clusterSearch && colIdx >= 0 && colIdx < candles.length) {
        const csSettings = indicatorSettings?.clusterSearch || {};
        const csMergeLevels = typeof csSettings.csMergeLevels === "number" ? csSettings.csMergeLevels : 1;
        const csImbalancePercent = typeof csSettings.csImbalancePercent === "number" ? csSettings.csImbalancePercent : 60;
        
        // Medium Filter
        const csMedMinVolume = typeof csSettings.csMedMinVolume === "number" ? csSettings.csMedMinVolume : 100;
        const csMedMaxVolume = typeof csSettings.csMedMaxVolume === "number" ? csSettings.csMedMaxVolume : 500;
        const csMedMinSize = typeof csSettings.csMedMinSize === "number" ? csSettings.csMedMinSize : 4;
        const csMedMaxSize = typeof csSettings.csMedMaxSize === "number" ? csSettings.csMedMaxSize : 12;
        const csMedShape = csSettings.csMedShape || "circle";
        const csMedColorBid = csSettings.csMedColorBid || "#ef4444";
        const csMedColorAsk = csSettings.csMedColorAsk || "#10b981";
        const csMedOpacity = typeof csSettings.csMedOpacity === "number" ? csSettings.csMedOpacity : 0.70;
        
        // Large Filter
        const csLargeMinVolume = typeof csSettings.csLargeMinVolume === "number" ? csSettings.csLargeMinVolume : 500;
        const csLargeMinSize = typeof csSettings.csLargeMinSize === "number" ? csSettings.csLargeMinSize : 10;
        const csLargeMaxSize = typeof csSettings.csLargeMaxSize === "number" ? csSettings.csLargeMaxSize : 20;
        const csLargeShape = csSettings.csLargeShape || "rhombus";
        const csLargeColorBid = csSettings.csLargeColorBid || "#f43f5e";
        const csLargeColorAsk = csSettings.csLargeColorAsk || "#34d399";
        const csLargeOpacity = typeof csSettings.csLargeOpacity === "number" ? csSettings.csLargeOpacity : 0.90;

        // Check neighboring candles for overlapping geometric elements
        const startC = Math.max(0, colIdx - 1);
        const endC = Math.min(candles.length - 1, colIdx + 1);

        for (let col = startC; col <= endC; col++) {
          const currentCandle = candles[col];
          const candleCells = currentCandle.cells || [];
          const sortedCells = [...candleCells].sort((a, b) => b.price - a.price);
          if (sortedCells.length === 0) continue;

          const colX = margin.left + col * (candleWidth + candleSpacing);
          const centerX = colX + candleWidth / 2;

          const maxBody = Math.max(currentCandle.open, currentCandle.close);
          const minBody = Math.min(currentCandle.open, currentCandle.close);

          const matches: Array<{
            filterType: "medium" | "large";
            sumVolume: number;
            bidPercent: number;
            askPercent: number;
            isBidDominant: boolean;
            isAskDominant: boolean;
            price: number;
            size: number;
            color: string;
          }> = [];

          // 1. Medium filter check
          const csMedEnabled = csSettings.csMedEnabled !== false;
          if (csMedEnabled) {
            const csMedMergeLevels = typeof csSettings.csMedMergeLevels === "number" ? csSettings.csMedMergeLevels : csMergeLevels;
            const csMedImbalancePercent = typeof csSettings.csMedImbalancePercent === "number" ? csSettings.csMedImbalancePercent : csImbalancePercent;
            const csMedMinDelta = typeof csSettings.csMedMinDelta === "number" ? csSettings.csMedMinDelta : 0;
            const csMedLocation = csSettings.csMedLocation || "any";

            const K_med = Math.max(1, Math.min(csMedMergeLevels, sortedCells.length));
            for (let i = 0; i <= sortedCells.length - K_med; i++) {
              let sumVolume = 0, sumBid = 0, sumAsk = 0;
              for (let j = 0; j < K_med; j++) {
                const cell = sortedCells[i + j];
                if (cell) {
                  sumVolume += cell.volume;
                  sumBid += cell.bid;
                  sumAsk += cell.ask;
                }
              }
              if (sumVolume <= 0) continue;
              if (sumVolume < csMedMinVolume || sumVolume > csMedMaxVolume) continue;

              const bidPercent = (sumBid / sumVolume) * 100;
              const askPercent = (sumAsk / sumVolume) * 105 ? (sumAsk / sumVolume) * 100 : 0; // Guard NaN
              const isBidDominant = bidPercent >= csMedImbalancePercent;
              const isAskDominant = askPercent >= csMedImbalancePercent;
              if (!isBidDominant && !isAskDominant) continue;

              const absDelta = Math.abs(sumAsk - sumBid);
              if (absDelta < csMedMinDelta) continue;

              const midPrice = (sortedCells[i].price + sortedCells[i + K_med - 1].price) / 2;
              if (csMedLocation === "body" && !(midPrice >= minBody && midPrice <= maxBody)) continue;
              if (csMedLocation === "lowerWick" && !(midPrice < minBody)) continue;
              if (csMedLocation === "upperWick" && !(midPrice > maxBody)) continue;

              const color = isBidDominant ? csMedColorBid : csMedColorAsk;
              const range = csMedMaxVolume - csMedMinVolume;
              const ratio = range > 0 ? Math.min(1.0, (sumVolume - csMedMinVolume) / range) : 0;
              const size = csMedMinSize + ratio * (csMedMaxSize - csMedMinSize);

              matches.push({
                filterType: "medium",
                sumVolume,
                bidPercent,
                askPercent,
                isBidDominant,
                isAskDominant,
                price: midPrice,
                size,
                color
              });
            }
          }

          // 2. Large filter check
          const csLargeEnabled = csSettings.csLargeEnabled !== false;
          if (csLargeEnabled) {
            const csLargeMergeLevels = typeof csSettings.csLargeMergeLevels === "number" ? csSettings.csLargeMergeLevels : csMergeLevels;
            const csLargeImbalancePercent = typeof csSettings.csLargeImbalancePercent === "number" ? csSettings.csLargeImbalancePercent : csImbalancePercent;
            const csLargeMinDelta = typeof csSettings.csLargeMinDelta === "number" ? csSettings.csLargeMinDelta : 0;
            const csLargeLocation = csSettings.csLargeLocation || "any";

            const K_large = Math.max(1, Math.min(csLargeMergeLevels, sortedCells.length));
            for (let i = 0; i <= sortedCells.length - K_large; i++) {
              let sumVolume = 0, sumBid = 0, sumAsk = 0;
              for (let j = 0; j < K_large; j++) {
                const cell = sortedCells[i + j];
                if (cell) {
                  sumVolume += cell.volume;
                  sumBid += cell.bid;
                  sumAsk += cell.ask;
                }
              }
              if (sumVolume <= 0) continue;
              if (sumVolume < csLargeMinVolume) continue;

              const bidPercent = (sumBid / sumVolume) * 100;
              const askPercent = (sumAsk / sumVolume) * 100;
              const isBidDominant = bidPercent >= csLargeImbalancePercent;
              const isAskDominant = askPercent >= csLargeImbalancePercent;
              if (!isBidDominant && !isAskDominant) continue;

              const absDelta = Math.abs(sumAsk - sumBid);
              if (absDelta < csLargeMinDelta) continue;

              const midPrice = (sortedCells[i].price + sortedCells[i + K_large - 1].price) / 2;
              if (csLargeLocation === "body" && !(midPrice >= minBody && midPrice <= maxBody)) continue;
              if (csLargeLocation === "lowerWick" && !(midPrice < minBody)) continue;
              if (csLargeLocation === "upperWick" && !(midPrice > maxBody)) continue;

              const color = isBidDominant ? csLargeColorBid : csLargeColorAsk;
              const range = csLargeMinVolume * 2;
              const ratio = range > 0 ? Math.min(1.0, (sumVolume - csLargeMinVolume) / range) : 0;
              const size = csLargeMinSize + ratio * (csLargeMaxSize - csLargeMinSize);

              matches.push({
                filterType: "large",
                sumVolume,
                bidPercent,
                askPercent,
                isBidDominant,
                isAskDominant,
                price: midPrice,
                size,
                color
              });
            }
          }

          // Check click / hover distance on computed matches
          for (const match of matches) {
            const screenX = centerX - visibleScrollLeft;
            const screenY = priceToY(match.price);

            const dx = x - screenX;
            const dy = y - screenY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance <= Math.max(12, match.size / 2 + 8)) {
              const baseAsset = activePair.symbol.split("/")[0] || "BTC";
              foundCS = {
                x: screenX,
                y: screenY,
                sumVolume: match.sumVolume,
                usdtVolume: match.sumVolume * match.price,
                bidPercent: match.bidPercent,
                askPercent: match.askPercent,
                isBidDominant: match.isBidDominant,
                isAskDominant: match.isAskDominant,
                baseAsset,
                price: match.price,
                color: match.color,
                filterType: match.filterType
              };
              break;
            }
          }
          if (foundCS) break;
        }
      }
      hoveredClusterSearchRef.current = foundCS;
      updateClusterTooltipDom(foundCS);
      drawOverlay();
    } else {
      crosshairRef.current = null;
      hoveredCellRef.current = null;
      hoveredClusterSearchRef.current = null;
      drawOverlay();
      updateCrosshairDom(null, null, null);
      updateClusterTooltipDom(null);
    }
  };

  const handleSvgMouseLeave = () => {
    crosshairRef.current = null;
    hoveredCellRef.current = null;
    hoveredClusterSearchRef.current = null;
    drawOverlay();
    updateCrosshairDom(null, null, null);
    updateClusterTooltipDom(null);
  };

  // Profile aggregates: Horizontal Session Profile drawn on the vertical scale.
  // Slices price ranges and sums volumes from visible candles
  const generateSessionProfile = () => {
    const profileRange = maxPrice - minPrice;
    const bucketCount = 20;
    const bucketSize = (profileRange / bucketCount) || 1;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      price: minPrice + i * bucketSize + bucketSize / 2,
      volume: 0,
    }));

    if (candles.length > 0) {
      candles.forEach(candle => {
        (candle.cells || []).forEach(cell => {
          const bucketIdx = Math.floor((cell.price - minPrice) / bucketSize);
          if (bucketIdx >= 0 && bucketIdx < bucketCount) {
            buckets[bucketIdx].volume += cell.volume;
          }
        });
      });
    }

    const maxProfileVol = Math.max(...buckets.map(b => b.volume), 1);
    return { buckets, maxProfileVol, bucketSize };
  };

  // Memoize Session Profile
  const { buckets: profileBuckets, maxProfileVol, bucketSize: profileBucketSize } = useMemo(() => {
    const profileRange = maxPrice - minPrice;
    const bucketCount = 20;
    const bucketSize = (profileRange / bucketCount) || 1;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      price: minPrice + i * bucketSize + bucketSize / 2,
      volume: 0,
    }));

    if (candles.length > 0) {
      candles.forEach(candle => {
        (candle.cells || []).forEach(cell => {
          const bucketIdx = Math.floor((cell.price - minPrice) / bucketSize);
          if (bucketIdx >= 0 && bucketIdx < bucketCount) {
            buckets[bucketIdx].volume += cell.volume;
          }
        });
      });
    }

    let maxProfileVol = 1;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].volume > maxProfileVol) maxProfileVol = buckets[i].volume;
    }
    return { buckets, maxProfileVol, bucketSize };
  }, [candles, minPrice, maxPrice]);

  // Find overall maximum cell volume to properly scale cell footprint horizontal bars (memoized)
  const maxCellVolume = useMemo(() => {
    let max = 1;
    for (let c = 0; c < candles.length; c++) {
      const cells = candles[c].cells || [];
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].volume > max) {
          max = cells[i].volume;
        }
      }
    }
    return max;
  }, [candles]);

  // Compute high delta for standard delta chart scaling (memoized) using visible candles
  const maxCandleDelta = useMemo(() => {
    let max = 1;
    for (let i = 0; i < candlesToScale.length; i++) {
      const absDelta = Math.abs(candlesToScale[i].delta);
      if (absDelta > max) max = absDelta;
    }
    return max;
  }, [candlesToScale]);

  // Zoomed version of maxCandleDelta based on user vertical dragging/zooming
  const zoomedMaxCandleDelta = useMemo(() => {
    return maxCandleDelta / Math.max(0.01, deltaScale);
  }, [maxCandleDelta, deltaScale]);

  // Compute maximum wick value across all candles for candlestick delta panel scaling
  const maxWickValue = useMemo(() => {
    let max = 1;
    for (let i = 0; i < candlesToScale.length; i++) {
      const candle = candlesToScale[i];
      const ask = (candle.volume + candle.delta) / 2;
      const bid = (candle.volume - candle.delta) / 2;
      const val = Math.max(ask, bid);
      if (val > max) max = val;
    }
    return max;
  }, [candlesToScale]);

  const zoomedMaxWickValue = useMemo(() => {
    return maxWickValue / Math.max(0.01, deltaScale);
  }, [maxWickValue, deltaScale]);

  // Find overall maximum cell delta to properly scale imbalance highlights (memoized)
  const maxCellDelta = useMemo(() => {
    let max = 1;
    for (let c = 0; c < candles.length; c++) {
      const cells = candles[c].cells || [];
      for (let i = 0; i < cells.length; i++) {
        const d = Math.abs(cells[i].ask - cells[i].bid);
        if (d > max) max = d;
      }
    }
    return max;
  }, [candles]);

  // Generate Cumulative Delta Line Coordinates (memoized)
  // Heavy CVD calculation — depends only on data, not scroll position
  const rawCvdValues = useMemo(() => {
    return cvdIndicator.calculateCVD(candles, cvdPeriod, 0, cvdSmoothing);
  }, [candles, cvdPeriod, cvdSmoothing]);

  // Light coordinate mapping — recalculates on scroll/zoom but skips heavy CVD math
  const cumulativeDeltaPoints = useMemo(() => {
    return rawCvdValues.map((item, i) => {
      const cx = margin.left + i * (candleWidth + candleSpacing) + candleWidth / 2;
      return { cx, value: item.value, open: item.open, high: item.high, low: item.low, close: item.close };
    });
  }, [rawCvdValues, candleWidth, candleSpacing, margin.left]);

  // RSI values (Wilder), computed over the full candle history so the period seed
  // is correct even after backfill. Heavy math — depends only on data + period.
  const rsiValues = useMemo(() => {
    return rsiIndicator.calculateRSI(candles.map(c => c.close), rsiPeriod);
  }, [candles, rsiPeriod]);

  // Light coordinate mapping (center-of-candle X), recalculated on scroll/zoom only.
  const rsiPoints = useMemo(() => {
    return rsiValues.map((value, i) => {
      const cx = margin.left + i * (candleWidth + candleSpacing) + candleWidth / 2;
      return { cx, value };
    });
  }, [rsiValues, candleWidth, candleSpacing, margin.left]);

  // --- Bid & Ask Ratio (footer panel) — data comes from the BACKEND, not from
  // candles. Fetch when the indicator is active AND the market is futures.
  const [bidAskRatioData, setBidAskRatioData] = useState<BookDepthRatioPoint[]>([]);

  const candleMinTs = candles.length > 0 ? candles[0]!.timestamp : 0;
  const candleMaxTs = candles.length > 0 ? candles[candles.length - 1]!.timestamp : 0;
  const bidAskRatioActive = !!activeIndicators.bidAskRatio;
  const isFuturesMarket = marketType === "FUTURES";
  // Buy/Sell Zone also consumes bid/ask depth AND long/short ratio, so it must
  // trigger both fetches even when those panels are not individually active.
  const buySellZoneActive = !!activeIndicators.buySellZone;

  useEffect(() => {
    if ((!bidAskRatioActive && !buySellZoneActive) || !isFuturesMarket) {
      setBidAskRatioData([]);
      return;
    }
    if (!candleMinTs || !candleMaxTs || !timeframe) return;
    let cancelled = false;
    // Normalize symbol to the storage form (no slash) — ClickHouse keeps "BTCUSDT", not "BTC/USDT".
    const bdSymbol = activePair.symbol.toUpperCase().replace("/", "");
    // +1 bucket of slack on `to` so the most recent (forming) candle is covered.
    fetchBookDepthRatio(bdSymbol, "futures", timeframe, candleMinTs, candleMaxTs + 60_000, accessToken)
      .then((pts) => { if (!cancelled) setBidAskRatioData(pts); })
      .catch(() => { if (!cancelled) setBidAskRatioData([]); });
    return () => { cancelled = true; };
  }, [bidAskRatioActive, buySellZoneActive, isFuturesMarket, activePair.symbol, timeframe, candleMinTs, candleMaxTs, accessToken]);

  const bidAskRatioMap = useMemo(() => {
    const m = new Map<number, BookDepthRatioPoint>();
    for (const p of bidAskRatioData) m.set(p.t, p);
    return m;
  }, [bidAskRatioData]);

  // Coordinate mapping (center-of-candle X) + ratio value matched by candle_open.
  const bidAskRatioPoints = useMemo(() => {
    return candles.map((c, i) => {
      const cx = margin.left + i * (candleWidth + candleSpacing) + candleWidth / 2;
      const pt = bidAskRatioMap.get(c.timestamp);
      const value: number | null = pt ? pt[bidAskRatioRKey] : null;
      return { cx, value };
    });
  }, [candles, bidAskRatioMap, bidAskRatioRKey, candleWidth, candleSpacing, margin.left]);

  // Dynamically calculate visible min and max cumulative delta for local auto-scaling to fill 80% height
  const { minCumDeltaVal, maxCumDeltaVal, cvdDeltaRange } = useMemo(() => {
    if (cumulativeDeltaPoints.length === 0) {
      return { minCumDeltaVal: 0, maxCumDeltaVal: 1, cvdDeltaRange: 1 };
    }
    const viewportWidth = visibleClientWidth || 800;
    const startIdx = Math.max(0, Math.floor((visibleScrollLeft - margin.left - candleWidth) / (candleWidth + candleSpacing)));
    const endIdx = Math.min(cumulativeDeltaPoints.length - 1, Math.ceil((visibleScrollLeft + viewportWidth - margin.left) / (candleWidth + candleSpacing)));
    
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      if (cumulativeDeltaPoints[i]) {
        const item = cumulativeDeltaPoints[i];
        const valMin = cvdPlotType === "candles" ? item.low : item.value;
        const valMax = cvdPlotType === "candles" ? item.high : item.value;
        if (valMin < minVal) minVal = valMin;
        if (valMax > maxVal) maxVal = valMax;
      }
    }
    if (minVal === Infinity || maxVal === -Infinity) {
      // Fallback if none are visible
      minVal = cumulativeDeltaPoints[0].low ?? cumulativeDeltaPoints[0].value;
      maxVal = cumulativeDeltaPoints[0].high ?? cumulativeDeltaPoints[0].value;
      for (let i = 0; i < cumulativeDeltaPoints.length; i++) {
        const item = cumulativeDeltaPoints[i];
        const valMin = cvdPlotType === "candles" ? item.low : item.value;
        const valMax = cvdPlotType === "candles" ? item.high : item.value;
        if (valMin < minVal) minVal = valMin;
        if (valMax > maxVal) maxVal = valMax;
      }
    }
    const range = Math.max(1, maxVal - minVal);
    return { minCumDeltaVal: minVal, maxCumDeltaVal: maxVal, cvdDeltaRange: range };
  }, [cumulativeDeltaPoints, visibleScrollLeft, visibleClientWidth, candleWidth, candleSpacing, cvdPlotType]);

  const zoomedCvdDeltaRange = useMemo(() => cvdDeltaRange / Math.max(0.01, cvdScale), [cvdDeltaRange, cvdScale]);
  const cvdCenterVal = useMemo(() => (maxCumDeltaVal + minCumDeltaVal) / 2, [maxCumDeltaVal, minCumDeltaVal]);
  const zoomedCvdMax = useMemo(() => cvdCenterVal + zoomedCvdDeltaRange * 0.5, [cvdCenterVal, zoomedCvdDeltaRange]);
  const zoomedCvdMin = useMemo(() => cvdCenterVal - zoomedCvdDeltaRange * 0.5, [cvdCenterVal, zoomedCvdDeltaRange]);

  const getCvdY = (val: number, panelH: number) => {
    return panelH - ((val - zoomedCvdMin) / zoomedCvdDeltaRange) * (panelH * 0.96) - (panelH * 0.02) + cvdOffset;
  };

  // RSI vertical zoom around the centre (50). scale=1 → [0,100] (unzoomed).
  const zoomedRsiHalf = 50 / Math.max(0.01, rsiScale);
  const zoomedRsiMax = 50 + zoomedRsiHalf;
  const zoomedRsiMin = 50 - zoomedRsiHalf;
  // Panel-local Y for an RSI value (0 at top). Shared by canvas draw and SVG ticks.
  const rsiYInPanel = (v: number) =>
    rsiPanelHeight - ((v - zoomedRsiMin) / (zoomedRsiMax - zoomedRsiMin)) * rsiPanelHeight + rsiOffset;

  // Bid & Ask Ratio vertical zoom, symmetric around 0. scale=1 → [-1,+1].
  const zoomedRatioMax = 1.0 / Math.max(0.01, bidAskRatioScale);
  const zoomedRatioMin = -zoomedRatioMax;
  // Panel-local Y for a ratio value. usableHalf leaves ~2% margin top & bottom.
  const ratioYInPanel = (v: number) => {
    const mid = bidAskRatioPanelHeight / 2;
    const half = bidAskRatioPanelHeight * 0.48;
    const cl = Math.max(zoomedRatioMin, Math.min(zoomedRatioMax, v));
    return mid - (cl / zoomedRatioMax) * half + bidAskRatioOffset;
  };

  // --- Long/Short Account Ratio (footer panel) — LINE, data from the BACKEND
  // (not candles). Fetch when active AND market is futures. Auto-scales on the
  // visible min/max (like CVD); the neutral line is ratio=1 (or 50% in longPct).
  const [longShortRatioData, setLongShortRatioData] = useState<LongShortRatioPoint[]>([]);
  const longShortRatioActive = !!activeIndicators.longShortRatio;

  useEffect(() => {
    if ((!longShortRatioActive && !buySellZoneActive) || !isFuturesMarket) {
      setLongShortRatioData([]);
      return;
    }
    if (!candleMinTs || !candleMaxTs || !timeframe) return;
    let cancelled = false;
    // Normalize symbol to storage form (no slash) — ClickHouse keeps "BTCUSDT".
    const lsrSymbol = activePair.symbol.toUpperCase().replace("/", "");
    fetchLongShortRatio(lsrSymbol, "futures", timeframe, candleMinTs, candleMaxTs + 60_000, accessToken)
      .then((pts) => { if (!cancelled) setLongShortRatioData(pts); })
      .catch(() => { if (!cancelled) setLongShortRatioData([]); });
    return () => { cancelled = true; };
  }, [longShortRatioActive, buySellZoneActive, isFuturesMarket, activePair.symbol, timeframe, candleMinTs, candleMaxTs, accessToken]);

  const longShortRatioMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of longShortRatioData) m.set(p.t, p.ratio);
    return m;
  }, [longShortRatioData]);

  // Neutral reference value in the active display mode.
  const longShortRatioNeutral = longShortRatioDisplayMode === "longPct" ? 50 : 1;

  // Coordinate mapping (center-of-candle X) + display value matched by candle_open.
  // value=null where no point exists for that candle (line skips to next point).
  const longShortRatioPoints = useMemo(() => {
    return candles.map((c, i) => {
      const cx = margin.left + i * (candleWidth + candleSpacing) + candleWidth / 2;
      const ratio = longShortRatioMap.get(c.timestamp);
      let value: number | null = null;
      if (typeof ratio === "number") {
        value = longShortRatioDisplayMode === "longPct" ? (ratio / (ratio + 1)) * 100 : ratio;
      }
      return { cx, value };
    });
  }, [candles, longShortRatioMap, longShortRatioDisplayMode, candleWidth, candleSpacing, margin.left]);

  // Visible min/max of the display value for auto-scale (like CVD).
  const { lsrMinVal, lsrMaxVal, lsrRange } = useMemo(() => {
    const defaults = longShortRatioDisplayMode === "longPct"
      ? { lsrMinVal: 0, lsrMaxVal: 100, lsrRange: 100 }
      : { lsrMinVal: 0, lsrMaxVal: 2, lsrRange: 2 };
    if (longShortRatioPoints.length === 0) return defaults;
    const viewportWidth = visibleClientWidth || 800;
    const startIdx = Math.max(0, Math.floor((visibleScrollLeft - margin.left - candleWidth) / (candleWidth + candleSpacing)));
    const endIdx = Math.min(longShortRatioPoints.length - 1, Math.ceil((visibleScrollLeft + viewportWidth - margin.left) / (candleWidth + candleSpacing)));
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      const p = longShortRatioPoints[i];
      if (!p || p.value === null) continue;
      if (p.value < minV) minV = p.value;
      if (p.value > maxV) maxV = p.value;
    }
    if (minV === Infinity || maxV === -Infinity) {
      for (const p of longShortRatioPoints) {
        if (!p || p.value === null) continue;
        if (p.value < minV) minV = p.value;
        if (p.value > maxV) maxV = p.value;
      }
    }
    if (minV === Infinity || maxV === -Infinity) return defaults;
    // Keep the neutral line inside the visible band.
    minV = Math.min(minV, longShortRatioNeutral);
    maxV = Math.max(maxV, longShortRatioNeutral);
    const range = Math.max(longShortRatioDisplayMode === "longPct" ? 1 : 0.05, maxV - minV);
    return { lsrMinVal: minV, lsrMaxVal: maxV, lsrRange: range };
  }, [longShortRatioPoints, visibleScrollLeft, visibleClientWidth, candleWidth, candleSpacing, longShortRatioDisplayMode, longShortRatioNeutral]);

  const zoomedLsrRange = useMemo(() => lsrRange / Math.max(0.01, longShortRatioScale), [lsrRange, longShortRatioScale]);
  const lsrCenterVal = useMemo(() => (lsrMaxVal + lsrMinVal) / 2, [lsrMaxVal, lsrMinVal]);
  const zoomedLsrMax = useMemo(() => lsrCenterVal + zoomedLsrRange * 0.5, [lsrCenterVal, zoomedLsrRange]);
  const zoomedLsrMin = useMemo(() => lsrCenterVal - zoomedLsrRange * 0.5, [lsrCenterVal, zoomedLsrRange]);

  const getLsrY = (val: number, panelH: number) => {
    return panelH - ((val - zoomedLsrMin) / zoomedLsrRange) * (panelH * 0.96) - (panelH * 0.02) + longShortRatioOffset;
  };

  // --- Buy/Sell Zone (footer panel) — composite 0..100 oscillator.
  // Per candle: each available component is normalised to 0..100 and a weighted
  // mean is taken over ONLY the available ones (weight denominator renormalises).
  //   lsScore  = 100 − zToScale(lsr, lsZlen)   (inverted, like the Pine original)
  //   rsiScore = RSI(close, rsiLen)
  //   macdScore= zToScale(macdHist(close), macdZlen)
  //   barScore = 50·(1 − r)  (перевес бидов тянет вниз, к buy-зоне) where r = bid/ask ratio band (−1..+1), linear
  // value=null when zero components are available → the drawn line breaks there.
  const buySellZonePoints = useMemo(() => {
    const n = candles.length;
    if (!buySellZoneActive || !isFuturesMarket || n === 0) {
      return candles.map((_, i) => ({ cx: margin.left + i * (candleWidth + candleSpacing) + candleWidth / 2, value: null as number | null }));
    }
    const closes = candles.map((c) => c.close);
    const rsiSeries = rsiIndicator.calculateRSI(closes, bsZoneRsiLen);
    const macdSeries = macdHist(closes);
    // Sparse long/short series aligned to candle index (null where no point).
    const lsrArr: (number | null)[] = candles.map((c) => {
      const r = longShortRatioMap.get(c.timestamp);
      return typeof r === "number" ? r : null;
    });

    return candles.map((c, i) => {
      const cx = margin.left + i * (candleWidth + candleSpacing) + candleWidth / 2;

      const lsZ = zToScale(lsrArr, bsZoneLsZlen, i);
      const lsScore: number | null = lsZ == null ? null : 100 - lsZ;
      const rsiScore: number | null = rsiSeries[i] ?? null;
      const macdScore: number | null = zToScale(macdSeries, bsZoneMacdZlen, i);

      const bar = bidAskRatioMap.get(c.timestamp);
      let barScore: number | null = null;
      if (bar) {
        const r = Math.max(-1, Math.min(1, bar[bsZoneRKey]));
        barScore = 50 * (1 - r);
      }

      let num = 0;
      let den = 0;
      if (lsScore != null && Number.isFinite(lsScore)) { num += bsZoneWLS * lsScore; den += bsZoneWLS; }
      if (rsiScore != null && Number.isFinite(rsiScore)) { num += bsZoneWRSI * rsiScore; den += bsZoneWRSI; }
      if (macdScore != null && Number.isFinite(macdScore)) { num += bsZoneWMACD * macdScore; den += bsZoneWMACD; }
      if (barScore != null && Number.isFinite(barScore)) { num += bsZoneWBAR * barScore; den += bsZoneWBAR; }

      const value: number | null = den > 0 ? Math.max(0, Math.min(100, num / den)) : null;
      return { cx, value };
    });
  }, [candles, buySellZoneActive, isFuturesMarket, longShortRatioMap, bidAskRatioMap, bsZoneRKey, bsZoneRsiLen, bsZoneMacdZlen, bsZoneLsZlen, bsZoneWLS, bsZoneWRSI, bsZoneWMACD, bsZoneWBAR, candleWidth, candleSpacing, margin.left]);

  // Buy/Sell Zone vertical zoom around the centre (50). scale=1 → fixed [0,100],
  // value 0 at the bottom of the panel, 100 at the top. Mirrors rsiYInPanel.
  const zoomedBsHalf = 50 / Math.max(0.01, buySellZoneScale);
  const zoomedBsMax = 50 + zoomedBsHalf;
  const zoomedBsMin = 50 - zoomedBsHalf;
  const getBsZoneY = (val: number, panelH: number) =>
    panelH - ((val - zoomedBsMin) / (zoomedBsMax - zoomedBsMin)) * panelH + buySellZoneOffset;

  // R: visibleMaxCellVol / visibleMaxSingleVol useMemos deleted — both consumed
  // only inside drawRef closure (cell normalization for detailed/cluster mode).
  // They are now computed inline in drawRef.current with the same single-pass
  // loop over the visible candle range, so they no longer cost a React commit
  // recomputation on every throttled scroll-state push.

  // --- ATAS STACKED IMBALANCE CALCULATION ENGINE ---
  const stackedImbalanceLines = useMemo(() => {
    if (!activeIndicators.stackedImbalance || candles.length === 0) return [];

    const siSettings = indicatorSettings?.stackedImbalance || {};
    const siRatio = typeof siSettings.siRatio === "number" ? siSettings.siRatio : 300;
    const siRange = typeof siSettings.siRange === "number" ? siSettings.siRange : 3;
    const siVolume = typeof siSettings.siVolume === "number" ? siSettings.siVolume : 10;
    const siColorPos = parseHexColor(siSettings.siColorPos || "#FF228B22");
    const siColorNeg = parseHexColor(siSettings.siColorNeg || "#FFC80000");

    const lines: {
      price: number;
      startIdx: number;
      endIdx: number | null;
      type: "buy" | "sell";
      color: string;
    }[] = [];

    // Scan all candles to find stacked imbalances
    for (let cIdx = 0; cIdx < candles.length; cIdx++) {
      const candle = candles[cIdx];
      const cells = candle.cells || [];
      if (cells.length < 2) continue;

      // Ensure cells are sorted descending by price
      const sortedCells = [...cells].sort((a, b) => b.price - a.price);

      const count = sortedCells.length;
      const isBuyImb = new Array(count - 1).fill(false);
      const isSellImb = new Array(count - 1).fill(false);

      for (let i = 0; i < count - 1; i++) {
        const upperCell = sortedCells[i];
        const lowerCell = sortedCells[i + 1];

        // Buying diagonal imbalance (Ask at upper level vs Bid at lower level)
        const upperAsk = upperCell.ask;
        const lowerBid = lowerCell.bid;
        const satisfiesBuyRatio = lowerBid === 0 ? (upperAsk >= siVolume) : (upperAsk >= lowerBid * (siRatio / 100));
        isBuyImb[i] = satisfiesBuyRatio && (upperAsk >= siVolume);

        // Selling diagonal imbalance (Bid at lower level vs Ask at upper level)
        const lowerBidVal = lowerCell.bid;
        const upperAskVal = upperCell.ask;
        const satisfiesSellRatio = upperAskVal === 0 ? (lowerBidVal >= siVolume) : (lowerBidVal >= upperAskVal * (siRatio / 100));
        isSellImb[i] = satisfiesSellRatio && (lowerBidVal >= siVolume);
      }

      // Find stacked BUY imbalances of consecutive range length
      for (let i = 0; i <= isBuyImb.length - siRange; i++) {
        let allBuy = true;
        for (let r = 0; r < siRange; r++) {
          if (!isBuyImb[i + r]) {
            allBuy = false;
            break;
          }
        }
        if (allBuy) {
          // Add price levels
          for (let r = 0; r < siRange; r++) {
            const price = sortedCells[i + r].price;
            if (!lines.some(l => l.startIdx === cIdx && l.price === price && l.type === "buy")) {
              lines.push({
                price,
                startIdx: cIdx,
                endIdx: null,
                type: "buy",
                color: siColorPos
              });
            }
          }
        }
      }

      // Find stacked SELL imbalances of consecutive range length
      for (let i = 0; i <= isSellImb.length - siRange; i++) {
        let allSell = true;
        for (let r = 0; r < siRange; r++) {
          if (!isSellImb[i + r]) {
            allSell = false;
            break;
          }
        }
        if (allSell) {
          // Add price levels (Bid is at lower cell index i + r + 1)
          for (let r = 0; r < siRange; r++) {
            const price = sortedCells[i + r + 1].price;
            if (!lines.some(l => l.startIdx === cIdx && l.price === price && l.type === "sell")) {
              lines.push({
                price,
                startIdx: cIdx,
                endIdx: null,
                type: "sell",
                color: siColorNeg
              });
            }
          }
        }
      }
    }

    // Determine mitigation for each line by subsequent candles
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const sIdx = line.startIdx;
      for (let c2 = sIdx + 1; c2 < candles.length; c2++) {
        const nextC = candles[c2];
        if (nextC.low <= line.price && nextC.high >= line.price) {
          line.endIdx = c2;
          break;
        }
      }
    }

    return lines;
  }, [candles, indicatorSettings, activeIndicators.stackedImbalance]);

  // Window-level mouse resize tracker for indicator panels
  useEffect(() => {
    if (!resizingPanel) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      if (resizingPanel === "delta") {
        const deltaBottomY = deltaTopY + deltaPanelHeight;
        const newHeight = Math.max(50, Math.min(350, deltaBottomY - relativeY));
        setDeltaPanelHeight(newHeight);
      } else if (resizingPanel === "cvd") {
        const cvdBottomY = cvdTopY + cvdPanelHeight;
        const newHeight = Math.max(50, Math.min(350, cvdBottomY - relativeY));
        setCvdPanelHeight(newHeight);
      } else if (resizingPanel === "rsi") {
        const rsiBottomY = rsiTopY + rsiPanelHeight;
        const newHeight = Math.max(50, Math.min(350, rsiBottomY - relativeY));
        setRsiPanelHeight(newHeight);
      } else if (resizingPanel === "bidAskRatio") {
        const barBottomY = bidAskRatioTopY + bidAskRatioPanelHeight;
        const newHeight = Math.max(50, Math.min(350, barBottomY - relativeY));
        setBidAskRatioPanelHeight(newHeight);
      } else if (resizingPanel === "longShortRatio") {
        const lsrBottomY = longShortRatioTopY + longShortRatioPanelHeight;
        const newHeight = Math.max(50, Math.min(350, lsrBottomY - relativeY));
        setLongShortRatioPanelHeight(newHeight);
      } else if (resizingPanel === "buySellZone") {
        const bsBottomY = buySellZoneTopY + buySellZonePanelHeight;
        const newHeight = Math.max(50, Math.min(350, bsBottomY - relativeY));
        setBuySellZonePanelHeight(newHeight);
      }
    };

    const handleWindowMouseUp = () => {
      setResizingPanel(null);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [resizingPanel, deltaTopY, deltaPanelHeight, cvdTopY, cvdPanelHeight, rsiTopY, rsiPanelHeight, bidAskRatioTopY, bidAskRatioPanelHeight, longShortRatioTopY, longShortRatioPanelHeight, buySellZoneTopY, buySellZonePanelHeight]);

  // Window-level mouse drag-zoom tracker for vertical price scale dragging
  useEffect(() => {
    if (!isDraggingPriceScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startPriceScaleYRef.current - e.clientY;
      // Exponential zoom feel: dragging up zooms in, dragging down zooms out
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startVerticalScaleRef.current * multiplier;
      const clampedScale = Math.min(2000.0, Math.max(0.1, nextScale));
      setVerticalScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingPriceScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingPriceScale]);

  // Window-level mouse drag-zoom tracker for vertical Delta scale dragging
  useEffect(() => {
    if (!isDraggingDeltaScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startDeltaScaleYRef.current - e.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startDeltaScaleRef.current * multiplier;
      const clampedScale = Math.min(200.0, Math.max(0.01, nextScale));
      setDeltaScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingDeltaScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingDeltaScale]);

  // Window-level mouse drag-zoom tracker for vertical CVD scale dragging
  useEffect(() => {
    if (!isDraggingCvdScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startCvdScaleYRef.current - e.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startCvdScaleRef.current * multiplier;
      const clampedScale = Math.min(200.0, Math.max(0.01, nextScale));
      setCvdScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingCvdScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingCvdScale]);

  // Window-level mouse drag-zoom tracker for vertical RSI scale dragging
  useEffect(() => {
    if (!isDraggingRsiScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startRsiScaleYRef.current - e.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startRsiScaleRef.current * multiplier;
      const clampedScale = Math.min(200.0, Math.max(0.01, nextScale));
      setRsiScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingRsiScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingRsiScale]);

  // Window-level mouse drag-zoom tracker for vertical Bid & Ask Ratio scale dragging
  useEffect(() => {
    if (!isDraggingBidAskRatioScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startBidAskRatioScaleYRef.current - e.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startBidAskRatioScaleRef.current * multiplier;
      const clampedScale = Math.min(200.0, Math.max(0.01, nextScale));
      setBidAskRatioScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingBidAskRatioScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingBidAskRatioScale]);

  // Window-level mouse drag-zoom tracker for vertical Long/Short Ratio scale dragging
  useEffect(() => {
    if (!isDraggingLongShortRatioScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startLongShortRatioScaleYRef.current - e.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startLongShortRatioScaleRef.current * multiplier;
      const clampedScale = Math.min(200.0, Math.max(0.01, nextScale));
      setLongShortRatioScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingLongShortRatioScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingLongShortRatioScale]);

  // Window-level mouse drag-zoom tracker for vertical Buy/Sell Zone scale dragging
  useEffect(() => {
    if (!isDraggingBuySellZoneScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startBuySellZoneScaleYRef.current - e.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startBuySellZoneScaleRef.current * multiplier;
      const clampedScale = Math.min(200.0, Math.max(0.01, nextScale));
      setBuySellZoneScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingBuySellZoneScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingBuySellZoneScale]);

  // Window-level mouse drag-zoom tracker for horizontal timeline scale dragging
  useEffect(() => {
    if (!isDraggingTimeScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startTimeScaleXRef.current;
      // Linear zoom mapping starting from our cached candleWidth.
      // If we move mouse to the right, we stretch (increase candleWidth).
      // If we move mouse to the left, we squeeze (decrease candleWidth).
      const nextW = startCandleWidthRef.current + deltaX * 1.0;
      const minW = (candleType === "japanese" || candleType === "auto" || candleType === "bars") ? 1 : 8;
      const clampedW = Math.min(100, Math.max(minW, nextW));

      candleWidthRef.current = clampedW;
      setCandleWidth(clampedW);

      if (zoomAnchorIndexRef.current !== null && containerRef.current) {
        const targetAbsoluteX = zoomAnchorIndexRef.current * (clampedW + candleSpacing) + margin.left;
        const nextScrollLeft = targetAbsoluteX - zoomAnchorClickXRef.current;
        
        // Calculate the maximum actual scroll boundaries using the prospective width
        const scrollWidthCalculated = candles.length * (clampedW + candleSpacing) + margin.left + margin.right + scrollRightPadding;
        const maxScroll = Math.max(0, scrollWidthCalculated - (containerRef.current.clientWidth || 800));
        const clampedScrollLeft = Math.max(0, Math.min(maxScroll, nextScrollLeft));

        setVisibleScrollLeftSync(clampedScrollLeft);
        containerRef.current.scrollLeft = clampedScrollLeft;
      }
    };

    const handleWindowMouseUp = () => {
      setIsDraggingTimeScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [
    isDraggingTimeScale, 
    candleSpacing, 
    margin.left, 
    margin.right, 
    candles.length, 
    scrollRightPadding,
    candleType
  ]);

  // S1: hoveredCandle/deltaValueText/cvdValueText derivation removed.
  // Delta/CVD overlay value spans now updated imperatively via refs in handleSvgMouseMove
  // so cursor movement no longer triggers a re-render of this entire component.

  useLayoutEffect(() => {
    // S2: install the freshest draw closure on each commit. Multiple state changes
    // in the same JS task all set the same drawRef and request one rAF — the canvas
    // is painted at most once per frame instead of once per setState.
    drawRef.current = () => {
    // ── FPS measurement (admin diagnostics, zero cost on hot-path) ──────────
    fpsFrameCountRef.current++;
    const _fpsnow = performance.now();
    const _fpsdt = _fpsnow - fpsLastTimeRef.current;
    if (_fpsdt >= 500) {
      fpsRef.current = Math.round(fpsFrameCountRef.current / (_fpsdt / 1000));
      fpsLastTimeRef.current = _fpsnow;
      fpsFrameCountRef.current = 0;
      if ((userRole ?? "").toLowerCase() === "admin") setFpsDisplay(fpsRef.current);
    }
    // ────────────────────────────────────────────────────────────────────────
    if (candles.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // S3: shadow `visibleScrollLeft` with the ref-current value so the body
    // (translate, culling, indicator coords) sees the real scroll position at
    // frame time, not the throttled React state. Body code stays unchanged.
    const visibleScrollLeft = visibleScrollLeftRef.current;

    // Fix #3: same shadow pattern for candleWidth + derivatives. Wheel handler
    // writes candleWidthRef synchronously, then calls drawRef.current() in the
    // same tick — before React commits setCandleWidth. Without these shadows,
    // body code would draw with the not-yet-committed STATE value while ref is
    // ahead, mixing geometries.
    const candleWidth = candleWidthRef.current;
    const candleSpacing = Math.max(1, candleWidth < 30 ? Math.floor(candleWidth * 0.35) : 12);
    const candleWidthSpacing = candleWidth + candleSpacing;
    const indexToX = (idx: number) => margin.left + idx * candleWidthSpacing;
    const scrollWidth = candles.length * candleWidthSpacing + margin.left + margin.right + scrollRightPadding;

    // Local ts<->px helpers built on the SAME shadow candleWidth as the candle
    // render. Render-body tsToX/tsToIndex close over React-state candleWidth,
    // which lags candleWidthRef by one frame during synchronous wheel zoom —
    // mixing those into drawings produces a 1-frame opposite-direction drift.
    // These are an exact clone of the render-body versions; formula must stay
    // identical (edge extrapolation by intervalMs, `span = tsHi - tsLo || intervalMs`).
    const tsToIndex_local = (ts: number): number => {
      const n = candles.length;
      if (n === 0) return 0;
      const firstTs = candles[0]!.timestamp;
      const lastTs = candles[n - 1]!.timestamp;
      if (ts <= firstTs) return (ts - firstTs) / intervalMs;
      if (ts >= lastTs) return (n - 1) + (ts - lastTs) / intervalMs;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (candles[mid]!.timestamp <= ts) lo = mid; else hi = mid - 1;
      }
      const tsLo = candles[lo]!.timestamp;
      const tsHi = candles[lo + 1]!.timestamp;
      const span = tsHi - tsLo || intervalMs;
      return lo + (ts - tsLo) / span;
    };
    const tsToX_local = (ts: number): number => indexToX(tsToIndex_local(ts));

    // Scale canvas for ultra-crisp Retina/High-DPI support using the visible viewport size to avoid exceeding browser canvas limits
    const dpr = window.devicePixelRatio || 1;
    const viewportWidth = visibleClientWidth || 800;
    canvas.width = viewportWidth * dpr;
    canvas.height = totalSvgHeight * dpr;
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${totalSvgHeight}px`;
    ctx.scale(dpr, dpr);

    ctx.textBaseline = "middle";

    // Clear and draw background (full viewport size)
    ctx.clearRect(0, 0, viewportWidth, totalSvgHeight);
    ctx.fillStyle = isLight ? "rgba(248, 250, 252, 0.15)" : "#06080f";
    ctx.fillRect(0, 0, viewportWidth, totalSvgHeight);

    // -------------------------------------------------------------------------
    // RENDER TRADINGVIEW-STYLE INTEGRATED CHART WATERMARK
    // -------------------------------------------------------------------------
    ctx.save();
    // Center it horizontally across the active visible candle plot area (excluding margins)
    const watermarkX = margin.left + (viewportWidth - margin.left - margin.right) / 2;
    // Center it vertically in the main candles chart height
    const watermarkY = margin.top + chartHeight / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Primary watermark string "PROCLUSTER"
    ctx.font = `bold 64px 'Space Grotesk', 'Inter', -apple-system, sans-serif`;
    ctx.fillStyle = isLight ? "rgba(15, 23, 42, 0.03)" : "rgba(255, 255, 255, 0.025)";
    ctx.fillText("PROCLUSTER", watermarkX, watermarkY - 14);

    // Secondary sub-line with active instrument details
    ctx.font = `600 12px 'JetBrains Mono', 'Fira Code', monospace`;
    ctx.fillStyle = isLight ? "rgba(15, 23, 42, 0.05)" : "rgba(255, 255, 255, 0.05)";
    const currentSymbol = activePair.symbol.toUpperCase();
    const currentMarket = marketType || "SPOT";
    ctx.fillText(`${currentSymbol} • ${currentMarket} • 1M`, watermarkX, watermarkY + 28);
    ctx.restore();
    // -------------------------------------------------------------------------

    // Save context and apply translation for scroll-relative elements
    ctx.save();
    ctx.translate(-visibleScrollLeft, 0);

    // 1. Horizontal Grid Lines (Removed per user request to hide minor horizontal grid)

    // Solid horizontal separators: between main chart and the first footer panel, and
    // between each pair of stacked footer panels. Order-independent (driven by panelTopY).
    if (activePanels.length > 0) {
      ctx.strokeStyle = isLight ? "rgba(148, 163, 184, 0.35)" : "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 1.0;
      const sepY = Math.round(margin.top + chartHeight) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, sepY);
      ctx.lineTo(scrollWidth, sepY);
      ctx.stroke();
      for (let i = 1; i < activePanels.length; i++) {
        const dy = Math.round(panelTopY[activePanels[i]]) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, dy);
        ctx.lineTo(scrollWidth, dy);
        ctx.stroke();
      }
    }

    // 2. Real-time active price tracker tag on chart grid
    if (currentPrice !== undefined) {
      const activePriceY = priceToY(currentPrice);
      if (activePriceY >= margin.top && activePriceY <= margin.top + chartHeight) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
        ctx.lineWidth = 1.0;
        ctx.setLineDash([2, 2]);

        const latestCandleIdx = Math.max(0, candles.length - 1);
        const startX = Math.round(margin.left + latestCandleIdx * (candleWidth + candleSpacing) + candleWidth / 2) + 0.5;
        const snappedPriceY = Math.round(activePriceY) + 0.5;

        ctx.moveTo(startX, snappedPriceY);
        ctx.lineTo(scrollWidth, snappedPriceY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 3. Draw Aggregated Session Profile on the left side of the chart (fixed on screen, so translate-invariant)
    if (activeIndicators.volume) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left + visibleScrollLeft, margin.top, viewportWidth, chartHeight);
      ctx.clip();

      profileBuckets.forEach((bucket) => {
        const bWidth = (bucket.volume / maxProfileVol) * 65;
        const bY = priceToY(bucket.price) - (profileBucketSize / (maxPrice - minPrice)) * chartHeight / 2;
        const bHeight = Math.max(2, (profileBucketSize / (maxPrice - minPrice)) * chartHeight - 1.5);
        
        ctx.fillStyle = isLight ? "rgba(71, 85, 105, 0.1)" : "rgba(148, 163, 184, 0.08)";
        ctx.fillRect(margin.left + visibleScrollLeft, bY, bWidth, bHeight);

        ctx.strokeStyle = isLight ? "rgba(71, 85, 105, 0.2)" : "rgba(148, 163, 184, 0.18)";
        ctx.lineWidth = 0.8;
        ctx.strokeRect(margin.left + visibleScrollLeft, bY, bWidth, bHeight);
      });
      ctx.restore();
    }

    // 3.1 Draw BACKGROUND-LAYER INTERACTIVE DRAWING OBJECTS (e.g. Range Volume Profile)
    // Always drawn under candles, wicks, and cluster cells per user request
    drawDrawingObjects(ctx, {
      ctx,
      drawings: areDrawingsVisible ? drawings : [],
      drawingInProgress,
      selectedDrawingId,
      visibleScrollLeft,
      viewportWidth,
      chartHeight,
      margin,
      isLight,
      priceToY,
      activePair,
      clusterStep: effectiveStep,
      candles,
      candleWidth,
      candleSpacing,
      layer: "background",
      language,
      tsToX: tsToX_local,
      tsToIndex: tsToIndex_local,
    });

    const startIdx = Math.max(0, Math.floor((visibleScrollLeft - margin.left - candleWidth) / (candleWidth + candleSpacing)));
    const endIdx = Math.min(candles.length - 1, Math.ceil((visibleScrollLeft + viewportWidth - margin.left) / (candleWidth + candleSpacing)));
    const visibleCandlesCount = endIdx - startIdx + 1;
    const hideFootprintNumbers = visibleCandlesCount > 70 || hideClusterNumbers;

    // R: visibleMaxCellVol / visibleMaxSingleVol were three chained useMemos that
    // refired every throttled scroll-state push. They are consumed only here —
    // computed inline in one pass over the visible range, skipped entirely when
    // not in detailed/cluster/footprint mode (japanese / bars don't read them).
    let visibleMaxCellVol = 1;
    let visibleMaxSingleVol = 1;
    let visibleMaxAbsDelta = 1;
    if (isDetailedMode) {
      for (let cIdx = startIdx; cIdx <= endIdx; cIdx++) {
        const cells = candles[cIdx]?.cells;
        if (!cells) continue;
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          if (cell.volume > visibleMaxCellVol) visibleMaxCellVol = cell.volume;
          if (cell.bid > visibleMaxSingleVol) visibleMaxSingleVol = cell.bid;
          if (cell.ask > visibleMaxSingleVol) visibleMaxSingleVol = cell.ask;
          const absDelta = Math.abs(cell.ask - cell.bid);
          if (absDelta > visibleMaxAbsDelta) visibleMaxAbsDelta = absDelta;
        }
      }
    }

    // D: vertical daily-session separators removed. The loop called
    // toLocaleDateString twice per visible candle (~80 µs each), eating ~91%
    // of every draw (47 ms of 51 ms at 275 visible; ~160 ms at 1000 visible).
    // Feature deemed unnecessary by product. Time-axis labels below the chart
    // still show the date when hovered, so users never lose date context.

    // Pre-calculate visible max total candle volume for scaling volumeOnChart
    let visibleMaxCandleVolume = 1;
    for (let cIdx = startIdx; cIdx <= endIdx; cIdx++) {
      if (candles[cIdx] && candles[cIdx].volume > visibleMaxCandleVolume) {
        visibleMaxCandleVolume = candles[cIdx].volume;
      }
    }

    // --- DRAW ATAS STACKED IMBALANCE HORIZONTAL LEVEL OVERLAYS ---
    if (activeIndicators.stackedImbalance && stackedImbalanceLines.length > 0) {
      ctx.save();
      ctx.beginPath();
      // Clip strictly within main candlestick screen area bounded by margin and chartHeight
      ctx.rect(margin.left, margin.top, scrollWidth - margin.left + 50, chartHeight);
      ctx.clip();

      stackedImbalanceLines.forEach(line => {
        // Calculate horizontal starting X-coordinate (center of the candle)
        const xStart = margin.left + line.startIdx * (candleWidth + candleSpacing) + candleWidth / 2;
        // Calculate ending X-coordinate (center of mitigation candle, or right edge of chart)
        const xEnd = line.endIdx !== null 
          ? (margin.left + line.endIdx * (candleWidth + candleSpacing) + candleWidth / 2)
          : (scrollWidth);
        
        const y = priceToY(line.price);
        
        ctx.beginPath();
        ctx.strokeStyle = line.color;
        ctx.lineWidth = siLineWidth;
        ctx.moveTo(xStart, y);
        ctx.lineTo(xEnd, y);
        ctx.stroke();

        if (line.endIdx !== null) {
          // Mitigated level: Draw a small aesthetic termination dot at the point of touching
          ctx.beginPath();
          ctx.fillStyle = line.color;
          ctx.arc(xEnd, y, siLineWidth * 1.5, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          // Unmitigated level: Draw small text indicator "SI <Price>" at the right edge
          ctx.font = "bold 9px 'JetBrains Mono', monospace";
          ctx.fillStyle = line.color;
          ctx.textAlign = "left";
          ctx.fillText(`SI ${line.price.toFixed(1)}`, xEnd + 5, y + 3);
        }
      });

      ctx.restore();
    }

    // 4. Draw each visible candlestick
    for (let cIdx = startIdx; cIdx <= endIdx; cIdx++) {
      const candle = candles[cIdx];
      const x = margin.left + cIdx * (candleWidth + candleSpacing);
      const xL = Math.round(x);
      const xR = Math.round(x + candleWidth);
      const candleW = Math.max(1, xR - xL);
      const bodyY1 = priceToY(Math.max(candle.open, candle.close));
      const bodyY2 = priceToY(Math.min(candle.open, candle.close));
      const isGreen = candle.close >= candle.open;

      const candleCells = candle.cells || [];
      // S3: dead POC block removed — `activePocPrice` was computed every frame
      // for every visible candle (filter + reduce over ALL cells) and never read
      // anywhere. Pure GC pressure. Verified by repo-wide grep before removal.

      // S1: hovered-column derivation removed from main draw — was only computed,
      // never consumed. Column highlight now lives on overlay canvas (drawOverlay).

      // Column alignment gridline removed per user request to hide minor background grids

      // Clip candlesticks, footprints and any extra overflow elements to the main chart region [margin.top, margin.top + chartHeight]
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, margin.top, scrollWidth - margin.left + 50, chartHeight);
      ctx.clip();

       // Draw volumeOnChart background histogram if active
       if (activeIndicators && activeIndicators.volumeOnChart) {
         const vocSettings = indicatorSettings?.volumeOnChart || {};
         const deltaThreshold = vocSettings.volumeOnChartDeltaThreshold ?? volumeOnChartIndicator.defaultSettings.volumeOnChartDeltaThreshold;
         const maxHPercent = vocSettings.volumeOnChartMaxHeightPercent ?? volumeOnChartIndicator.defaultSettings.volumeOnChartMaxHeightPercent;
         const vocOpacity = vocSettings.opacity != null ? vocSettings.opacity : volumeOnChartIndicator.defaultSettings.opacity;

         const barH = volumeOnChartIndicator.calculateBarHeight(candle.volume, visibleMaxCandleVolume, chartHeight, maxHPercent);
         const baseY = margin.top + chartHeight;
         const barY = baseY - barH;

         const { fillStyle, strokeStyle } = volumeOnChartIndicator.getStyles(candle.delta, deltaThreshold, isLight);

         ctx.save();
         ctx.globalAlpha = vocOpacity;
         ctx.fillStyle = fillStyle;
         ctx.strokeStyle = strokeStyle;
         ctx.lineWidth = 1.0;

         ctx.fillRect(x + 1, barY, candleWidth - 2, barH);
         ctx.strokeRect(x + 1, barY, candleWidth - 2, barH);
         ctx.restore();
       }

      // Determine colors based on palette
      const useAltPalette = candlePalette === "alternative";
      const bullFill = useAltPalette 
        ? "#E3E3E3" 
        : "#10b981";
      const bullBorder = useAltPalette 
        ? "#909090" 
        : "#10b981";
      const bullWick = useAltPalette 
        ? "#9D9D9D" 
        : "#10b981";

      const bearFill = useAltPalette 
        ? "#665D5D" 
        : "#de3538";
      const bearBorder = useAltPalette 
        ? "#858585" 
        : "#de3538";
      const bearWick = useAltPalette 
        ? "#9B9B9B" 
        : "#de3538";

      const candleFillColor = isGreen ? bullFill : bearFill;
      const candleBorderColor = isGreen ? bullBorder : bearBorder;
      const candleWickColor = isGreen ? bullWick : bearWick;

      // Draw vertical wick lines (pixel-snapped)
      ctx.strokeStyle = candleWickColor;
      ctx.lineWidth = 1.0;
      ctx.globalAlpha = isDetailedMode ? (showCandleOutline ? 0.45 : 0.0) : 0.85;
      const wickX = Math.round(x + candleWidth / 2) + 0.5;
      if (candleType !== "bars") {
        if (isDetailedMode) {
          // In detailed/clusters/footprint mode: draw only upper/lower tails, skip body
          const wickHighY = Math.round(priceToY(candle.high)) + 0.5;
          const wickLowY = Math.round(priceToY(candle.low)) + 0.5;
          const wickBodyTopY = Math.round(priceToY(Math.max(candle.open, candle.close))) + 0.5;
          const wickBodyBotY = Math.round(priceToY(Math.min(candle.open, candle.close))) + 0.5;
          // Upper tail: high → top of body
          ctx.beginPath();
          ctx.moveTo(wickX, wickHighY);
          ctx.lineTo(wickX, wickBodyTopY);
          ctx.stroke();
          // Lower tail: bottom of body → low
          ctx.beginPath();
          ctx.moveTo(wickX, wickBodyBotY);
          ctx.lineTo(wickX, wickLowY);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(wickX, Math.round(priceToY(candle.high)) + 0.5);
          ctx.lineTo(wickX, Math.round(priceToY(candle.low)) + 0.5);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1.0; // Reset

      // A. Zoomed out simple candlestick or OHLC bar
      if (!isDetailedMode) {
        if (effectiveCandleType === "bars") {
          const barCenterX = Math.round(x + candleWidth / 2) + 0.5;
          const barHighY = Math.round(priceToY(candle.high)) + 0.5;
          const barLowY = Math.round(priceToY(candle.low)) + 0.5;
          const barOpenY = Math.round(priceToY(candle.open)) + 0.5;
          const barCloseY = Math.round(priceToY(candle.close)) + 0.5;
          ctx.strokeStyle = candleBorderColor;
          ctx.lineWidth = Math.max(1, Math.min(3, Math.round(candleWidth * 0.15)));
          const barTickLen = Math.max(2, Math.round(candleWidth / 2));
          // Vertical high-low line
          ctx.beginPath();
          ctx.moveTo(barCenterX, barHighY);
          ctx.lineTo(barCenterX, barLowY);
          ctx.stroke();
          // Left tick (open)
          ctx.beginPath();
          ctx.moveTo(barCenterX - barTickLen, barOpenY);
          ctx.lineTo(barCenterX, barOpenY);
          ctx.stroke();
          // Right tick (close)
          ctx.beginPath();
          ctx.moveTo(barCenterX, barCloseY);
          ctx.lineTo(barCenterX + barTickLen, barCloseY);
          ctx.stroke();
        } else {
          ctx.fillStyle = candleFillColor;
          ctx.strokeStyle = candleBorderColor;
          ctx.lineWidth = 1.0;
          
          const bodyYtop = Math.round(Math.min(bodyY1, bodyY2));
          const bodyYbot = Math.round(Math.max(bodyY1, bodyY2));
          const bodyH = Math.max(3, bodyYbot - bodyYtop);
          
          ctx.fillRect(xL, bodyYtop, candleW, bodyH);
          ctx.strokeRect(xL + 0.5, bodyYtop + 0.5, candleW, bodyH);
        }
      }

      // B. Zoomed in Footprint detailed view
      if (isDetailedMode) {
        // Find maximums for normalization
        let candleMaxTotalVol = 1;
        let candleMaxSingleVal = 1;
        for (let i = 0; i < candleCells.length; i++) {
          const cell = candleCells[i];
          if (cell.volume > candleMaxTotalVol) {
            candleMaxTotalVol = cell.volume;
          }
          if (cell.bid > candleMaxSingleVal) {
            candleMaxSingleVal = cell.bid;
          }
          if (cell.ask > candleMaxSingleVal) {
            candleMaxSingleVal = cell.ask;
          }
        }
        const isClustersMode = candleType === "clusters";

        // Place the vertical separator/spine exactly in the center for symmetrical Bid/Ask columns
        const sepX = Math.round(x + candleWidth / 2);

        // 1. Draw elegant thin candlestick body core container outline box surrounding the open-close range (matches user screenshot)
        const outlineTopY = Math.round(priceToY(Math.max(candle.open, candle.close)));
        const outlineBotY = Math.round(priceToY(Math.min(candle.open, candle.close)));
        const outlineH = Math.max(3, outlineBotY - outlineTopY);
        
        ctx.strokeStyle = isGreen 
          ? (useAltPalette
              ? (isLight ? "rgba(47, 47, 47, 0.45)" : "rgba(213, 213, 213, 0.40)")
              : (isLight ? "rgba(16, 185, 129, 0.45)" : "rgba(16, 185, 129, 0.40)"))
          : (useAltPalette
              ? (isLight ? "rgba(58, 58, 58, 0.45)" : "rgba(174, 167, 167, 0.40)")
              : (isLight ? "rgba(239, 68, 68, 0.45)" : "rgba(239, 68, 68, 0.40)"));
        ctx.lineWidth = 1.0;
        if (showCandleOutline) {
          ctx.strokeRect(xL + 0.5, outlineTopY + 0.5, candleW, outlineH);
        }

        candleCells.forEach((cell, cellIdx) => {
          const cellBelow = candleCells[cellIdx + 1];
          const cellAbove = candleCells[cellIdx - 1];

          const isDiagonalBuyImbalance = !!(cellBelow && cell.ask > cellBelow.bid * 3.0 && cell.ask > 0);
          const isDiagonalSellImbalance = !!(cellAbove && cell.bid > cellAbove.ask * 3.0 && cell.bid > 0);

          const yTop = priceToY(cell.price + effectiveStep);
          const yBottom = priceToY(cell.price);
          const yTopR = Math.round(yTop);
          const yBotR = Math.round(yBottom);
          const cellHR = Math.max(1, yBotR - yTopR);

          const isCellPoc = cell.isPoc;

          // Compute volume normalization ratios
          const maxValSingle = visibleMaxSingleVol;
          const bidRatio = cell.bid > 0 ? cell.bid / maxValSingle : 0;
          const askRatio = cell.ask > 0 ? cell.ask / maxValSingle : 0;
          const volRatio = cell.volume > 0 ? cell.volume / visibleMaxCellVol : 0;

          // Double check Cluster Search parameters
          const csSettings = indicatorSettings?.clusterSearch || {
            mode: "Volume",
            direction: "Both",
            location: "Any",
            sensitivity: 4,
            useMinMax: false
          };
          const csSensitivity = typeof csSettings.sensitivity === "number" ? csSettings.sensitivity : 4;
          const sensFactor = 1 - csSensitivity * 0.06;
          const baseVolumeThreshold = maxCellVolume * sensFactor;

          let matchesClusterSearch = false;
          if (activeIndicators.clusterSearch) {
            let isTargetMode = false;
            if (csSettings.mode === "Delta") {
              const cellDelta = Math.abs(cell.ask - cell.bid);
              isTargetMode = cellDelta >= maxCellDelta * sensFactor;
            } else {
              isTargetMode = cell.volume >= baseVolumeThreshold;
            }

            let isTargetDirection = true;
            if (csSettings.direction === "Buy") {
              isTargetDirection = cell.ask > cell.bid;
            } else if (csSettings.direction === "Sell") {
              isTargetDirection = cell.bid > cell.ask;
            }

            let isTargetLocation = true;
            if (csSettings.location === "Body") {
              const isGreenBody = candle.close >= candle.open;
              const highBody = isGreenBody ? candle.close : candle.open;
              const lowBody = isGreenBody ? candle.open : candle.close;
              isTargetLocation = cell.price <= highBody && cell.price >= lowBody;
            } else if (csSettings.location === "Wick") {
              const isGreenBody = candle.close >= candle.open;
              const highBody = isGreenBody ? candle.close : candle.open;
              const lowBody = isGreenBody ? candle.open : candle.close;
              isTargetLocation = cell.price > highBody || cell.price < lowBody;
            }
            matchesClusterSearch = isTargetMode && isTargetDirection && isTargetLocation;
          }

          // A. Draw Cell Background Fills (Bid left, Ask right)
          if (candleDataType === "bid_ask") {
            // Keep backgrounds completely transparent like the screenshot for that neat, elegant footprint style and only use light lines
            ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.02)" : "rgba(255, 255, 255, 0.02)";
            ctx.lineWidth = 1.0;
            ctx.strokeRect(xL + 0.5, yTopR + 0.5, candleW, cellHR);
          } else if (candleDataType === "delta") {
            ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.02)" : "rgba(255, 255, 255, 0.02)";
            ctx.lineWidth = 1.0;
            ctx.strokeRect(xL + 0.5, yTopR + 0.5, candleW, cellHR);
          } else if (candleDataType === "volume") {
            ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.02)" : "rgba(255, 255, 255, 0.02)";
            ctx.lineWidth = 1.0;
            ctx.strokeRect(xL + 0.5, yTopR + 0.5, candleW, cellHR);
          }

          // B. Draw Beautiful Outward Growing Horizontal Profile Bars (Exactly matches the user screenshot)
          if (isClustersMode && candleDataType === "bid_ask") {
            const maxBarWidth = Math.round((candleW / 2) * 0.90);
            const bidBarWidth = cell.bid > 0 ? (cell.bid / maxValSingle) * maxBarWidth : 0;
            const askBarWidth = cell.ask > 0 ? (cell.ask / maxValSingle) * maxBarWidth : 0;

            const bidRatioClamped = Math.min(1.0, Math.max(0.0, bidRatio));
            const askRatioClamped = Math.min(1.0, Math.max(0.0, askRatio));

            // Histograms grow from the center line/spine (sepX) to both sides, corresponding to bids/asks volumes
            if (bidBarWidth > 0) {
              const op = isLight 
                ? (0.06 + bidRatioClamped * 0.68) 
                : (0.10 + bidRatioClamped * 0.85);
              ctx.fillStyle = useAltPalette
                ? `rgba(244, 63, 94, ${op})`
                : (isLight ? `rgba(220, 38, 38, ${op})` : `rgba(239, 68, 68, ${op})`);
              ctx.fillRect(Math.round(sepX - bidBarWidth), yTopR, Math.max(1, Math.round(bidBarWidth)), cellHR);
            }
            if (askBarWidth > 0) {
              const op = isLight
                ? (0.06 + askRatioClamped * 0.68)
                : (0.10 + askRatioClamped * 0.85);
              ctx.fillStyle = useAltPalette
                ? `rgba(16, 185, 129, ${op})`
                : (isLight ? `rgba(22, 163, 74, ${op})` : `rgba(16, 185, 129, ${op})`);
              ctx.fillRect(sepX, yTopR, Math.max(1, Math.round(askBarWidth)), cellHR);
            }
          } else if (isClustersMode && candleDataType === "volume") {
            const maxBarWidth = Math.round((candleW / 2) * 0.90);
            const volRatioBar = visibleMaxCellVol > 0 && cell.volume > 0
              ? cell.volume / visibleMaxCellVol
              : 0;
            const halfWidth = volRatioBar * maxBarWidth;
            if (halfWidth > 0) {
              const cellDeltaVal = cell.ask - cell.bid;
              const barIsBuy = cellDeltaVal >= 0;
              const op = isLight
                ? (0.06 + volRatioBar * 0.68)
                : (0.10 + volRatioBar * 0.95);
              ctx.fillStyle = useAltPalette
                ? (barIsBuy ? `rgba(16, 185, 129, ${op})` : `rgba(244, 63, 94, ${op})`)
                : barIsBuy
                  ? (isLight ? `rgba(22, 163, 74, ${op})` : `rgba(16, 185, 129, ${op})`)
                  : (isLight ? `rgba(220, 38, 38, ${op})` : `rgba(239, 68, 68, ${op})`);
              const w = Math.max(1, Math.round(halfWidth));
              ctx.fillRect(Math.round(sepX - halfWidth), yTopR, w, cellHR);
              ctx.fillRect(sepX, yTopR, w, cellHR);
            }
          } else if (isClustersMode && candleDataType === "delta") {
            const cellDeltaVal = cell.ask - cell.bid;
            const absDelta = Math.abs(cellDeltaVal);
            const maxBarWidth = Math.round((candleW / 2) * 0.90);
            const deltaRatioBar = visibleMaxAbsDelta > 0 && absDelta > 0
              ? absDelta / visibleMaxAbsDelta
              : 0;
            const barWidth = deltaRatioBar * maxBarWidth;
            if (barWidth > 0 && cellDeltaVal !== 0) {
              const barIsBuy = cellDeltaVal > 0;
              const op = isLight
                ? (0.06 + deltaRatioBar * 0.68)
                : (0.10 + deltaRatioBar * 0.95);
              ctx.fillStyle = useAltPalette
                ? (barIsBuy ? `rgba(16, 185, 129, ${op})` : `rgba(244, 63, 94, ${op})`)
                : barIsBuy
                  ? (isLight ? `rgba(22, 163, 74, ${op})` : `rgba(16, 185, 129, ${op})`)
                  : (isLight ? `rgba(220, 38, 38, ${op})` : `rgba(239, 68, 68, ${op})`);
              const w = Math.max(1, Math.round(barWidth));
              if (barIsBuy) {
                ctx.fillRect(sepX, yTopR, w, cellHR);
              } else {
                ctx.fillRect(Math.round(sepX - barWidth), yTopR, w, cellHR);
              }
            }
          } else if (candleDataType === "delta") {
            const cellDeltaVal = cell.ask - cell.bid;
            const absDelta = Math.abs(cellDeltaVal);
            const maxBarWidth = candleW - 2;
            const deltaRatioBar = visibleMaxAbsDelta > 0 ? absDelta / visibleMaxAbsDelta : 0;
            const barWidth = absDelta > 0 ? deltaRatioBar * maxBarWidth : 0;
            if (barWidth > 0) {
              const barIsBuy = cellDeltaVal > 0;
              const op = isLight
                ? (0.06 + deltaRatioBar * 0.68)
                : (0.10 + deltaRatioBar * 0.95);
              ctx.fillStyle = useAltPalette
                ? (barIsBuy ? `rgba(16, 185, 129, ${op})` : `rgba(244, 63, 94, ${op})`)
                : barIsBuy
                  ? (isLight ? `rgba(22, 163, 74, ${op})` : `rgba(16, 185, 129, ${op})`)
                  : (isLight ? `rgba(220, 38, 38, ${op})` : `rgba(239, 68, 68, ${op})`);
              ctx.fillRect(xL + 1, yTopR, Math.max(1, Math.round(barWidth)), cellHR);
            }
          } else {
            const maxBarWidth = candleW - 2;
            const barWidth = cell.volume > 0 ? (cell.volume / visibleMaxCellVol) * maxBarWidth : 0;
            if (barWidth > 0) {
              const barIsBuy = cell.ask > cell.bid;
              const volRatioBar = cell.volume / visibleMaxCellVol;
              const op = isLight
                ? (0.06 + volRatioBar * 0.68)
                : (0.10 + volRatioBar * 0.95);
              ctx.fillStyle = useAltPalette
                ? (barIsBuy ? `rgba(16, 185, 129, ${op})` : `rgba(244, 63, 94, ${op})`)
                : barIsBuy
                  ? (isLight ? `rgba(22, 163, 74, ${op})` : `rgba(16, 185, 129, ${op})`)
                  : (isLight ? `rgba(220, 38, 38, ${op})` : `rgba(239, 68, 68, ${op})`);
              ctx.fillRect(xL + 1, yTopR, Math.max(1, Math.round(barWidth)), cellHR);
            }
          }

          // C. Highlight Diagonal Buy / Sell Imbalance rows removed at user's request (only keep histograms)

          // D. Highlight Point of Control (POC) removed at user request

          // Old Cluster Search outline replaced by new beautiful shapes rendering

          // Stacked imbalance outline highlights removed at user request

          // Bid Ask standard text rendering or delta/volume mode
          if (cellHR >= 8.0 && !hideFootprintNumbers) {
            ctx.save();
            ctx.shadowColor = isLight ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.9)";
            ctx.shadowBlur = 1.0;
            ctx.shadowOffsetX = 0.5;
            ctx.shadowOffsetY = 0.5;
            ctx.textBaseline = "middle";

            // Intelligent adaptive precision volume formatter - prevents BTC/ETH cell numbers from showing as empty "0.0 x 0.0"
            const getFormatter = (maxSingleVal: number) => {
              if (maxSingleVal < 0.1) return (v: number) => v === 0 ? "0" : v.toFixed(4);
              if (maxSingleVal < 1.0) return (v: number) => v === 0 ? "0" : v.toFixed(3);
              if (maxSingleVal < 10.0) return (v: number) => v === 0 ? "0" : v.toFixed(2);
              if (maxSingleVal < 100.0) return (v: number) => v === 0 ? "0" : v.toFixed(1);
              return (v: number) => v === 0 ? "0" : v.toFixed(0);
            };

            const baseFmt = getFormatter(visibleMaxSingleVol);
            // When the "abbreviate numbers" option is on, magnitudes >=1000 collapse to к/м (k/m);
            // values <1000 (and 0) keep the exact toFixed output. Sign handled by callers.
            const fmt = abbreviateNumbers
              ? (v: number) => (Math.abs(v) >= 1000 ? abbreviateNum(v, language) : baseFmt(v))
              : baseFmt;
            const bidValStr = fmt(cell.bid);
            const askValStr = fmt(cell.ask);
            const cellDeltaVal = cell.ask - cell.bid;
            const deltaDisplayStr = (cellDeltaVal > 0 ? "+" : cellDeltaVal < 0 ? "-" : "") + fmt(Math.abs(cellDeltaVal));
            const volStr = fmt(cell.volume);

             const ratioBid = candleMaxSingleVal > 0 ? (cell.bid / candleMaxSingleVal) : 0;
             const ratioAsk = candleMaxSingleVal > 0 ? (cell.ask / candleMaxSingleVal) : 0;
 
             const tBid = Math.pow(Math.min(1.0, Math.max(0.0, ratioBid)), 0.7);
             const tAsk = Math.pow(Math.min(1.0, Math.max(0.0, ratioAsk)), 0.7);
 
             let bidCol = "";
             if (isLight) {
               if (isDiagonalSellImbalance) {
                 const r = Math.round(195 + (180 - 195) * tBid);
                 const g = Math.round(170 + (30 - 170) * tBid);
                 const b = Math.round(170 + (40 - 170) * tBid);
                 bidCol = `rgb(${r}, ${g}, ${b})`;
               } else {
                 const r = Math.round(180 + (15 - 180) * tBid);
                 const g = Math.round(190 + (23 - 190) * tBid);
                 const b = Math.round(204 + (42 - 204) * tBid);
                 bidCol = `rgb(${r}, ${g}, ${b})`;
               }
             } else {
               if (isDiagonalSellImbalance) {
                 const r = Math.round(80 + (255 - 80) * tBid);
                 const g = Math.round(50 + (51 - 50) * tBid);
                 const b = Math.round(55 + (85 - 55) * tBid);
                 bidCol = `rgb(${r}, ${g}, ${b})`;
               } else {
                 const r = Math.round(65 + (255 - 65) * tBid);
                 const g = Math.round(78 + (255 - 78) * tBid);
                 const b = Math.round(92 + (255 - 92) * tBid);
                 bidCol = `rgb(${r}, ${g}, ${b})`;
               }
             }
 
             let askCol = "";
             if (isLight) {
               if (isDiagonalBuyImbalance) {
                 const r = Math.round(170 + (15 - 170) * tAsk);
                 const g = Math.round(195 + (120 - 195) * tAsk);
                 const b = Math.round(175 + (50 - 175) * tAsk);
                 askCol = `rgb(${r}, ${g}, ${b})`;
               } else {
                 const r = Math.round(180 + (15 - 180) * tAsk);
                 const g = Math.round(190 + (23 - 190) * tAsk);
                 const b = Math.round(204 + (42 - 204) * tAsk);
                 askCol = `rgb(${r}, ${g}, ${b})`;
               }
             } else {
               if (isDiagonalBuyImbalance) {
                 const r = Math.round(55 + (0 - 55) * tAsk);
                 const g = Math.round(80 + (245 - 80) * tAsk);
                 const b = Math.round(65 + (140 - 65) * tAsk);
                 askCol = `rgb(${r}, ${g}, ${b})`;
               } else {
                 const r = Math.round(65 + (255 - 65) * tAsk);
                 const g = Math.round(78 + (255 - 78) * tAsk);
                 const b = Math.round(92 + (255 - 92) * tAsk);
                 askCol = `rgb(${r}, ${g}, ${b})`;
               }
             }

            const textToMeasure = candleDataType === "bid_ask"
              ? `${bidValStr}x${askValStr}`
              : (candleDataType === "delta" ? deltaDisplayStr : volStr);
            const textLength = Math.max(1, textToMeasure.length);

            // Compute font sizes matching height and width perfectly, allowing vertical stretch scalability
            let idealSize = Math.max(5, Math.floor(cellHR * 0.72));
            const maxByWidth = Math.max(7, Math.floor((candleW - 4) / (textLength * 0.55)));
            let finalFontSize = Math.min(idealSize, maxByWidth);
            // If the user stretched clusters vertically, allow font to upscale independently of narrow width restriction
            if (cellHR > 24) {
              finalFontSize = Math.max(finalFontSize, Math.min(16, Math.floor(cellHR * 0.65)));
            }
            if (finalFontSize < 5) finalFontSize = 5;
            if (finalFontSize > 28) finalFontSize = 28;
            const fontSizeVal = `${finalFontSize}px`;
            ctx.font = `normal ${fontSizeVal} 'Inter', -apple-system, system-ui, sans-serif`;

            const drawCenteredBidAsk = (targetX: number, targetY: number) => {
              ctx.textAlign = "center";
              const separator = "x";
              const bidW = ctx.measureText(bidValStr).width;
              const sepW = ctx.measureText(separator).width;
              const askW = ctx.measureText(askValStr).width;
              // Slightly larger gap (widened) for beautiful readability across modes
              const gap = Math.max(3.5, finalFontSize * 0.32);
              const totalW = bidW + sepW + askW + gap * 2;

              const startX = targetX - totalW / 2;

              ctx.textAlign = "left";
              ctx.fillStyle = isCellPoc ? (isLight ? "#0f172a" : "#ffffff") : bidCol;
              ctx.fillText(bidValStr, startX, targetY);

              ctx.fillStyle = isCellPoc
                ? (isLight ? "rgba(15, 23, 42, 0.5)" : "rgba(255, 255, 255, 0.6)")
                : (isLight ? "rgba(15, 23, 42, 0.45)" : "rgba(255, 255, 255, 0.55)");
              ctx.fillText(separator, startX + bidW + gap, targetY);

              ctx.fillStyle = isCellPoc ? (isLight ? "#0f172a" : "#ffffff") : askCol;
              ctx.fillText(askValStr, startX + bidW + sepW + gap * 2, targetY);
            };

            const centerTextX = x + candleWidth / 2;

            if (isCellPoc) {
              // High contrast text on POC background (dark for light theme, white for dark theme)
              const pocTextCol = isLight ? "#0f172a" : "#ffffff";
              ctx.fillStyle = pocTextCol;
              if (candleDataType === "bid_ask") {
                if (candleWidth >= 35) {
                  drawCenteredBidAsk(centerTextX, yTopR + cellHR / 2);
                }
              } else if (candleDataType === "delta") {
                ctx.textAlign = "center";
                ctx.fillText(deltaDisplayStr, centerTextX, yTopR + cellHR / 2);
              } else if (candleDataType === "volume") {
                ctx.textAlign = "center";
                ctx.fillText(volStr, centerTextX, yTopR + cellHR / 2);
              }
            } else {
              // Non-POC cells: Color depending on display type
              if (candleDataType === "bid_ask") {
                if (candleWidth >= 35) {
                  drawCenteredBidAsk(centerTextX, yTopR + cellHR / 2);
                }
              } else if (candleDataType === "delta") {
                ctx.fillStyle = isLight
                  ? (cellDeltaVal > 0 ? "#047857" : cellDeltaVal < 0 ? "#b91c1c" : "#475569")
                  : (cellDeltaVal > 0 ? "#10b981" : cellDeltaVal < 0 ? "#ef4444" : "#94a3b8");
                ctx.textAlign = "center";
                ctx.fillText(deltaDisplayStr, centerTextX, yTopR + cellHR / 2);
              } else if (candleDataType === "volume") {
                ctx.fillStyle = isLight ? "#1e293b" : "#cbd5e1";
                ctx.textAlign = "center";
                ctx.fillText(volStr, centerTextX, yTopR + cellHR / 2);
              }
            }
            ctx.restore();
          }
        });

        // Value Area Bracket removed at user request
          // No VAH/VAL vertical bracket lines
      }

      // --- DYNAMIC CLUSTER SEARCH (GEOMETRIC MULTI-LEVEL VISUALIZER) ---
      if (activeIndicators.clusterSearch && candleCells.length > 0) {
        const csSettings = indicatorSettings?.clusterSearch || {};
        
        const csMergeLevels = typeof csSettings.csMergeLevels === "number" ? csSettings.csMergeLevels : 1;
        const csImbalancePercent = typeof csSettings.csImbalancePercent === "number" ? csSettings.csImbalancePercent : 60;
        
        // Medium Filter
        const csMedMinVolume = typeof csSettings.csMedMinVolume === "number" ? csSettings.csMedMinVolume : 100;
        const csMedMaxVolume = typeof csSettings.csMedMaxVolume === "number" ? csSettings.csMedMaxVolume : 500;
        const csMedMinSize = typeof csSettings.csMedMinSize === "number" ? csSettings.csMedMinSize : 4;
        const csMedMaxSize = typeof csSettings.csMedMaxSize === "number" ? csSettings.csMedMaxSize : 12;
        const csMedShape = csSettings.csMedShape || "circle";
        const csMedColorBid = csSettings.csMedColorBid || "#ef4444";
        const csMedColorAsk = csSettings.csMedColorAsk || "#10b981";
        const csMedOpacity = typeof csSettings.csMedOpacity === "number" ? csSettings.csMedOpacity : 0.70;
        
        // Large Filter
        const csLargeMinVolume = typeof csSettings.csLargeMinVolume === "number" ? csSettings.csLargeMinVolume : 500;
        const csLargeMinSize = typeof csSettings.csLargeMinSize === "number" ? csSettings.csLargeMinSize : 10;
        const csLargeMaxSize = typeof csSettings.csLargeMaxSize === "number" ? csSettings.csLargeMaxSize : 20;
        const csLargeShape = csSettings.csLargeShape || "rhombus";
        const csLargeColorBid = csSettings.csLargeColorBid || "#f43f5e";
        const csLargeColorAsk = csSettings.csLargeColorAsk || "#34d399";
        const csLargeOpacity = typeof csSettings.csLargeOpacity === "number" ? csSettings.csLargeOpacity : 0.90;

        const sortedCells = [...candleCells].sort((a, b) => b.price - a.price);
        const maxBody = Math.max(candle.open, candle.close);
        const minBody = Math.min(candle.open, candle.close);

        const itemsToDraw: Array<{
          price: number;
          color: string;
          shape: "circle" | "square" | "rhombus";
          opacity: number;
          size: number;
        }> = [];

        // 1. Medium filter match
        const csMedEnabled = csSettings.csMedEnabled !== false;
        if (csMedEnabled) {
          const csMedMergeLevels = typeof csSettings.csMedMergeLevels === "number" ? csSettings.csMedMergeLevels : csMergeLevels;
          const csMedImbalancePercent = typeof csSettings.csMedImbalancePercent === "number" ? csSettings.csMedImbalancePercent : csImbalancePercent;
          const csMedMinDelta = typeof csSettings.csMedMinDelta === "number" ? csSettings.csMedMinDelta : 0;
          const csMedLocation = csSettings.csMedLocation || "any";

          const K_med = Math.max(1, Math.min(csMedMergeLevels, sortedCells.length));
          for (let i = 0; i <= sortedCells.length - K_med; i++) {
            let sumVolume = 0, sumBid = 0, sumAsk = 0;
            for (let j = 0; j < K_med; j++) {
              const cell = sortedCells[i + j];
              if (cell) {
                sumVolume += cell.volume;
                sumBid += cell.bid;
                sumAsk += cell.ask;
              }
            }
            if (sumVolume <= 0) continue;
            if (sumVolume < csMedMinVolume || sumVolume > csMedMaxVolume) continue;

            const bidPercent = (sumBid / sumVolume) * 100;
            const askPercent = (sumAsk / sumVolume) * 100;
            const isBidDominant = bidPercent >= csMedImbalancePercent;
            const isAskDominant = askPercent >= csMedImbalancePercent;
            if (!isBidDominant && !isAskDominant) continue;

            const absDelta = Math.abs(sumAsk - sumBid);
            if (absDelta < csMedMinDelta) continue;

            const midPrice = (sortedCells[i].price + sortedCells[i + K_med - 1].price) / 2;
            if (csMedLocation === "body" && !(midPrice >= minBody && midPrice <= maxBody)) continue;
            if (csMedLocation === "lowerWick" && !(midPrice < minBody)) continue;
            if (csMedLocation === "upperWick" && !(midPrice > maxBody)) continue;

            const color = isBidDominant ? csMedColorBid : csMedColorAsk;
            const range = csMedMaxVolume - csMedMinVolume;
            const ratio = range > 0 ? Math.min(1.0, (sumVolume - csMedMinVolume) / range) : 0;
            const size = csMedMinSize + ratio * (csMedMaxSize - csMedMinSize);

            itemsToDraw.push({
              price: midPrice,
              color,
              shape: csMedShape as any,
              opacity: csMedOpacity,
              size
            });
          }
        }

        // 2. Large filter match
        const csLargeEnabled = csSettings.csLargeEnabled !== false;
        if (csLargeEnabled) {
          const csLargeMergeLevels = typeof csSettings.csLargeMergeLevels === "number" ? csSettings.csLargeMergeLevels : csMergeLevels;
          const csLargeImbalancePercent = typeof csSettings.csLargeImbalancePercent === "number" ? csSettings.csLargeImbalancePercent : csImbalancePercent;
          const csLargeMinDelta = typeof csSettings.csLargeMinDelta === "number" ? csSettings.csLargeMinDelta : 0;
          const csLargeLocation = csSettings.csLargeLocation || "any";

          const K_large = Math.max(1, Math.min(csLargeMergeLevels, sortedCells.length));
          for (let i = 0; i <= sortedCells.length - K_large; i++) {
            let sumVolume = 0, sumBid = 0, sumAsk = 0;
            for (let j = 0; j < K_large; j++) {
              const cell = sortedCells[i + j];
              if (cell) {
                sumVolume += cell.volume;
                sumBid += cell.bid;
                sumAsk += cell.ask;
              }
            }
            if (sumVolume <= 0) continue;
            if (sumVolume < csLargeMinVolume) continue;

            const bidPercent = (sumBid / sumVolume) * 100;
            const askPercent = (sumAsk / sumVolume) * 100;
            const isBidDominant = bidPercent >= csLargeImbalancePercent;
            const isAskDominant = askPercent >= csLargeImbalancePercent;
            if (!isBidDominant && !isAskDominant) continue;

            const absDelta = Math.abs(sumAsk - sumBid);
            if (absDelta < csLargeMinDelta) continue;

            const midPrice = (sortedCells[i].price + sortedCells[i + K_large - 1].price) / 2;
            if (csLargeLocation === "body" && !(midPrice >= minBody && midPrice <= maxBody)) continue;
            if (csLargeLocation === "lowerWick" && !(midPrice < minBody)) continue;
            if (csLargeLocation === "upperWick" && !(midPrice > maxBody)) continue;

            const color = isBidDominant ? csLargeColorBid : csLargeColorAsk;
            const range = csLargeMinVolume * 2;
            const ratio = range > 0 ? Math.min(1.0, (sumVolume - csLargeMinVolume) / range) : 0;
            const size = csLargeMinSize + ratio * (csLargeMaxSize - csLargeMinSize);

            itemsToDraw.push({
              price: midPrice,
              color,
              shape: csLargeShape as any,
              opacity: csLargeOpacity,
              size
            });
          }
        }

        // Draw items
        itemsToDraw.forEach(item => {
          const centerX = x + candleWidth / 2;
          const centerY = priceToY(item.price);
          clusterSearchIndicator.drawShape(ctx, item.shape, centerX, centerY, item.size / 2, item.color, item.opacity, isLight);
        });
      }

      ctx.restore(); // Restore context from candlestick main chart area clipping

      // C. Bottom Delta Sub-panel drawing
      if (activeIndicators.delta) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(margin.left, deltaTopY, scrollWidth - margin.left + 50, deltaPanelHeight);
        ctx.clip();
        ctx.translate(0, deltaTopY);

        const deltaMidY = deltaPanelHeight / 2 + deltaOffset;
        const maxBarScaledHeight = deltaPanelHeight * 0.48;
        const deltaShowLabels = deltaSettings.showLabels !== false;
        const deltaSensitivity = typeof deltaSettings.sensitivity === "number" ? deltaSettings.sensitivity : 5;

        // Axis
        ctx.beginPath();
        ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.15)" : "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 0.8;
        ctx.moveTo(x, deltaMidY);
        ctx.lineTo(x + candleWidth, deltaMidY);
        ctx.stroke();

        const barHeight = Math.max(2, (Math.abs(candle.delta) / zoomedMaxCandleDelta) * maxBarScaledHeight);
        const dStyles = deltaIndicator.getDeltaStyle(candle.delta, isLight);

        if (Math.abs(candle.delta) >= deltaSensitivity) {
          if (deltaPlotType === "candles") {
            const scaleFactor = maxBarScaledHeight / Math.max(0.001, zoomedMaxWickValue);
            const ask = (candle.volume + candle.delta) / 2;
            const bid = (candle.volume - candle.delta) / 2;

            const yOpen = deltaMidY;
            const yClose = deltaMidY - candle.delta * scaleFactor;
            const yHigh = deltaMidY - ask * scaleFactor;
            const yLow = deltaMidY + bid * scaleFactor;

            const isBullish = candle.delta >= 0;

            // Draw wicks
            ctx.beginPath();
            ctx.strokeStyle = isBullish 
              ? (isLight ? "rgba(5, 150, 105, 0.55)" : "rgba(16, 185, 129, 0.65)")
              : (isLight ? "rgba(220, 38, 38, 0.55)" : "rgba(244, 63, 94, 0.65)");
            ctx.lineWidth = 1.0;
            ctx.moveTo(x + candleWidth / 2, yLow);
            ctx.lineTo(x + candleWidth / 2, yHigh);
            ctx.stroke();

            // Draw body
            ctx.fillStyle = dStyles.fillStyle;
            ctx.strokeStyle = isBullish 
              ? "rgba(16, 185, 129, 0.85)" 
              : "rgba(244, 63, 94, 0.85)";
            ctx.lineWidth = 1.2;

            const rectY = Math.min(yOpen, yClose);
            const rectH = Math.max(2, Math.abs(yClose - yOpen));
            ctx.fillRect(x + 4, rectY, candleWidth - 8, rectH);
            ctx.strokeRect(x + 4, rectY, candleWidth - 8, rectH);
          } else {
            const barY = candle.delta >= 0 ? deltaMidY - barHeight : deltaMidY;

            // Draw Delta volume bar
            ctx.fillStyle = dStyles.fillStyle;
            ctx.strokeStyle = candle.delta >= 0 ? "rgba(16, 185, 129, 0.85)" : "rgba(244, 63, 94, 0.85)";
            ctx.lineWidth = 1.2;
            ctx.fillRect(x + 4, barY, candleWidth - 8, barHeight);
            ctx.strokeRect(x + 4, barY, candleWidth - 8, barHeight);
          }
        }

        // Delta quantity text label
        if (deltaShowLabels && candleWidth >= 45) {
          ctx.font = "bold 8.5px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = dStyles.textStyle;
          const lblY = candle.delta >= 0 ? deltaMidY - barHeight - 4 : deltaMidY + barHeight + 11;
          const deltaText = (candle.delta >= 0 ? "+" : "") + candle.delta.toFixed(0) + "K";
          ctx.fillText(deltaText, x + candleWidth / 2, lblY);
        }
        ctx.restore();
      }
    }

    // 5. Drawing Cumulative Volume Delta (CVD) trend line or candles
    if (activeIndicators.cvd && cumulativeDeltaPoints.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, cvdTopY, scrollWidth - margin.left + 50, cvdPanelHeight);
      ctx.clip();
      ctx.translate(0, cvdTopY);

      // CVD subchart horizontal reference axis (mid-line)
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.15)" : "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(margin.left, cvdPanelHeight / 2);
      ctx.lineTo(scrollWidth, cvdPanelHeight / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const cvdStartIdx = Math.max(0, startIdx - 1);
      const cvdEndIdx = Math.min(cumulativeDeltaPoints.length - 1, endIdx + 1);

      if (cvdPlotType === "candles") {
        // Draw CVD as Candlesticks
        for (let idx = cvdStartIdx; idx <= cvdEndIdx; idx++) {
          const p = cumulativeDeltaPoints[idx];
          if (p.open === undefined || p.close === undefined) continue;

          // Align center X
          const x = p.cx - candleWidth / 2;

          const yOpen = getCvdY(p.open, cvdPanelHeight);
          const yClose = getCvdY(p.close, cvdPanelHeight);
          const yHigh = getCvdY(p.high, cvdPanelHeight);
          const yLow = getCvdY(p.low, cvdPanelHeight);

          const isBullish = p.close >= p.open;

          // Draw wicks
          ctx.beginPath();
          ctx.strokeStyle = isBullish 
            ? (isLight ? "#10b981" : "#10b981") 
            : (isLight ? "#ef4444" : "#f43f5e");
          ctx.lineWidth = 1.0;
          ctx.moveTo(p.cx, yLow);
          ctx.lineTo(p.cx, yHigh);
          ctx.stroke();

          // Draw body
          ctx.fillStyle = isBullish 
            ? (isLight ? "rgba(16, 185, 129, 0.75)" : "rgba(16, 185, 129, 0.85)")
            : (isLight ? "rgba(239, 68, 68, 0.75)" : "rgba(244, 63, 94, 0.85)");
          ctx.strokeStyle = isBullish 
            ? (isLight ? "#059669" : "#10b981") 
            : (isLight ? "#dc2626" : "#f43f5e");
          ctx.lineWidth = 1.0;

          const rectY = Math.min(yOpen, yClose);
          const rectH = Math.max(1.5, Math.abs(yClose - yOpen));
          ctx.fillRect(x + 1, rectY, candleWidth - 2, rectH);
          ctx.strokeRect(x + 1, rectY, candleWidth - 2, rectH);
        }
      } else {
        // Draw CVD as a continuous trend line
        ctx.beginPath();
        let pathStarted = false;
        for (let idx = cvdStartIdx; idx <= cvdEndIdx; idx++) {
          const p = cumulativeDeltaPoints[idx];
          const cy = getCvdY(p.value, cvdPanelHeight);
          if (!pathStarted) {
            ctx.moveTo(p.cx, cy);
            pathStarted = true;
          } else {
            ctx.lineTo(p.cx, cy);
          }
        }

        // Add customizable glow effect and color
        ctx.shadowColor = cvdLineColor;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = cvdLineColor;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.shadowBlur = 0; // reset shadow
      }

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // RSI subchart (footer panel) — fixed 0–100 scale, no auto-scale / Y-zoom
    // -------------------------------------------------------------------------
    if (activeIndicators.rsi && rsiPoints.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, rsiTopY, scrollWidth - margin.left + 50, rsiPanelHeight);
      ctx.clip();
      ctx.translate(0, rsiTopY);

      // Zoomable mapping around centre 50 (rsiYInPanel). At scale=1 this is the
      // original [0,100] fit; reference levels & line follow the zoom.
      const getRsiY = rsiYInPanel;
      const y70 = getRsiY(70);
      const y30 = getRsiY(30);
      const y50 = getRsiY(50);

      // Overbought/oversold zone fill between levels 30 and 70
      const zoneClean = rsiZoneColor.startsWith("#") ? rsiZoneColor.slice(1) : rsiZoneColor;
      let zoneFill = rsiZoneColor;
      if (zoneClean.length === 6) {
        const zr = parseInt(zoneClean.slice(0, 2), 16);
        const zg = parseInt(zoneClean.slice(2, 4), 16);
        const zb = parseInt(zoneClean.slice(4, 6), 16);
        const za = Math.max(0, Math.min(100, rsiZoneOpacity)) / 100;
        zoneFill = `rgba(${zr}, ${zg}, ${zb}, ${za})`;
      }
      ctx.fillStyle = zoneFill;
      ctx.fillRect(margin.left, y70, scrollWidth - margin.left, y30 - y70);

      // Fixed reference levels: 70 / 30 dashed, 50 thin dashed
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.28)" : "rgba(255, 255, 255, 0.22)";
      ctx.beginPath();
      ctx.moveTo(margin.left, y70);
      ctx.lineTo(scrollWidth, y70);
      ctx.moveTo(margin.left, y30);
      ctx.lineTo(scrollWidth, y30);
      ctx.stroke();

      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.10)";
      ctx.beginPath();
      ctx.moveTo(margin.left, y50);
      ctx.lineTo(scrollWidth, y50);
      ctx.stroke();
      ctx.setLineDash([]);

      // RSI line over visible candles; null values break the path
      const rsiStartIdx = Math.max(0, startIdx - 1);
      const rsiEndIdx = Math.min(rsiPoints.length - 1, endIdx + 1);
      ctx.beginPath();
      let rsiPathStarted = false;
      for (let idx = rsiStartIdx; idx <= rsiEndIdx; idx++) {
        const p = rsiPoints[idx];
        if (!p || p.value === null) {
          rsiPathStarted = false;
          continue;
        }
        const cy = getRsiY(p.value);
        if (!rsiPathStarted) {
          ctx.moveTo(p.cx, cy);
          rsiPathStarted = true;
        } else {
          ctx.lineTo(p.cx, cy);
        }
      }
      ctx.strokeStyle = rsiLineColor;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Bid & Ask Ratio subchart (footer panel) — FIXED -1..+1 scale, zero line in
    // the centre. Data is fetched from the backend (bidAskRatioPoints). On a
    // non-futures market the panel is shown empty with a "Только futures" label.
    // -------------------------------------------------------------------------
    if (activeIndicators.bidAskRatio) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, bidAskRatioTopY, scrollWidth - margin.left + 50, bidAskRatioPanelHeight);
      ctx.clip();
      ctx.translate(0, bidAskRatioTopY);

      const panelH = bidAskRatioPanelHeight;
      const midY = panelH / 2;
      // Zoomable mapping symmetric around 0 (ratioYInPanel). scale=1 → ±1 fit.
      const getRatioY = ratioYInPanel;

      // Zero reference line (centre)
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.18)" : "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(margin.left, midY);
      ctx.lineTo(scrollWidth, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!isFuturesMarket) {
        ctx.fillStyle = isLight ? "rgba(100, 116, 139, 0.9)" : "rgba(148, 163, 184, 0.9)";
        ctx.font = "bold 12px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Только futures", margin.left + (scrollWidth - margin.left) / 2, midY - 2);
      } else {
        const op = Math.max(0, Math.min(100, bidAskRatioOpacity)) / 100;
        const bullFill = hexToRgba(bidAskRatioBullColor, op);
        const bearFill = hexToRgba(bidAskRatioBearColor, op);
        const barStartIdx = Math.max(0, startIdx - 1);
        const barEndIdx = Math.min(bidAskRatioPoints.length - 1, endIdx + 1);
        for (let idx = barStartIdx; idx <= barEndIdx; idx++) {
          const p = bidAskRatioPoints[idx];
          if (!p || p.value === null || p.value === undefined) continue;
          const raw = p.value; // sign from raw value; Y clamps to zoomed bounds inside getRatioY
          const yVal = getRatioY(raw);
          const x = p.cx - candleWidth / 2;
          const top = raw >= 0 ? yVal : midY;
          const h = Math.max(1, Math.abs(midY - yVal));
          ctx.fillStyle = raw >= 0 ? bullFill : bearFill;
          ctx.fillRect(x + 1, top, candleWidth - 2, h);
        }
      }

      // (Axis value labels moved to the right SVG price scale — see bidAskRatio ticks.)

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Long/Short Account Ratio subchart (footer panel) — LINE, auto-scaled on the
    // visible range. Data is fetched from the backend (longShortRatioPoints). On a
    // non-futures market the panel shows a "Только futures" label. The line stays
    // continuous across candles that have no point (connect to the next available).
    // -------------------------------------------------------------------------
    if (activeIndicators.longShortRatio) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, longShortRatioTopY, scrollWidth - margin.left + 50, longShortRatioPanelHeight);
      ctx.clip();
      ctx.translate(0, longShortRatioTopY);

      const panelH = longShortRatioPanelHeight;

      if (!isFuturesMarket) {
        ctx.fillStyle = isLight ? "rgba(100, 116, 139, 0.9)" : "rgba(148, 163, 184, 0.9)";
        ctx.font = "bold 12px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Только futures", margin.left + (scrollWidth - margin.left) / 2, panelH / 2 - 2);
        ctx.textAlign = "left";
      } else {
        // Neutral reference line (ratio = 1, or 50% in longPct mode), dashed.
        const neutralY = getLsrY(longShortRatioNeutral, panelH);
        ctx.beginPath();
        ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.18)" : "rgba(255, 255, 255, 0.14)";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(margin.left, neutralY);
        ctx.lineTo(scrollWidth, neutralY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Continuous line over visible candles. Candles without a point are skipped
        // WITHOUT breaking the path, so the line connects to the next available point.
        const lsrStartIdx = Math.max(0, startIdx - 1);
        const lsrEndIdx = Math.min(longShortRatioPoints.length - 1, endIdx + 1);
        ctx.beginPath();
        let lsrPathStarted = false;
        for (let idx = lsrStartIdx; idx <= lsrEndIdx; idx++) {
          const p = longShortRatioPoints[idx];
          if (!p || p.value === null) continue;
          const cy = getLsrY(p.value, panelH);
          if (!lsrPathStarted) {
            ctx.moveTo(p.cx, cy);
            lsrPathStarted = true;
          } else {
            ctx.lineTo(p.cx, cy);
          }
        }
        ctx.shadowColor = longShortRatioLineColor;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = longShortRatioLineColor;
        ctx.lineWidth = 2.0;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Buy/Sell Zone subchart (footer panel) — composite 0..100 LINE with a grey
    // balance corridor and dynamic overheat fills (red above balUp, green below
    // balDown). Fixed 0..100 scale (zoomable around 50). futures-only.
    // -------------------------------------------------------------------------
    if (activeIndicators.buySellZone) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, buySellZoneTopY, scrollWidth - margin.left + 50, buySellZonePanelHeight);
      ctx.clip();
      ctx.translate(0, buySellZoneTopY);

      const panelH = buySellZonePanelHeight;

      if (!isFuturesMarket) {
        ctx.fillStyle = isLight ? "rgba(100, 116, 139, 0.9)" : "rgba(148, 163, 184, 0.9)";
        ctx.font = "bold 12px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Только futures", margin.left + (scrollWidth - margin.left) / 2, panelH / 2 - 2);
        ctx.textAlign = "left";
      } else {
        const xRight = scrollWidth;
        const yBalUp = getBsZoneY(bsZoneBalUp, panelH);
        const yBalDown = getBsZoneY(bsZoneBalDown, panelH);
        const yOverUp = getBsZoneY(bsZoneOverUp, panelH);
        const yOverDown = getBsZoneY(bsZoneOverDown, panelH);

        // 1) Balance corridor fill (between balUp and balDown).
        const balOp = Math.max(0, Math.min(100, bsZoneBalOpacity)) / 100;
        ctx.fillStyle = hexToRgba(bsZoneBalColor, balOp);
        ctx.fillRect(margin.left, yBalUp, xRight - margin.left, yBalDown - yBalUp);

        // 2) Reference levels: balUp/balDown dashed, overUp/overDown thin dashed.
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.28)" : "rgba(255, 255, 255, 0.22)";
        ctx.beginPath();
        ctx.moveTo(margin.left, yBalUp);
        ctx.lineTo(xRight, yBalUp);
        ctx.moveTo(margin.left, yBalDown);
        ctx.lineTo(xRight, yBalDown);
        ctx.stroke();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.10)";
        ctx.beginPath();
        ctx.moveTo(margin.left, yOverUp);
        ctx.lineTo(xRight, yOverUp);
        ctx.moveTo(margin.left, yOverDown);
        ctx.lineTo(xRight, yOverDown);
        ctx.stroke();
        ctx.setLineDash([]);

        // Build contiguous non-null line segments over the visible range. A null
        // composite (no available components) breaks the line into a new segment.
        const bsStartIdx = Math.max(0, startIdx - 1);
        const bsEndIdx = Math.min(buySellZonePoints.length - 1, endIdx + 1);
        const segments: { x: number; y: number }[][] = [];
        let segCur: { x: number; y: number }[] = [];
        for (let idx = bsStartIdx; idx <= bsEndIdx; idx++) {
          const p = buySellZonePoints[idx];
          if (!p || p.value === null) {
            if (segCur.length) { segments.push(segCur); segCur = []; }
            continue;
          }
          segCur.push({ x: p.cx, y: getBsZoneY(p.value, panelH) });
        }
        if (segCur.length) segments.push(segCur);

        // 3) Overheat fills, dynamic from the line. Clip to the band above balUp
        // and fill the area UNDER the line → only where the line exceeds balUp is
        // painted (red, longs overheated). Mirror below balDown (green).
        const overOp = Math.max(0, Math.min(100, bsZoneOverOpacity)) / 100;
        const fillBetween = (clipY0: number, clipY1: number, toEdgeY: number, color: string) => {
          const top = Math.max(0, Math.min(panelH, Math.min(clipY0, clipY1)));
          const bot = Math.max(0, Math.min(panelH, Math.max(clipY0, clipY1)));
          if (bot - top <= 0 || segments.length === 0) return;
          ctx.save();
          ctx.beginPath();
          ctx.rect(margin.left, top, xRight - margin.left, bot - top);
          ctx.clip();
          ctx.fillStyle = hexToRgba(color, overOp);
          for (const seg of segments) {
            ctx.beginPath();
            ctx.moveTo(seg[0]!.x, seg[0]!.y);
            for (let k = 1; k < seg.length; k++) ctx.lineTo(seg[k]!.x, seg[k]!.y);
            ctx.lineTo(seg[seg.length - 1]!.x, toEdgeY);
            ctx.lineTo(seg[0]!.x, toEdgeY);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        };
        // Above balUp: clip [0..yBalUp], close polygon to the panel bottom.
        fillBetween(0, yBalUp, panelH, bsZoneOverUpColor);
        // Below balDown: clip [yBalDown..panelH], close polygon to the panel top.
        fillBetween(yBalDown, panelH, 0, bsZoneOverDownColor);

        // 4) Composite line (rounded caps; null already split into segments).
        ctx.strokeStyle = bsZoneLineColor;
        ctx.lineWidth = 1.8;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const seg of segments) {
          ctx.beginPath();
          ctx.moveTo(seg[0]!.x, seg[0]!.y);
          for (let k = 1; k < seg.length; k++) ctx.lineTo(seg[k]!.x, seg[k]!.y);
          ctx.stroke();
        }

        // 5) LONG/SHORT badges — one liquid-glass pill per contiguous zone-entry
        // run, anchored at the run's extremum (max for short, min for long).
        if (bsZoneShowBadges) {
          type ZoneRun = { type: "short" | "long"; extVal: number; extCx: number };
          const runs: ZoneRun[] = [];
          let curType: "short" | "long" | null = null;
          let extVal = 0;
          let extCx = 0;
          const flushRun = () => {
            if (curType) runs.push({ type: curType, extVal, extCx });
            curType = null;
          };
          for (let idx = bsStartIdx; idx <= bsEndIdx; idx++) {
            const p = buySellZonePoints[idx];
            const v = p ? p.value : null;
            let t: "short" | "long" | null = null;
            if (v != null) {
              if (v > bsZoneOverUp) t = "short";
              else if (v < bsZoneOverDown) t = "long";
            }
            if (t === null) { flushRun(); continue; }
            if (t !== curType) {
              flushRun();
              curType = t; extVal = v!; extCx = p!.cx;
            } else if (t === "short" ? v! > extVal : v! < extVal) {
              extVal = v!; extCx = p!.cx;
            }
          }
          flushRun();

          if (runs.length) {
            const badgeH = 14;
            const padX = 5;
            const roundRectPath = (x: number, y: number, w: number, h: number, r: number) => {
              ctx.beginPath();
              ctx.moveTo(x + r, y);
              ctx.arcTo(x + w, y, x + w, y + h, r);
              ctx.arcTo(x + w, y + h, x, y + h, r);
              ctx.arcTo(x, y + h, x, y, r);
              ctx.arcTo(x, y, x + w, y, r);
              ctx.closePath();
            };
            ctx.font = "bold 9px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            for (const run of runs) {
              const label = run.type === "short" ? "SHORT" : "LONG";
              const bg = run.type === "short" ? bsZoneOverUpColor : bsZoneOverDownColor;
              const yLine = getBsZoneY(run.extVal, panelH);
              const w = ctx.measureText(label).width + padX * 2;
              // SHORT pill sits above the point (toward top), LONG below.
              let cy = run.type === "short" ? yLine - badgeH : yLine + badgeH;
              let cx = Math.max(margin.left + w / 2, Math.min(xRight - w / 2, run.extCx));
              cy = Math.max(badgeH / 2, Math.min(panelH - badgeH / 2, cy));
              roundRectPath(cx - w / 2, cy - badgeH / 2, w, badgeH, badgeH / 2);
              ctx.fillStyle = hexToRgba(bg, 0.92);
              ctx.fill();
              ctx.lineWidth = 1;
              ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
              ctx.stroke();
              // Drop shadow ONLY on the text (fill/stroke above stay shadow-free).
              ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
              ctx.shadowBlur = 2;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 1;
              ctx.fillStyle = "#ffffff";
              ctx.fillText(label, cx, cy + 0.5);
              // Reset shadow so it does not bleed into the rest of the render.
              ctx.shadowColor = "transparent";
              ctx.shadowBlur = 0;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 0;
            }
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
          }
        }
      }

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // RENDER INTERACTIVE DRAWING OBJECTS (Foreground items: lines, handles, annotations, etc.)
    // -------------------------------------------------------------------------
    drawDrawingObjects(ctx, {
      ctx,
      drawings: areDrawingsVisible ? drawings : [],
      drawingInProgress,
      selectedDrawingId,
      visibleScrollLeft,
      viewportWidth,
      chartHeight,
      margin,
      isLight,
      priceToY,
      activePair,
      clusterStep: effectiveStep,
      candles,
      candleWidth,
      candleSpacing,
      layer: "foreground",
      language,
      tsToX: tsToX_local,
      tsToIndex: tsToIndex_local,
    });

    ctx.restore(); // Undoes translation of -visibleScrollLeft for viewport-wide elements

    // 5.4 Draw Depth of Market (DOM) Histogram fixed on the right (similar to ATAS & Tiger Trade)
    const domActive = activeIndicators?.depthOfMarket || false;
    if (domActive && orderBook) {
      ctx.save();
      
      // Clip strictly within the main candlestick vertical area
      ctx.beginPath();
      ctx.rect(margin.left, margin.top, viewportWidth - margin.left, chartHeight);
      ctx.clip();

      const domSettings = indicatorSettings?.depthOfMarket || {};
      const domWidthMode = domSettings.domWidthMode || "auto";
      const domMaxWidth = typeof domSettings.domMaxWidth === "number" ? domSettings.domMaxWidth : 100;
      const domColorBidRaw = domSettings.domColorBid || "#FF228B22";
      const domColorAskRaw = domSettings.domColorAsk || "#FFC80000";
      const domOpacity = typeof domSettings.domOpacity === "number" ? domSettings.domOpacity : 40;

      const domColorBid = parseHexColor(domColorBidRaw);
      const domColorAsk = parseHexColor(domColorAskRaw);

      // Apply opacity cleanly to parsed colors
      const applyOpacity = (hex: string, opacityPercent: number): string => {
        if (hex.startsWith("#")) {
          const clean = hex.slice(1);
          if (clean.length === 6) {
            const r = parseInt(clean.slice(0, 2), 16);
            const g = parseInt(clean.slice(2, 4), 16);
            const b = parseInt(clean.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${opacityPercent / 100})`;
          } else if (clean.length === 8) {
            const r = parseInt(clean.slice(0, 2), 16);
            const g = parseInt(clean.slice(2, 4), 16);
            const b = parseInt(clean.slice(4, 6), 16);
            const a = parseInt(clean.slice(6, 8), 16) / 255;
            return `rgba(${r}, ${g}, ${b}, ${a * (opacityPercent / 100)})`;
          }
        }
        return hex;
      };

      const bidColorFill = applyOpacity(domColorBid, domOpacity);
      const askColorFill = applyOpacity(domColorAsk, domOpacity);

      // Determine maximum amount to scale the bars
      let maxAmount = 1;
      orderBook.bids.forEach(b => { if (b.amount > maxAmount) maxAmount = b.amount; });
      orderBook.asks.forEach(a => { if (a.amount > maxAmount) maxAmount = a.amount; });

      const scaleMaxWidth = domWidthMode === "auto" ? 100 : domMaxWidth;
      const chartRightX = viewportWidth;

      // Price step in pixels
      const oneTickHeight = Math.abs(priceToY(activePair.price) - priceToY(activePair.price + activePair.priceStep));
      const barH = Math.max(1.5, Math.min(18, oneTickHeight - 0.5));

      // Draw Ask limit order levels
      orderBook.asks.forEach(item => {
        const y = priceToY(item.price);
        if (y >= margin.top && y <= margin.top + chartHeight) {
          const barWidth = (item.amount / maxAmount) * scaleMaxWidth;
          
          ctx.fillStyle = askColorFill;
          ctx.fillRect(chartRightX - barWidth, y - barH / 2, barWidth, barH);

          // Left border line for the bar structure
          ctx.strokeStyle = applyOpacity(domColorAsk, Math.min(100, domOpacity * 1.5));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(chartRightX - barWidth, y - barH / 2);
          ctx.lineTo(chartRightX - barWidth, y + barH / 2);
          ctx.stroke();
        }
      });

      // Draw Bid limit order levels
      orderBook.bids.forEach(item => {
        const y = priceToY(item.price);
        if (y >= margin.top && y <= margin.top + chartHeight) {
          const barWidth = (item.amount / maxAmount) * scaleMaxWidth;

          ctx.fillStyle = bidColorFill;
          ctx.fillRect(chartRightX - barWidth, y - barH / 2, barWidth, barH);

          // Left border line
          ctx.strokeStyle = applyOpacity(domColorBid, Math.min(100, domOpacity * 1.5));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(chartRightX - barWidth, y - barH / 2);
          ctx.lineTo(chartRightX - barWidth, y + barH / 2);
          ctx.stroke();
        }
      });

      ctx.restore();
    }

    // 5.5 Draw the solid timeline footer strip and time axis labels on top of everything else (to hide overlapping candles/wicks)
    ctx.save();
    ctx.fillStyle = isLight ? "rgba(241, 245, 249, 0.65)" : "#090b12";
    // We fill the entire bottom margin (timeline section) as a solid background to cover any overflowed elements from candles
    ctx.fillRect(0, totalSvgHeight - margin.bottom, viewportWidth, margin.bottom);
    
    ctx.beginPath();
    ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.1)" : "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1.0;
    const timelineY = Math.round(totalSvgHeight - margin.bottom) + 0.5;
    ctx.moveTo(0, timelineY);
    ctx.lineTo(viewportWidth, timelineY);
    ctx.stroke();
    ctx.restore();

    // Re-apply translation to draw the horizontal time axis labels at scrolled positions correctly
    ctx.save();
    ctx.translate(-visibleScrollLeft, 0);

    const allowedSteps = [1, 2, 5, 10, 15, 20, 30, 50, 100, 200, 500, 1000];
    const candleSpacingTotal = candleWidth + candleSpacing;
    const labelStep = allowedSteps.find(step => step * candleSpacingTotal >= 75) || 1000;

    // S1: hover-box for the timestamp under the cursor moved to overlay canvas (drawOverlay)
    // so the main draw no longer depends on `crosshair`. Standard timestamps drawn here
    // unconditionally — the overlay hover-box paints its own filled background on top
    // and visually masks the underlying standard label for the hovered column.
    for (let cIdx = startIdx; cIdx <= endIdx; cIdx++) {
      const candle = candles[cIdx];
      const x = margin.left + cIdx * candleSpacingTotal;

      if (cIdx % labelStep === 0) {
        const timeStr = formatTimezoneString(candle.timestamp, false);
        ctx.save();
        ctx.font = "bold 9px 'Inter', sans-serif";
        ctx.fillStyle = "#475569";
        ctx.textAlign = "center";
        ctx.fillText(timeStr, x + candleWidth / 2, totalSvgHeight - margin.bottom + 16);
        ctx.restore();
      }
    }

    ctx.restore(); // Undoes translation for the label drawing

    // S1: crosshair lines moved to overlay canvas (drawOverlay).
    // Main draw no longer depends on crosshair / hoveredCell.
    };
    // S2: ask the planner for one paint this frame; coalesces sibling commits.
    scheduleDraw();
  }, [
    candles,
    candleWidth,
    verticalScale,
    activeIndicators,
    indicatorSettings,
    panelOrder,
    theme,
    candleType,
    candlePalette,
    candleDataType,
    priceCenterOffset,
    containerHeight,
    scrollWidth,
    totalSvgHeight,
    maxCellVolume,
    maxCandleDelta,
    zoomedMaxCandleDelta,
    maxCumDeltaVal,
    minCumDeltaVal,
    zoomedCvdMax,
    zoomedCvdMin,
    zoomedCvdDeltaRange,
    cvdCenterVal,
    deltaScale,
    cvdScale,
    rsiScale,
    bidAskRatioScale,
    deltaOffset,
    cvdOffset,
    rsiOffset,
    bidAskRatioOffset,
    longShortRatioOffset,
    bidAskRatioPoints,
    bidAskRatioBullColor,
    bidAskRatioBearColor,
    bidAskRatioOpacity,
    longShortRatioScale,
    longShortRatioPoints,
    longShortRatioLineColor,
    longShortRatioDisplayMode,
    longShortRatioNeutral,
    zoomedLsrMin,
    zoomedLsrMax,
    zoomedLsrRange,
    lsrCenterVal,
    buySellZonePoints,
    buySellZoneScale,
    buySellZoneOffset,
    zoomedBsMin,
    zoomedBsMax,
    bsZoneLineColor,
    bsZoneBalColor,
    bsZoneBalOpacity,
    bsZoneOverUpColor,
    bsZoneOverDownColor,
    bsZoneOverOpacity,
    bsZoneShowBadges,
    bsZoneBalUp,
    bsZoneBalDown,
    bsZoneOverUp,
    bsZoneOverDown,
    marketType,
    profileBuckets,
    maxProfileVol,
    profileBucketSize,
    isDetailedMode,
    isLight,
    activePair.price,
    activePair.priceStep,
    // S3: visibleScrollLeft REMOVED from deps. Scroll now drives the draw via
    // visibleScrollLeftRef + scheduleDraw() from onScroll. The closure reads the
    // ref at frame time, so re-closing on every state push would just churn.
    visibleClientWidth,
    selectedTimezone,
    areDrawingsVisible,
    drawings,
    drawingInProgress,
    selectedDrawingId
  ]);

  // S1: re-apply overlay state from refs after every commit.
  // The component renders the JSX with "--" defaults for the imperative DOM elements,
  // so any unrelated re-render (data tick, zoom, scroll) would wipe the visible hover
  // values. This effect writes refs → DOM right before paint, so the user keeps seeing
  // the crosshair/Delta/CVD values that were last set by the mouse handler.
  useLayoutEffect(() => {
    const ch = crosshairRef.current;
    if (ch) {
      // S3: ref-current scroll keeps the resolved colIdx accurate even when the
      // commit was triggered by something other than a state-flushed scroll.
      const vsl = visibleScrollLeftRef.current;
      const colIdx = Math.floor((ch.x + vsl - margin.left) / (candleWidth + candleSpacing));
      const hoveredCandle = (colIdx >= 0 && colIdx < candles.length) ? candles[colIdx] : null;
      const cvdPoint = (colIdx >= 0 && colIdx < cumulativeDeltaPoints.length) ? cumulativeDeltaPoints[colIdx] : null;
      const rsiPoint = (colIdx >= 0 && colIdx < rsiPoints.length) ? rsiPoints[colIdx] : null;
      updateCrosshairDom(ch, hoveredCandle, cvdPoint, rsiPoint);
    } else {
      updateCrosshairDom(null, null, null);
    }
    updateClusterTooltipDom(hoveredClusterSearchRef.current);
    drawOverlay();
  });

  const formatCoinsVolume = (valInCoins: number, symbol: string) => {
    const rounded = Math.round(valInCoins);
    return `${rounded.toLocaleString()} ${symbol.toUpperCase()}`;
  };

  const formatUsdtVolume = (valInUsdt: number) => {
    if (valInUsdt >= 1_000_000_000) {
      const bils = valInUsdt / 1_000_000_000;
      return `${bils.toFixed(1)}b USDT`;
    }
    const mils = valInUsdt / 1_000_000;
    return `${mils.toFixed(1)}m USDT`;
  };

  return (
    <div className={`rounded-2xl overflow-hidden flex flex-col flex-1 shadow-2xl relative transition-all duration-300 ${
      isLight ? "bg-white border border-slate-200/50" : "liquid-glass-card"
    }`}>
      {/* Chart Tools Header */}
      <ChartToolsHeader
        activePair={activePair}
        marketType={marketType}
        onToggleMarketType={onToggleMarketType}
        indicators={indicators}
        workspaceLayout={workspaceLayout}
        onWorkspaceLayoutChange={onWorkspaceLayoutChange}
        workspacesCount={workspacesCount}
        isLight={isLight}
        language={language}
        selectedTimezone={selectedTimezone}
        onTimezoneChange={onTimezoneChange}
        showChartSettings={showChartSettings}
        onToggleChartSettings={onToggleChartSettings}
        onZoom={handleZoom}
        onVerticalZoom={handleVerticalZoom}
        onResetZoom={handleResetZoom}
      />

      {/* 2D Panning Chart Workspace */}
      <div className="flex-1 flex relative overflow-hidden">

        {/* Overlay Legend — top-left, collapsible panel for overlay indicators */}
        {(() => {
          const overlayIndicatorIds = ["clusterSearch", "volumeOnChart", "stackedImbalance"];
          const activeOverlayIndicators = indicators ? indicators.filter(ind => ind.isActive && overlayIndicatorIds.includes(ind.id)) : [];

          if (activeOverlayIndicators.length === 0) return null;

          return (
            <div className="absolute left-[52px] top-3 pointer-events-none z-30">
              <div className="pointer-events-auto flex flex-col gap-1.5 font-sans select-none max-w-sm sm:max-w-md transition-all duration-300">
                
                {/* Collapse/Expand Toggle Button */}
                <div className="flex items-center gap-1 select-none shrink-0">
                  <button
                    onClick={() => {
                      const next = !isOverlayLegendCollapsed;
                      setIsOverlayLegendCollapsed(next);
                      storage.set("chart_overlay_legend_collapsed", String(next));
                    }}
                    className={`flex items-center gap-1 font-mono text-[8px] sm:text-[9px] font-bold uppercase tracking-wider py-0.5 px-2 rounded transition-all cursor-pointer border ${
                      isLight
                        ? "bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-600 hover:text-slate-900 shadow-sm"
                        : "bg-white/[0.04] hover:bg-white/[0.08] border-white/5 text-slate-400 hover:text-white"
                    }`}
                  >
                    {isOverlayLegendCollapsed ? (
                      <>
                        {language === "RU" ? "Индикаторы" : "Indicators"} ({activeOverlayIndicators.length})
                        <ChevronDown className="w-3 h-3 text-amber-500 ml-0.5" />
                      </>
                    ) : (
                      <>
                        {language === "RU" ? "Свернуть" : "Collapse"}
                        <ChevronDown className="w-3 h-3 text-rose-500 ml-0.5 transform rotate-180" />
                      </>
                    )}
                  </button>
                </div>

                {/* Indicators list (Only shown if NOT collapsed) */}
                {!isOverlayLegendCollapsed && (
                  <div className="flex flex-col gap-1 pl-0.5">
                    {activeOverlayIndicators.map(ind => {
                      const isVisible = ind.isVisible !== false;
                      
                      let label = ind.label.replace(/^\(PROCLUSTER\)\s+/i, "").replace(/\s+\(PROCLUSTER\)$/i, "");
                      if (ind.id === "volumeOnChart") label = "Volume on Chart";

                      return (
                        <div 
                          key={ind.id}
                          className={`group flex items-center justify-between gap-3 px-1.5 py-0.5 rounded transition-all duration-150 flex-nowrap whitespace-nowrap ${
                            isLight 
                              ? "hover:bg-slate-200/50" 
                              : "hover:bg-white/[0.04]"
                          } ${!isVisible ? "opacity-35" : ""}`}
                        >
                          {/* Label & Pair Info */}
                          <div className="flex items-center gap-1.5 font-mono text-[9.5px] sm:text-[10px] select-text min-w-0 font-bold flex-nowrap whitespace-nowrap">
                            <span className={`hidden sm:inline font-bold shrink-0 whitespace-nowrap ${
                              isLight ? "text-[#4f46e5]" : "text-cyan-400"
                            }`}>&lt;ProCluster&gt;</span>

                            <span className={`tracking-wide shrink whitespace-nowrap leading-tight hover:underline truncate ${
                              isLight ? "text-slate-800" : "text-slate-100"
                            } ${!isVisible ? "line-through text-slate-500" : ""}`}>
                              {label}
                            </span>
                          </div>

                          {/* Micro control actions */}
                          <div className="flex items-center gap-0.5 shrink-0 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all duration-150">
                            <button
                              onClick={() => {
                                if (onToggleVisibility) {
                                  onToggleVisibility(ind.id);
                                } else {
                                  onToggleIndicator?.(ind.id);
                                }
                              }}
                              className={`p-0.5 rounded cursor-pointer transition-colors ${
                                isLight ? "hover:bg-slate-300 text-slate-600 hover:text-slate-900" : "hover:bg-white/10 text-slate-300 hover:text-white"
                              }`}
                              title={language === "RU" ? (isVisible ? "Скрыть" : "Показать") : "Toggle Visibility"}
                            >
                              {isVisible ? (
                                <Eye className={`w-3 h-3 ${isLight ? "text-emerald-600" : "text-emerald-400"}`} />
                              ) : (
                                <EyeOff className="w-3 h-3 text-rose-500" />
                              )}
                            </button>

                            <button
                              onClick={() => onShowIndicatorsSettings?.(ind.id)}
                              className={`p-0.5 rounded cursor-pointer transition-colors ${
                                isLight ? "hover:bg-slate-300 text-slate-600 hover:text-slate-900" : "hover:bg-white/10 text-slate-300 hover:text-white"
                              }`}
                              title={language === "RU" ? "Настройки" : "Settings"}
                            >
                              <Settings className="w-3 h-3 text-amber-500" />
                            </button>

                            <button
                              onClick={() => onRemoveIndicator?.(ind.id)}
                              className={`p-0.5 rounded cursor-pointer transition-colors ${
                                isLight 
                                  ? "hover:bg-slate-300 text-slate-600 hover:text-rose-600" 
                                  : "hover:bg-rose-500/10 text-slate-300 hover:text-rose-400"
                              }`}
                              title={language === "RU" ? "Удалить" : "Remove"}
                            >
                              <Trash2 className="w-3 h-3 text-rose-500" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Branch A step 1: DrawingToolbar extracted into its own React.memo component
            (./DrawingToolbar.tsx). On WS-tick / scroll-state push / mousemove the toolbar
            is skipped by React reconciliation — its props are stable (functional setState
            updater for activeDrawingTool, useCallback for the two side-effects). */}
        <DrawingToolbar
          activeDrawingTool={activeDrawingTool}
          setActiveDrawingTool={setActiveDrawingTool}
          areDrawingsVisible={areDrawingsVisible}
          onToggleDrawingsVisibility={onToggleDrawingsVisibility}
          onClearAllDrawings={onClearAllDrawings}
          hasDrawings={drawings.length > 0}
          isLight={isLight}
          language={language}
        />

        {/* Main SVG/Zoom Panel */}
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          onDoubleClick={handleDoubleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onScroll={(e) => {
            // S3: hot path — write to ref + schedule one rAF draw. NO setState here
            // (used to fire on every scroll-event and re-render the whole monolith
            // ~90 ms/frame; see profiling). State is pushed lazily via
            // requestScrollStateSync — half-candle moves immediately, micro-moves
            // after a 100 ms debounce.
            const sl = e.currentTarget.scrollLeft;
            visibleScrollLeftRef.current = sl;
            scheduleDraw();
            requestScrollStateSync(sl);
            const cw = e.currentTarget.clientWidth;
            if (cw !== visibleClientWidth) setVisibleClientWidth(cw);
          }}
          className={`flex-1 overflow-x-auto overflow-y-hidden select-none terminal-grid relative transition-all duration-300 chart-scroll-container ${
            isLight ? "bg-[#f8fafc]" : "bg-[#06080f]"
          } ${isDraggingTimeScale ? "cursor-ew-resize" : (isDragging ? "cursor-grabbing" : "cursor-grab")}`}
          style={{ scrollBehavior: "auto", touchAction: "none" }}
        >
          {isLoadingHistory && candles.length > 0 && (
            <div className="absolute top-1/2 left-3 -translate-y-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#06080f]/85 border border-yellow-500/30 backdrop-blur-sm pointer-events-none">
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-yellow-500"></div>
              <span className="text-[10px] font-mono font-bold text-yellow-500 uppercase tracking-wider">
                {language === 'RU' ? 'Загрузка...' : language === 'KZ' ? 'Жүктелуде...' : 'Loading...'}
              </span>
            </div>
          )}
          {candles.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#06080f]/80 z-25">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
            </div>
          ) : (
            <>
              {/* Dummy scroll spacer to enable native scrollbar and wheel scroll dynamics */}
              <div id="procluster-chart-spacer" style={{ width: `${scrollWidth}px`, height: "1px", pointerEvents: "none" }} />
              
              {/* S1: sticky wrapper holds the main canvas + overlay canvas in the same
                  visual layer so the overlay can be repainted independently of the main. */}
              <div
                className="sticky left-0 top-0 block z-10"
                style={{ width: `${visibleClientWidth || 800}px`, height: `${totalSvgHeight}px` }}
              >
                {/* Main canvas — candles, axes, indicators. Repainted on data/zoom/scroll. */}
                <canvas
                  ref={canvasRef}
                  onMouseMove={handleSvgMouseMove}
                  onMouseLeave={handleSvgMouseLeave}
                  onTouchStart={handleSvgTouch}
                  onTouchMove={handleSvgTouch}
                  onTouchEnd={handleSvgTouchEnd}
                  className="absolute left-0 top-0 block"
                />
                {/* Overlay canvas — crosshair lines, hovered timestamp box, column highlights.
                    Repainted only on mousemove (drawOverlay). pointer-events:none so the
                    mouse handlers above keep firing on the main canvas. */}
                <canvas
                  ref={overlayCanvasRef}
                  data-overlay="true"
                  className="absolute left-0 top-0 block pointer-events-none"
                  style={{ zIndex: 1 }}
                />
              </div>
            </>
          )}
        </div>

        {/* Watermark logo overlay (bottom-right of price-pane, above time-axis and indicator sub-panes) */}
        <img
          src={logoWatermark}
          alt=""
          className="absolute pointer-events-none select-none z-10 h-7 w-auto opacity-[0.20]"
          style={{
            bottom: `${margin.bottom + panelsHeightTotal + 26}px`,
            right: `${(isMobile ? 54 : 66) + 16}px`,
          }}
        />

      {/* Fixed Price Scale Panel on the Right */}
      <div
        onWheel={(e) => {
          e.preventDefault();
          setVerticalScale(prev => {
            const delta = e.deltaY;
            const direction = Math.sign(delta);
            if (direction === 0) return prev;
            const multiplier = direction < 0 ? 1.15 : 0.85;
            const next = prev * multiplier;
            return Math.min(2000.0, Math.max(0.1, next));
          });
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return; // Only left-click
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const clickY = e.clientY - rect.top;

          const inPanelZone = (id: string) =>
            activeIndicators[id] && panelTopY[id] != null &&
            clickY >= panelTopY[id] && clickY < panelTopY[id] + getPanelHeight(id);
          if (inPanelZone("delta")) {
            setIsDraggingDeltaScale(true);
            startDeltaScaleYRef.current = e.clientY;
            startDeltaScaleRef.current = deltaScale;
          } else if (inPanelZone("cvd")) {
            setIsDraggingCvdScale(true);
            startCvdScaleYRef.current = e.clientY;
            startCvdScaleRef.current = cvdScale;
          } else if (inPanelZone("rsi")) {
            setIsDraggingRsiScale(true);
            startRsiScaleYRef.current = e.clientY;
            startRsiScaleRef.current = rsiScale;
          } else if (inPanelZone("bidAskRatio")) {
            setIsDraggingBidAskRatioScale(true);
            startBidAskRatioScaleYRef.current = e.clientY;
            startBidAskRatioScaleRef.current = bidAskRatioScale;
          } else if (inPanelZone("longShortRatio")) {
            setIsDraggingLongShortRatioScale(true);
            startLongShortRatioScaleYRef.current = e.clientY;
            startLongShortRatioScaleRef.current = longShortRatioScale;
          } else if (inPanelZone("buySellZone")) {
            setIsDraggingBuySellZoneScale(true);
            startBuySellZoneScaleYRef.current = e.clientY;
            startBuySellZoneScaleRef.current = buySellZoneScale;
          } else {
            setIsDraggingPriceScale(true);
            startPriceScaleYRef.current = e.clientY;
            startVerticalScaleRef.current = verticalScale;
          }
        }}
        onTouchStart={(e) => {
          if (e.touches.length !== 1) return;
          if (e.cancelable) e.preventDefault();
          const t = e.touches[0];
          const rect = e.currentTarget.getBoundingClientRect();
          const clickY = t.clientY - rect.top;
          const inPanelZoneTouch = (id: string) =>
            activeIndicators[id] && panelTopY[id] != null &&
            clickY >= panelTopY[id] && clickY < panelTopY[id] + getPanelHeight(id);
          if (inPanelZoneTouch("delta")) {
            isDraggingDeltaScaleRefTouch.current = true;
            startDeltaScaleYRef.current = t.clientY;
            startDeltaScaleRef.current = deltaScale;
          } else if (inPanelZoneTouch("cvd")) {
            isDraggingCvdScaleRefTouch.current = true;
            startCvdScaleYRef.current = t.clientY;
            startCvdScaleRef.current = cvdScale;
          } else if (inPanelZoneTouch("rsi")) {
            isDraggingRsiScaleRefTouch.current = true;
            startRsiScaleYRef.current = t.clientY;
            startRsiScaleRef.current = rsiScale;
          } else if (inPanelZoneTouch("bidAskRatio")) {
            isDraggingBidAskRatioScaleRefTouch.current = true;
            startBidAskRatioScaleYRef.current = t.clientY;
            startBidAskRatioScaleRef.current = bidAskRatioScale;
          } else if (inPanelZoneTouch("longShortRatio")) {
            isDraggingLongShortRatioScaleRefTouch.current = true;
            startLongShortRatioScaleYRef.current = t.clientY;
            startLongShortRatioScaleRef.current = longShortRatioScale;
          } else if (inPanelZoneTouch("buySellZone")) {
            isDraggingBuySellZoneScaleRefTouch.current = true;
            startBuySellZoneScaleYRef.current = t.clientY;
            startBuySellZoneScaleRef.current = buySellZoneScale;
          } else {
            isDraggingPriceScaleRef.current = true;
            startPriceScaleYRef.current = t.clientY;
            startVerticalScaleRef.current = verticalScale;
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length !== 1) return;
          if (e.cancelable) e.preventDefault();
          const t = e.touches[0];
          if (isDraggingPriceScaleRef.current) {
            const deltaY = startPriceScaleYRef.current - t.clientY;
            const multiplier = Math.exp(deltaY / 200);
            const nextScale = Math.min(2000.0, Math.max(0.1, startVerticalScaleRef.current * multiplier));
            setVerticalScale(nextScale);
            verticalScaleRef.current = nextScale;
          } else if (isDraggingDeltaScaleRefTouch.current) {
            const deltaY = startDeltaScaleYRef.current - t.clientY;
            const multiplier = Math.exp(deltaY / 200);
            const nextScale = Math.min(2000.0, Math.max(0.1, startDeltaScaleRef.current * multiplier));
            setDeltaScale(nextScale);
          } else if (isDraggingCvdScaleRefTouch.current) {
            const deltaY = startCvdScaleYRef.current - t.clientY;
            const multiplier = Math.exp(deltaY / 200);
            const nextScale = Math.min(2000.0, Math.max(0.1, startCvdScaleRef.current * multiplier));
            setCvdScale(nextScale);
          } else if (isDraggingRsiScaleRefTouch.current) {
            const deltaY = startRsiScaleYRef.current - t.clientY;
            const multiplier = Math.exp(deltaY / 200);
            const nextScale = Math.min(2000.0, Math.max(0.1, startRsiScaleRef.current * multiplier));
            setRsiScale(nextScale);
          } else if (isDraggingBidAskRatioScaleRefTouch.current) {
            const deltaY = startBidAskRatioScaleYRef.current - t.clientY;
            const multiplier = Math.exp(deltaY / 200);
            const nextScale = Math.min(2000.0, Math.max(0.1, startBidAskRatioScaleRef.current * multiplier));
            setBidAskRatioScale(nextScale);
          } else if (isDraggingLongShortRatioScaleRefTouch.current) {
            const deltaY = startLongShortRatioScaleYRef.current - t.clientY;
            const multiplier = Math.exp(deltaY / 200);
            const nextScale = Math.min(2000.0, Math.max(0.1, startLongShortRatioScaleRef.current * multiplier));
            setLongShortRatioScale(nextScale);
          } else if (isDraggingBuySellZoneScaleRefTouch.current) {
            const deltaY = startBuySellZoneScaleYRef.current - t.clientY;
            const multiplier = Math.exp(deltaY / 200);
            const nextScale = Math.min(2000.0, Math.max(0.1, startBuySellZoneScaleRef.current * multiplier));
            setBuySellZoneScale(nextScale);
          }
        }}
        onTouchEnd={() => {
          isDraggingPriceScaleRef.current = false;
          isDraggingDeltaScaleRefTouch.current = false;
          isDraggingCvdScaleRefTouch.current = false;
          isDraggingRsiScaleRefTouch.current = false;
          isDraggingBidAskRatioScaleRefTouch.current = false;
          isDraggingLongShortRatioScaleRefTouch.current = false;
          isDraggingBuySellZoneScaleRefTouch.current = false;
        }}
        onTouchCancel={() => {
          isDraggingPriceScaleRef.current = false;
          isDraggingDeltaScaleRefTouch.current = false;
          isDraggingCvdScaleRefTouch.current = false;
          isDraggingRsiScaleRefTouch.current = false;
          isDraggingBidAskRatioScaleRefTouch.current = false;
          isDraggingLongShortRatioScaleRefTouch.current = false;
          isDraggingBuySellZoneScaleRefTouch.current = false;
        }}
        className={`flex-none border-l select-none transition-all duration-300 relative flex flex-col justify-between cursor-ns-resize ${
          isLight ? "bg-[#f8fafc] border-slate-200" : "bg-[#06080f] border-white/5"
        }`}
        style={{ height: totalSvgHeight, width: isMobile ? "54px" : "66px", touchAction: "none" }}
      >
        {(() => {
          const scaleWidth = isMobile ? 54 : 66;
          const labelX = isMobile ? 4 : 8;
          const labelRightX = scaleWidth - (isMobile ? 4 : 8);
          const badgeWidth = scaleWidth - 8;
          const formatPrice = (p: number, decimals?: number) => {
            const fd = decimals !== undefined
              ? decimals
              : (isMobile ? 0 : (activePair.priceStep < 0.1 ? 3 : 1));
            return "$" + p.toLocaleString(undefined, { minimumFractionDigits: fd, maximumFractionDigits: fd });
          };
          // Round-level step + shared decimal count (TradingView style). Reused by the
          // tick labels AND the live price badge so digit counts never disagree.
          const scaleRange = maxPrice - minPrice;
          let scaleStep = snapStepToTick(
            niceStep(scaleRange, chartHeight, isMobile ? 70 : 55),
            activePair.priceStep,
          );
          if (!(scaleStep > 0)) scaleStep = scaleRange;
          const scaleDecimals = decimalsForStep(scaleStep, activePair.priceStep);
          return (
            <svg width={scaleWidth} height={totalSvgHeight} className="absolute inset-0 block pointer-events-none">
              {/* Price Scale Background Panel */}
              <rect
                x={0}
                y={0}
                width={scaleWidth}
                height={totalSvgHeight}
                fill={isLight ? "#f8fafc" : "#06080f"}
              />
              
              {/* Primary left divider line to outline the scale */}
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={totalSvgHeight}
                stroke={isLight ? "#cbd5e1" : "#1e293b"}
                strokeWidth="1.5"
              />

              {/* Price Ticks & Labels — round levels, density follows vertical zoom (TradingView style) */}
              {(() => {
                const nodes: JSX.Element[] = [];
                const range = maxPrice - minPrice;
                // Degenerate range: show a single centered label and bail.
                if (range <= 0 || !isFinite(range)) {
                  const gridY = priceToY(minPrice);
                  nodes.push(
                    <g key="grid-label-0">
                      <line
                        x1={0}
                        y1={gridY}
                        x2={5}
                        y2={gridY}
                        stroke={isLight ? "#94a3b8" : "#475569"}
                        strokeWidth="1.2"
                      />
                      <text
                        x={labelRightX}
                        y={gridY + 4}
                        fill={isLight ? "#1e293b" : "#cbd5e1"}
                        fontSize={isMobile ? "8.5" : "10.5"}
                        fontFamily="'Inter', -apple-system, sans-serif"
                        fontWeight="600"
                        textAnchor="end"
                      >
                        {formatPrice(minPrice, scaleDecimals)}
                      </text>
                    </g>,
                  );
                  return nodes;
                }
                const firstLevel = Math.ceil(minPrice / scaleStep) * scaleStep;
                const MAX_LEVELS = 50; // guard against runaway loop
                for (
                  let price = firstLevel, idx = 0;
                  price <= maxPrice && idx < MAX_LEVELS;
                  price += scaleStep, idx++
                ) {
                  const gridY = priceToY(price);
                  nodes.push(
                    <g key={`grid-label-${idx}`}>
                      {/* Tick Line */}
                      <line
                        x1={0}
                        y1={gridY}
                        x2={5}
                        y2={gridY}
                        stroke={isLight ? "#94a3b8" : "#475569"}
                        strokeWidth="1.2"
                      />
                      {/* Label Text */}
                      <text
                        x={labelRightX}
                        y={gridY + 4}
                        fill={isLight ? "#1e293b" : "#cbd5e1"}
                        fontSize={isMobile ? "8.5" : "10.5"}
                        fontFamily="'Inter', -apple-system, sans-serif"
                        fontWeight="600"
                        textAnchor="end"
                      >
                        {formatPrice(price, scaleDecimals)}
                      </text>
                    </g>,
                  );
                }
                return nodes;
              })()}

              {/* Live Active Price level label */}
              {(() => {
                if (currentPrice === undefined) return null;
                const activePriceY = priceToY(currentPrice);
                if (activePriceY >= margin.top && activePriceY <= margin.top + chartHeight) {
                  const badgeH = isMobile ? 18 : 22;
                  return (
                    <g key="fixed-active-price">
                      <rect
                        x={2}
                        y={activePriceY - badgeH / 2}
                        width={scaleWidth - 4}
                        height={badgeH}
                        fill={isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(245, 158, 11, 0.22)"}
                        rx="3.5"
                        stroke={isLight ? "rgba(15, 23, 42, 0.25)" : "rgba(245, 158, 11, 0.55)"}
                        strokeWidth="1.2"
                      />
                      <text
                        x={labelRightX}
                        y={activePriceY}
                        fill={isLight ? "#0f172a" : "#facc15"}
                        fontSize={isMobile ? "10" : "12.5"}
                        fontFamily="'Inter', -apple-system, sans-serif"
                        fontWeight="900"
                        textAnchor="end"
                        dominantBaseline="central"
                      >
                        {formatPrice(currentPrice, scaleDecimals)}
                      </text>
                    </g>
                  );
                }
                return null;
              })()}

              {/* Horizontal Level Drawing Object price badges on the fixed scale */}
              {[...(areDrawingsVisible ? drawings : []), ...(drawingInProgress ? [drawingInProgress] : [])]
                .filter((d) => d.type === "horizontal")
                .map((d) => {
                  const y = priceToY(d.startPrice);
                  if (y >= margin.top && y <= margin.top + chartHeight) {
                    // Render custom, high-contrast badges for each horizontal line
                    return (
                      <g key={`fixed-level-badge-${d.id}`}>
                        <rect
                          x={3}
                          y={y - 8}
                          width={badgeWidth}
                          height={16}
                          fill={isLight ? "#ffedd5" : "rgba(249, 115, 22, 0.2)"}
                          rx="2"
                          stroke={isLight ? "#f97316" : "#f97316"}
                          strokeWidth="1.2"
                        />
                        <text
                          x={labelX}
                          y={y + 4}
                          fill={isLight ? "#ea580c" : "#f97316"}
                          fontSize={isMobile ? "8" : "9.5"}
                          fontFamily="'Inter', -apple-system, sans-serif"
                          fontWeight="bold"
                          textAnchor="start"
                        >
                          {formatPrice(d.startPrice)}
                        </text>
                      </g>
                    );
                  }
                  return null;
                })}

              {/* Panel Dividers for right pricing panel — order-independent (driven by panelTopY) */}
              {activePanels.length > 0 && (
                <line
                  x1={0}
                  y1={margin.top + chartHeight}
                  x2={scaleWidth}
                  y2={margin.top + chartHeight}
                  stroke={isLight ? "rgba(148, 163, 184, 0.35)" : "rgba(255, 255, 255, 0.16)"}
                  strokeWidth="1"
                />
              )}
              {activePanels.slice(1).map((id) => (
                <line
                  key={`divider-${id}`}
                  x1={0}
                  y1={panelTopY[id]}
                  x2={scaleWidth}
                  y2={panelTopY[id]}
                  stroke={isLight ? "rgba(148, 163, 184, 0.35)" : "rgba(255, 255, 255, 0.16)"}
                  strokeWidth="1"
                />
              ))}

              {/* Delta subchart Y-axis labels */}
              {activeIndicators.delta && (
                <g key="delta-panel-ticks">
                  {/* Top Tick */}
                  <text
                    x={labelX}
                    y={deltaTopY + deltaPanelHeight * 0.02 + 4 + deltaOffset}
                    fill={isLight ? "#047857" : "#10b981"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    +{zoomedMaxCandleDelta.toFixed(1)}K
                  </text>
                  {/* Mid Tick */}
                  <text
                    x={labelX}
                    y={deltaTopY + deltaPanelHeight / 2 + 4 + deltaOffset}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    0.0K
                  </text>
                  {/* Bottom Tick */}
                  <text
                    x={labelX}
                    y={deltaTopY + deltaPanelHeight * 0.98 + 4 + deltaOffset}
                    fill={isLight ? "#be123c" : "#f43f5e"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    -{zoomedMaxCandleDelta.toFixed(1)}K
                  </text>
                </g>
              )}

              {/* CVD subchart Y-axis labels */}
              {activeIndicators.cvd && (
                <g key="cvd-panel-ticks">
                  {/* Top Tick */}
                  <text
                    x={labelX}
                    y={cvdTopY + cvdPanelHeight * 0.02 + 4 + cvdOffset}
                    fill={isLight ? "#7c3aed" : "#c084fc"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    +{zoomedCvdMax.toFixed(1)}K
                  </text>
                  {/* Mid Tick */}
                  <text
                    x={labelX}
                    y={cvdTopY + cvdPanelHeight / 2 + 4 + cvdOffset}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {cvdCenterVal.toFixed(1)}K
                  </text>
                  {/* Bottom Tick */}
                  <text
                    x={labelX}
                    y={cvdTopY + cvdPanelHeight * 0.98 + 4 + cvdOffset}
                    fill={isLight ? "#7c3aed" : "#c084fc"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {zoomedCvdMin.toFixed(1)}K
                  </text>
                </g>
              )}

              {/* RSI subchart Y-axis labels — follow the vertical zoom (centre 50) */}
              {activeIndicators.rsi && (
                <g key="rsi-panel-ticks">
                  {/* Top = zoomed max */}
                  <text
                    x={labelX}
                    y={rsiTopY + 10 + rsiOffset}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {Math.round(zoomedRsiMax)}
                  </text>
                  {/* 70 — only when inside the visible zoom window */}
                  {zoomedRsiMin <= 70 && zoomedRsiMax >= 70 && (
                    <text
                      x={labelX}
                      y={rsiTopY + rsiYInPanel(70) + 4}
                      fill={isLight ? "#be123c" : "#f43f5e"}
                      fontSize={isMobile ? "8" : "9"}
                      fontFamily="'Inter', -apple-system, sans-serif"
                      fontWeight="bold"
                    >
                      70
                    </text>
                  )}
                  {/* 50 centre */}
                  <text
                    x={labelX}
                    y={rsiTopY + rsiYInPanel(50) + 4}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    50
                  </text>
                  {/* 30 — only when inside the visible zoom window */}
                  {zoomedRsiMin <= 30 && zoomedRsiMax >= 30 && (
                    <text
                      x={labelX}
                      y={rsiTopY + rsiYInPanel(30) + 4}
                      fill={isLight ? "#047857" : "#10b981"}
                      fontSize={isMobile ? "8" : "9"}
                      fontFamily="'Inter', -apple-system, sans-serif"
                      fontWeight="bold"
                    >
                      30
                    </text>
                  )}
                  {/* Bottom = zoomed min */}
                  <text
                    x={labelX}
                    y={rsiTopY + rsiPanelHeight - 3 + rsiOffset}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {Math.round(zoomedRsiMin)}
                  </text>
                </g>
              )}

              {/* Bid & Ask Ratio subchart Y-axis labels — right scale, follow zoom */}
              {activeIndicators.bidAskRatio && (
                <g key="bidaskratio-panel-ticks">
                  {/* Top = +zoomed max (bull colour) */}
                  <text
                    x={labelX}
                    y={bidAskRatioTopY + ratioYInPanel(zoomedRatioMax) + 9}
                    fill={bidAskRatioBullColor}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    +{zoomedRatioMax.toFixed(2)}
                  </text>
                  {/* Centre = 0.00 */}
                  <text
                    x={labelX}
                    y={bidAskRatioTopY + bidAskRatioPanelHeight / 2 + 4 + bidAskRatioOffset}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    0.00
                  </text>
                  {/* Bottom = zoomed min (bear colour) */}
                  <text
                    x={labelX}
                    y={bidAskRatioTopY + ratioYInPanel(zoomedRatioMin) - 2}
                    fill={bidAskRatioBearColor}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {zoomedRatioMin.toFixed(2)}
                  </text>
                </g>
              )}

              {/* Long/Short Ratio subchart Y-axis labels — right scale, follow zoom */}
              {activeIndicators.longShortRatio && (
                <g key="longshortratio-panel-ticks">
                  {/* Top = zoomed max (line colour) */}
                  <text
                    x={labelX}
                    y={longShortRatioTopY + longShortRatioPanelHeight * 0.02 + 4 + longShortRatioOffset}
                    fill={longShortRatioLineColor}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {longShortRatioDisplayMode === "longPct" ? `${Math.round(zoomedLsrMax)}%` : zoomedLsrMax.toFixed(2)}
                  </text>
                  {/* Centre = visible centre value (grey) */}
                  <text
                    x={labelX}
                    y={longShortRatioTopY + longShortRatioPanelHeight / 2 + 4 + longShortRatioOffset}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {longShortRatioDisplayMode === "longPct" ? `${Math.round(lsrCenterVal)}%` : lsrCenterVal.toFixed(2)}
                  </text>
                  {/* Bottom = zoomed min (line colour) */}
                  <text
                    x={labelX}
                    y={longShortRatioTopY + longShortRatioPanelHeight * 0.98 + 4 + longShortRatioOffset}
                    fill={longShortRatioLineColor}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {longShortRatioDisplayMode === "longPct" ? `${Math.round(zoomedLsrMin)}%` : zoomedLsrMin.toFixed(2)}
                  </text>
                </g>
              )}

              {/* Buy/Sell Zone subchart Y-axis labels — fixed 0..100, follow zoom (centre 50) */}
              {activeIndicators.buySellZone && (
                <g key="buysellzone-panel-ticks">
                  {/* Top = zoomed max */}
                  <text
                    x={labelX}
                    y={buySellZoneTopY + 10 + buySellZoneOffset}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {Math.round(zoomedBsMax)}
                  </text>
                  {/* 80 — overheat up (line colour) */}
                  {zoomedBsMin <= 80 && zoomedBsMax >= 80 && (
                    <text
                      x={labelX}
                      y={buySellZoneTopY + getBsZoneY(80, buySellZonePanelHeight) + 4}
                      fill={isLight ? "#be123c" : "#f43f5e"}
                      fontSize={isMobile ? "8" : "9"}
                      fontFamily="'Inter', -apple-system, sans-serif"
                      fontWeight="bold"
                    >
                      80
                    </text>
                  )}
                  {/* 50 centre */}
                  {zoomedBsMin <= 50 && zoomedBsMax >= 50 && (
                    <text
                      x={labelX}
                      y={buySellZoneTopY + getBsZoneY(50, buySellZonePanelHeight) + 4}
                      fill={isLight ? "#475569" : "#94a3b8"}
                      fontSize={isMobile ? "8" : "9"}
                      fontFamily="'Inter', -apple-system, sans-serif"
                      fontWeight="bold"
                    >
                      50
                    </text>
                  )}
                  {/* 20 — overheat down (green) */}
                  {zoomedBsMin <= 20 && zoomedBsMax >= 20 && (
                    <text
                      x={labelX}
                      y={buySellZoneTopY + getBsZoneY(20, buySellZonePanelHeight) + 4}
                      fill={isLight ? "#047857" : "#10b981"}
                      fontSize={isMobile ? "8" : "9"}
                      fontFamily="'Inter', -apple-system, sans-serif"
                      fontWeight="bold"
                    >
                      20
                    </text>
                  )}
                  {/* Bottom = zoomed min */}
                  <text
                    x={labelX}
                    y={buySellZoneTopY + buySellZonePanelHeight - 3 + buySellZoneOffset}
                    fill={isLight ? "#475569" : "#94a3b8"}
                    fontSize={isMobile ? "8" : "9"}
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                  >
                    {Math.round(zoomedBsMin)}
                  </text>
                </g>
              )}

              {/* S1: Hover Crosshair price label — always mounted, shown/hidden imperatively.
                  Position and price text are written from handleSvgMouseMove via refs, so the
                  surrounding SVG/component does not re-render on every mouse move. */}
              <g
                key="fixed-crosshair-price"
                ref={crosshairPriceGroupRef}
                style={{ display: "none" }}
              >
                <rect
                  ref={crosshairPriceRectRef}
                  x={3}
                  y={0}
                  width={scaleWidth - 6}
                  height={21}
                  fill={isLight ? "#4f46e5" : "#6366f1"}
                  rx="3"
                  stroke={isLight ? "#3730a3" : "#818cf8"}
                  strokeWidth="1.2"
                />
                <text
                  ref={crosshairPriceTextRef}
                  x={labelRightX}
                  y={0}
                  fill="#ffffff"
                  fontSize={isMobile ? "9" : "10"}
                  fontFamily="'Inter', -apple-system, sans-serif"
                  fontWeight="800"
                  textAnchor="end"
                  dominantBaseline="central"
                  style={{ filter: "drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.6))" }}
                >
                  --
                </text>
              </g>
            </svg>
          );
        })()}
      </div>

      {/* Absolute Pinned Indicators Control Overlays (Top-right of subcharts).
          Rendered in a single loop over active footer panels so order/arrows/RSI work automatically. */}
      {activePanels.map((id, idx) => {
        const meta =
          id === "delta" ? { label: "(PROCLUSTER) DELTA", dotColor: null as string | null, valueRef: deltaValueSpanRef } :
          id === "cvd"   ? { label: "(PROCLUSTER) CVD",   dotColor: cvdLineColor as string | null, valueRef: cvdValueSpanRef } :
          id === "rsi"   ? { label: "(PROCLUSTER) RSI",   dotColor: rsiLineColor as string | null, valueRef: rsiValueSpanRef } :
          id === "bidAskRatio" ? { label: "(PROCLUSTER) Bid & Ask Ratio", dotColor: bidAskRatioBullColor as string | null, valueRef: bidAskRatioValueSpanRef } :
          id === "longShortRatio" ? { label: "(PROCLUSTER) Long/Short Ratio", dotColor: longShortRatioLineColor as string | null, valueRef: longShortRatioValueSpanRef } :
          id === "buySellZone" ? { label: "(PROCLUSTER) Buy/Sell Zone", dotColor: bsZoneLineColor as string | null, valueRef: buySellZoneValueSpanRef } :
          null;
        if (!meta) return null;
        const isFirst = idx === 0;
        const isLast = idx === activePanels.length - 1;
        const iconBtnCls = `p-0.5 rounded transition-all duration-150 cursor-pointer ${
          isLight ? "hover:bg-slate-200 text-slate-500 hover:text-slate-800" : "hover:bg-white/10 text-slate-400 hover:text-white"
        }`;
        const arrowBtnCls = (disabled: boolean) => `p-0.5 rounded transition-all duration-150 ${
          disabled ? "opacity-30 cursor-default" : "cursor-pointer"
        } ${isLight ? "hover:bg-slate-200 text-slate-500 hover:text-slate-800" : "hover:bg-white/10 text-slate-400 hover:text-white"}`;
        return (
          <div
            key={`plate-${id}`}
            className="absolute z-30 flex items-center gap-2 px-3 py-1 rounded-lg border shadow-xl backdrop-blur-md transition-all duration-300 select-none"
            style={{
              top: `${panelTopY[id] + 1}px`,
              right: "76px", // Pinned just to the left of the 66px price scale panel
              backgroundColor: isLight ? "rgba(241, 245, 249, 0.9)" : "rgba(15, 23, 42, 0.75)",
              borderColor: isLight ? "rgba(203, 213, 225, 0.8)" : "rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Label / Dynamic value indicator */}
            <div className="flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] font-bold tracking-wider">
              {meta.dotColor && (
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.dotColor }} />
              )}
              <span className={isLight ? "text-slate-800" : "text-white"}>{meta.label}</span>
              {/* S1: value — written imperatively in handleSvgMouseMove via ref. */}
              <span ref={meta.valueRef} className="text-slate-500">--</span>
            </div>

            <div className={`w-[1px] h-3 ${isLight ? "bg-slate-300" : "bg-white/10"}`} />

            {/* Control Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { if (!isFirst) movePanel(id, -1); }}
                disabled={isFirst}
                className={arrowBtnCls(isFirst)}
                title="Move panel up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => { if (!isLast) movePanel(id, 1); }}
                disabled={isLast}
                className={arrowBtnCls(isLast)}
                title="Move panel down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              <button onClick={() => onToggleVisibility?.(id)} className={iconBtnCls} title="Hide panel">
                <Eye className="w-3.5 h-3.5" />
              </button>

              <button onClick={() => onShowIndicatorsSettings?.(id)} className={iconBtnCls} title="Panel settings">
                <Settings className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => onRemoveIndicator?.(id)}
                className={`p-0.5 rounded transition-all duration-150 cursor-pointer ${
                  isLight ? "hover:bg-slate-300 hover:text-rose-600 text-slate-500" : "hover:bg-rose-500/20 hover:text-rose-450 text-slate-400"
                }`}
                title="Remove panel"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}

      {/* Interactive Drag Handles / Resizing Splitters */}
      {activeIndicators.delta && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingPanel("delta");
          }}
          className={`absolute left-0 right-0 z-40 cursor-ns-resize flex items-center justify-center group`}
          style={{
            top: `${deltaTopY}px`,
            height: "14px",
            transform: "translateY(-7px)"
          }}
          title="Drag to resize Delta Panel"
        >
          {/* Subtle colored horizontal line that lights up when hovered */}
          <div className="w-24 h-[3px] rounded-full bg-yellow-500/0 group-hover:bg-yellow-500/85 transition-all duration-200 shadow-md shadow-yellow-500/40" />
        </div>
      )}

      {activeIndicators.cvd && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingPanel("cvd");
          }}
          className={`absolute left-0 right-0 z-40 cursor-ns-resize flex items-center justify-center group`}
          style={{
            top: `${cvdTopY}px`,
            height: "14px",
            transform: "translateY(-7px)"
          }}
          title="Drag to resize CVD Panel"
        >
          {/* Subtle colored horizontal line that lights up when hovered */}
          <div className="w-24 h-[3px] rounded-full bg-yellow-500/0 group-hover:bg-yellow-500/85 transition-all duration-200 shadow-md shadow-yellow-500/40" />
        </div>
      )}

      {activeIndicators.rsi && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingPanel("rsi");
          }}
          className={`absolute left-0 right-0 z-40 cursor-ns-resize flex items-center justify-center group`}
          style={{
            top: `${rsiTopY}px`,
            height: "14px",
            transform: "translateY(-7px)"
          }}
          title="Drag to resize RSI Panel"
        >
          {/* Subtle colored horizontal line that lights up when hovered */}
          <div className="w-24 h-[3px] rounded-full bg-yellow-500/0 group-hover:bg-yellow-500/85 transition-all duration-200 shadow-md shadow-yellow-500/40" />
        </div>
      )}

      {activeIndicators.bidAskRatio && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingPanel("bidAskRatio");
          }}
          className={`absolute left-0 right-0 z-40 cursor-ns-resize flex items-center justify-center group`}
          style={{
            top: `${bidAskRatioTopY}px`,
            height: "14px",
            transform: "translateY(-7px)"
          }}
          title="Drag to resize Bid & Ask Ratio Panel"
        >
          {/* Subtle colored horizontal line that lights up when hovered */}
          <div className="w-24 h-[3px] rounded-full bg-yellow-500/0 group-hover:bg-yellow-500/85 transition-all duration-200 shadow-md shadow-yellow-500/40" />
        </div>
      )}

      {activeIndicators.longShortRatio && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingPanel("longShortRatio");
          }}
          className={`absolute left-0 right-0 z-40 cursor-ns-resize flex items-center justify-center group`}
          style={{
            top: `${longShortRatioTopY}px`,
            height: "14px",
            transform: "translateY(-7px)"
          }}
          title="Drag to resize Long/Short Ratio Panel"
        >
          {/* Subtle colored horizontal line that lights up when hovered */}
          <div className="w-24 h-[3px] rounded-full bg-yellow-500/0 group-hover:bg-yellow-500/85 transition-all duration-200 shadow-md shadow-yellow-500/40" />
        </div>
      )}

      {activeIndicators.buySellZone && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingPanel("buySellZone");
          }}
          className={`absolute left-0 right-0 z-40 cursor-ns-resize flex items-center justify-center group`}
          style={{
            top: `${buySellZoneTopY}px`,
            height: "14px",
            transform: "translateY(-7px)"
          }}
          title="Drag to resize Buy/Sell Zone Panel"
        >
          {/* Subtle colored horizontal line that lights up when hovered */}
          <div className="w-24 h-[3px] rounded-full bg-yellow-500/0 group-hover:bg-yellow-500/85 transition-all duration-200 shadow-md shadow-yellow-500/40" />
        </div>
      )}

      {/* Chart Settings Dropdown — anchored under the settings button (rect from ChartToolsHeader) */}
      <Portal>
        <AnimatePresence>
          {showChartSettings && settingsBtnRect && (
            <motion.div
              ref={settingsDropdownRef}
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className={`rounded-xl p-2 w-72 max-w-[calc(100vw-16px)] flex flex-col gap-1.5 shadow-2xl border select-none ${
                isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#0c0e17] border-white/10 text-slate-100"
              }`}
              style={{
                position: "fixed",
                top: settingsBtnRect.bottom + 6,
                left: Math.max(8, settingsBtnRect.right - 288),
                zIndex: 99999,
              }}
            >
              {/* Candle outlines toggle (unchanged local state) */}
              <div className={`p-3 rounded-lg border ${isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.03] border-white/5"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold">{language === "RU" ? "Обводка свечей" : language === "KZ" ? "Шамдарды контурлау" : "Candle Outlines"}</span>
                    <span className={`text-[10px] ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                      {language === "RU" ? "Показывать каркас в режиме футпринт/кластера" : language === "KZ" ? "Футпринт/кластер режимінде қаңқаны көрсету" : "Show frame in footprint/clusters mode"}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowCandleOutline(!showCandleOutline)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                      showCandleOutline ? "bg-amber-500" : (isLight ? "bg-slate-300" : "bg-slate-700")
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                      showCandleOutline ? "translate-x-4.5" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>
              </div>

              {/* Abbreviate numbers toggle (per symbol+market; no-op in provider-less preview) */}
              <div className={`p-3 rounded-lg border ${isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.03] border-white/5"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold">{language === "RU" ? "Сокращение чисел" : language === "KZ" ? "Сандарды қысқарту" : "Abbreviate numbers"}</span>
                    <span className={`text-[10px] ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                      {language === "RU" ? "Показывать большие числа как 2.6к, 1.1м" : language === "KZ" ? "Үлкен сандарды 2.6к, 1.1м түрінде көрсету" : "Show large numbers as 2.6k, 1.1m"}
                    </span>
                  </div>
                  <button
                    onClick={() => onToggleAbbreviateNumbers?.()}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                      abbreviateNumbers ? "bg-amber-500" : (isLight ? "bg-slate-300" : "bg-slate-700")
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                      abbreviateNumbers ? "translate-x-4.5" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>
              </div>

              {/* Hide cluster numbers toggle (per symbol+market; no-op in provider-less preview) */}
              <div className={`p-3 rounded-lg border ${isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.03] border-white/5"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold">{language === "RU" ? "Скрыть числа в кластерах" : language === "KZ" ? "Кластерлердегі сандарды жасыру" : "Hide cluster numbers"}</span>
                    <span className={`text-[10px] ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                      {language === "RU" ? "Не показывать цифры внутри ячеек" : language === "KZ" ? "Ұяшықтардағы сандарды көрсетпеу" : "Don't show numbers inside cells"}
                    </span>
                  </div>
                  <button
                    onClick={() => onToggleHideClusterNumbers?.()}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                      hideClusterNumbers ? "bg-amber-500" : (isLight ? "bg-slate-300" : "bg-slate-700")
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                      hideClusterNumbers ? "translate-x-4.5" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Portal>

      {/* ── Admin FPS overlay ─────────────────────────────────────────────── */}
      {(userRole ?? "").toLowerCase() === "admin" && (
        <div
          className="absolute top-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm select-none pointer-events-none"
          style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", lineHeight: 1, right: `${margin.right + 8}px` }}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <span className="text-emerald-400 tracking-wider">
            {fpsDisplay === null ? "— FPS" : `${fpsDisplay} FPS`}
          </span>
        </div>
      )}


    </div>



      {/* Floating Cluster Search Tooltip */}
      {/* S1: Cluster Search tooltip — always mounted; visibility/position/text updated
          imperatively via refs from handleSvgMouseMove (updateClusterTooltipDom). */}
      {finalShowAnomalies && (
        <div
          ref={clusterTooltipRef}
          className={`absolute border rounded-[16px] p-4 text-sm shadow-2xl z-50 flex-col gap-3 backdrop-blur-md pointer-events-none transition-all duration-100 ${
            isLight
              ? "bg-white/95 border-slate-200 text-slate-800 shadow-xl shadow-slate-250/50"
              : "liquid-glass-card border-none text-slate-100 shadow-black/80 shadow-2xl"
          }`}
          style={{
            display: "none",
            left: "0px",
            top: "0px",
            width: "265px"
          }}
        >
          <span className="font-bold flex items-center justify-between uppercase tracking-wider border-b pb-2 border-dashed border-slate-200/20 font-mono text-[11.5px]">
            <span
              ref={clusterTooltipTitleWrapRef}
              className="flex items-center gap-1.5 font-extrabold"
            >
              <Activity className="w-4 h-4" />
              <span ref={clusterTooltipTitleTextRef}>
                {language === "RU" ? "ПОИСК АНОМАЛИЙ" : "ANOMALY SEARCH"}
              </span>
            </span>
            <span
              ref={clusterTooltipBadgeRef}
              className="px-2 py-0.5 rounded text-[9.5px] font-black uppercase bg-blue-500/25 text-blue-400 border border-blue-500/20"
            >
              --
            </span>
          </span>

          <div className={`grid grid-cols-[1.2fr_1fr] gap-x-2.5 gap-y-2 font-mono text-[12.5px] ${
            isLight ? "text-slate-600" : "text-slate-400"
          }`}>
            <span>{language === "RU" ? "Объем (монеты):" : "Volume (coins):"}</span>
            <span
              ref={clusterTooltipVolumeCoinsRef}
              className={`font-bold text-right ${isLight ? "text-slate-900" : "text-white"}`}
            >
              --
            </span>

            <span>{language === "RU" ? "Объем в USDT:" : "Volume in USDT:"}</span>
            <span
              ref={clusterTooltipVolumeUsdtRef}
              className={`font-bold text-right ${isLight ? "text-slate-900" : "text-white"}`}
            >
              --
            </span>

            <div className={`col-span-2 border-t border-dashed my-0.5 ${
              isLight ? "border-slate-200" : "border-white/5"
            }`} />

            <span>{language === "RU" ? "Дисбаланс:" : "Imbalance:"}</span>
            <span
              ref={clusterTooltipImbalanceRef}
              className="font-black text-right"
            >
              --
            </span>
          </div>
        </div>
      )}

      {/* Floating Volume Profile Settings Overlay */}
      {volumeSettingsDrawingId !== null && (() => {
        const selDrawing = drawings.find((d) => d.id === volumeSettingsDrawingId);
        if (!selDrawing || selDrawing.type !== "volume") return null;

        return (
          <div className={`absolute top-[60px] left-[60px] z-50 p-4 rounded-2xl border flex flex-col gap-3.5 font-sans text-xs shadow-2xl w-64 backdrop-blur-md transition-all duration-300 ${
            isLight
              ? "bg-white/95 border-slate-200/90 text-slate-800 shadow-slate-200/55"
              : "bg-slate-950/90 border-white/10 text-white shadow-black/80"
          }`}>
            <div className="flex items-center justify-between border-b pb-2 border-slate-500/10">
              <span className="font-extrabold text-[10.5px] uppercase tracking-wider font-mono">
                {language === "RU" ? "Настройка профиля объема" : "Volume Profile Settings"}
              </span>
              <button
                onClick={() => setVolumeSettingsDrawingId(null)}
                className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer py-1 select-none hover:opacity-90">
              <input
                type="checkbox"
                checked={volProfileGlobalSettings.extendPoc ?? false}
                onChange={(e) => {
                  updateVolProfileSettings({ extendPoc: e.target.checked });
                }}
                className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 mt-0.5"
              />
              <div className="flex flex-col">
                <span className="font-bold text-[11px] leading-tight">
                  {language === "RU" ? "Продлевать POC до касания" : "Extend POC to Touch"}
                </span>
                <span className={`text-[9.5px] leading-relaxed mt-0.5 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                  {language === "RU"
                    ? "Уровень POC растянутого профиля объема будет продлеваться, пока его не коснется или не пересечет другая свеча."
                    : "The POC level line of the stretched profile will continue until a future candle touches or intersects it."}
                </span>
              </div>
            </label>

            <div className="flex flex-col gap-2 border-t border-slate-500/10 pt-2.5">
              <span className="font-extrabold text-[9px] uppercase tracking-widest font-mono text-amber-500">
                {language === "RU" ? "Прозрачности" : "Opacities"}
              </span>
              {[
                { key: "vpVaOpacity",     labelRu: "Value Area",        labelEn: "Value Area" },
                { key: "vpOutVaOpacity",  labelRu: "Вне Value Area",    labelEn: "Out of Value Area" },
                { key: "vpPocOpacity",    labelRu: "Линия POC",         labelEn: "POC" },
                { key: "vpBgOpacity",     labelRu: "Фон",               labelEn: "Background" },
                { key: "vpBorderOpacity", labelRu: "Обводка",           labelEn: "Border" },
              ].map((row) => {
                const v = (volProfileGlobalSettings as any)[row.key] as number | undefined;
                const val = typeof v === "number" ? v : 0.28;
                return (
                  <div key={row.key} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10.5px] font-bold">
                      <span>{language === "RU" ? row.labelRu : row.labelEn}</span>
                      <span className="font-mono font-bold text-amber-500">
                        {Math.round(val * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="1.0"
                      step="0.01"
                      value={val}
                      onChange={(e) => {
                        updateVolProfileSettings({ [row.key]: parseFloat(e.target.value) } as any);
                      }}
                      className={`w-full accent-blue-600 rounded-lg h-1 ${isLight ? "bg-slate-200" : "bg-slate-800"}`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-slate-500/10 pt-2.5">
              <span className="font-bold text-[10.5px]">
                {language === "RU" ? "Цвет гистограммы" : "Histogram Color"}
              </span>
              <input
                type="color"
                value={volProfileGlobalSettings.volColor || (isLight ? "#2563eb" : "#3b82f6")}
                onChange={(e) => { updateVolProfileSettings({ volColor: e.target.value }); }}
                className="vp-color-swatch w-7 h-7 border border-white/15 shadow-sm"
                aria-label={language === "RU" ? "Цвет гистограммы" : "Histogram color"}
              />
            </div>

            <div className="flex items-center justify-between border-t border-slate-500/10 pt-2.5">
              <span className="font-bold text-[10.5px]">
                {language === "RU" ? "Цвет линии POC" : "POC Line Color"}
              </span>
              <input
                type="color"
                value={volProfileGlobalSettings.pocColor || (isLight ? "#2563eb" : "#3b82f6")}
                onChange={(e) => { updateVolProfileSettings({ pocColor: e.target.value }); }}
                className="vp-color-swatch w-7 h-7 border border-white/15 shadow-sm"
                aria-label={language === "RU" ? "Цвет линии POC" : "POC line color"}
              />
            </div>
          </div>
        );
      })()}

      {/* Floating Long/Short Position Settings Overlay */}
      {positionSettingsDrawingId !== null && (() => {
        const selDrawing = drawings.find((d) => d.id === positionSettingsDrawingId);
        if (!selDrawing || (selDrawing.type !== "long" && selDrawing.type !== "short")) return null;

        return (
          <div className={`absolute top-[60px] left-[60px] z-50 p-4 rounded-2xl border flex flex-col gap-3 font-sans text-xs shadow-2xl w-72 backdrop-blur-md transition-all duration-300 ${
            isLight
              ? "bg-white/95 border-slate-200/90 text-slate-800 shadow-slate-200/55"
              : "bg-slate-950/90 border-white/10 text-white shadow-black/80"
          }`}>
            <div className="flex items-center justify-between border-b pb-2 border-slate-500/10">
              <span className="font-extrabold text-[10.5px] uppercase tracking-wider font-mono">
                {language === "RU" ? "Настройка позиции" : "Position Settings"}
              </span>
              <button
                onClick={() => setPositionSettingsDrawingId(null)}
                className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-bold text-[10px] uppercase opacity-75">{language === "RU" ? "Размер депозита ($)" : "Deposit Size ($)"}</span>
              <input
                type="number"
                value={selDrawing.deposit ?? positionGlobalSettings.deposit}
                onChange={(e) => { updatePositionSettings({ deposit: parseFloat(e.target.value) || 0 }); }}
                className={`px-2.5 py-1.5 text-xs rounded-lg border font-mono ${
                  isLight ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-slate-900 border-white/10 text-white"
                }`}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-bold text-[10px] uppercase opacity-75">{language === "RU" ? "Риск на сделку" : "Trade Risk"}</span>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={selDrawing.risk ?? positionGlobalSettings.risk}
                  onChange={(e) => { updatePositionSettings({ risk: parseFloat(e.target.value) || 0 }); }}
                  className={`flex-1 px-2.5 py-1.5 text-xs rounded-lg border font-mono ${
                    isLight ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-slate-900 border-white/10 text-white"
                  }`}
                />
                <div className="flex rounded-lg overflow-hidden border border-slate-500/10">
                  <button
                    onClick={() => updatePositionSettings({ riskType: "percent" })}
                    className={`px-3 py-1 bg-transparent font-bold cursor-pointer transition-colors ${
                      (selDrawing.riskType ?? positionGlobalSettings.riskType) === "percent"
                        ? "bg-amber-500/20 text-amber-500"
                        : "hover:bg-white/5 opacity-60"
                    }`}
                  >
                    %
                  </button>
                  <button
                    onClick={() => updatePositionSettings({ riskType: "cash" })}
                    className={`px-3 py-1 bg-transparent font-bold cursor-pointer transition-colors ${
                      (selDrawing.riskType ?? positionGlobalSettings.riskType) === "cash"
                        ? "bg-amber-500/20 text-amber-500"
                        : "hover:bg-white/5 opacity-60"
                    }`}
                  >
                    $
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-slate-500/10 pt-2.5">
              <div className="flex flex-col gap-1">
                <span className="font-bold text-[10px] uppercase opacity-75">{language === "RU" ? "Мейкер % (Лимит)" : "Maker % (Limit)"}</span>
                <input
                  type="number"
                  step="0.005"
                  value={selDrawing.makerFee !== undefined ? selDrawing.makerFee : positionGlobalSettings.makerFee}
                  onChange={(e) => { updatePositionSettings({ makerFee: parseFloat(e.target.value) || 0 }); }}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border font-mono ${
                    isLight ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-slate-900 border-white/10 text-white"
                  }`}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-bold text-[10px] uppercase opacity-75">{language === "RU" ? "Тейкер % (Рынок)" : "Taker % (Market)"}</span>
                <input
                  type="number"
                  step="0.005"
                  value={selDrawing.takerFee !== undefined ? selDrawing.takerFee : positionGlobalSettings.takerFee}
                  onChange={(e) => { updatePositionSettings({ takerFee: parseFloat(e.target.value) || 0 }); }}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border font-mono ${
                    isLight ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-slate-900 border-white/10 text-white"
                  }`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-[#8a94a6]">{language === "RU" ? "Вход:" : "Entry:"}</span>
                <select
                  value={selDrawing.entryFeeType ?? positionGlobalSettings.entryFeeType}
                  onChange={(e) => updatePositionSettings({ entryFeeType: e.target.value as any })}
                  className={`px-1.5 py-1 rounded text-[10px] outline-none border ${
                    isLight ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-slate-900 border-white/10 text-white"
                  }`}
                >
                  <option value="maker">Limit (Maker)</option>
                  <option value="taker">Market (Taker)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-[#8a94a6]">{language === "RU" ? "Выход:" : "Exit:"}</span>
                <select
                  value={selDrawing.exitFeeType ?? positionGlobalSettings.exitFeeType}
                  onChange={(e) => updatePositionSettings({ exitFeeType: e.target.value as any })}
                  className={`px-1.5 py-1 rounded text-[10px] outline-none border ${
                    isLight ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-slate-900 border-white/10 text-white"
                  }`}
                >
                  <option value="maker">Limit (Maker)</option>
                  <option value="taker">Market (Taker)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1 border-t border-slate-500/10 pt-2.5">
              <div className="flex justify-between font-bold text-[10.5px]">
                <span>{language === "RU" ? "Размер текста" : "Text Font Size"}</span>
                <span className="font-mono text-amber-500">{selDrawing.fontSize ?? positionGlobalSettings.fontSize}px</span>
              </div>
              <input
                type="range"
                min="8"
                max="14"
                step="1"
                value={selDrawing.fontSize ?? positionGlobalSettings.fontSize}
                onChange={(e) => { updatePositionSettings({ fontSize: parseInt(e.target.value) || 10 }); }}
                className={`w-full accent-blue-600 rounded-lg h-1 ${isLight ? "bg-slate-200" : "bg-slate-800"}`}
              />
            </div>

            <div className="flex flex-col gap-1 border-t border-slate-500/10 pt-2.5">
              <div className="flex justify-between font-bold text-[10.5px]">
                <span>{language === "RU" ? "Прозрачность зон" : "Zones Opacity"}</span>
                <span className="font-mono text-amber-500">
                  {Math.round((selDrawing.opacity !== undefined ? selDrawing.opacity : positionGlobalSettings.opacity) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.8"
                step="0.05"
                value={selDrawing.opacity !== undefined ? selDrawing.opacity : positionGlobalSettings.opacity}
                onChange={(e) => { updatePositionSettings({ opacity: parseFloat(e.target.value) }); }}
                className={`w-full accent-blue-600 rounded-lg h-1 ${isLight ? "bg-slate-200" : "bg-slate-800"}`}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-slate-500/10 pt-2.5 pb-1">
              <div className="flex flex-col gap-1">
                <span className="font-bold text-[9px] uppercase opacity-75">{language === "RU" ? "Цвет цели" : "Target Color"}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={rgbaToHex(selDrawing.colorTarget || positionGlobalSettings.colorTarget) || "#10b981"}
                    onChange={(e) => { updatePositionSettings({ colorTarget: e.target.value }); }}
                    className="w-6 h-6 rounded cursor-pointer border-0 p-0 overflow-hidden shrink-0"
                  />
                  <span className="text-[10px] text-zinc-500">Pick</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-bold text-[9px] uppercase opacity-75">{language === "RU" ? "Цвет стопа" : "Stop Color"}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={rgbaToHex(selDrawing.colorStop || positionGlobalSettings.colorStop) || "#ef4444"}
                    onChange={(e) => { updatePositionSettings({ colorStop: e.target.value }); }}
                    className="w-6 h-6 rounded cursor-pointer border-0 p-0 overflow-hidden shrink-0"
                  />
                  <span className="text-[10px] text-zinc-500">Pick</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modern, non-blocking custom modal dialog for the text annotation tool */}
      {textInputModal && (
        <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-xs select-none">
          <div className={`p-5 rounded-2xl border w-96 max-w-full shadow-2xl flex flex-col gap-4 ${
            isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#0c0e17] border-white/10 text-slate-100"
          }`}>
            <h3 className="text-sm font-bold tracking-tight">
              {language === "RU" ? "Добавить текстовую заметку" : "Add Text Annotation"}
            </h3>
            <textarea
              className={`w-full p-2.5 rounded-lg border text-xs focus:outline-none focus:ring-1 ${
                isLight 
                  ? "border-slate-300 bg-slate-50 focus:ring-amber-500 focus:border-amber-500 text-slate-800" 
                  : "border-white/10 bg-white/5 focus:ring-amber-500 focus:border-amber-500 text-slate-100"
              }`}
              rows={3}
              placeholder={language === "RU" ? "Введите ваш текст здесь..." : "Type your annotation here..."}
              value={textInputValue}
              onChange={(e) => setTextInputValue(e.target.value)}
              autoFocus
            />

            {/* Custom Color Selector */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold tracking-tight uppercase opacity-60">
                {language === "RU" ? "Цвет текста:" : "Text Color:"}
              </span>
              <div className="flex gap-2">
                {[
                  "#ef4444", // Red
                  "#10b981", // Green
                  "#f59e0b", // Gold
                  "#3b82f6", // Blue
                  "#a855f7", // Purple
                  "#ec4899", // Pink
                  isLight ? "#0f172a" : "#f1f5f9" // Theme contrasting
                ].map((color) => (
                  <button
                    key={color}
                    onClick={() => setTextInputColor(color)}
                    style={{ backgroundColor: color }}
                    className={`w-6 h-6 rounded-full cursor-pointer relative transition-all border ${
                      textInputColor === color 
                        ? "scale-110 ring-2 ring-amber-500 ring-offset-2 ring-offset-slate-950 border-white"
                        : "border-transparent opacity-80 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Custom Font Size Selector */}
            <div className="flex flex-col gap-1.5 mb-1">
              <span className="text-[11px] font-bold tracking-tight uppercase opacity-60">
                {language === "RU" ? "Размер шрифта:" : "Font Size:"}
              </span>
              <div className="flex gap-1.5">
                {[9, 11, 13, 16, 20, 26].map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setTextInputFontSize(sz)}
                    className={`px-3 py-1 rounded text-xs font-mono font-bold transition-all cursor-pointer border ${
                      textInputFontSize === sz
                        ? "bg-amber-500 text-slate-950 border-amber-600 font-extrabold"
                        : isLight
                          ? "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"
                          : "bg-white/5 text-slate-300 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {sz}px
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setTextInputModal(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  isLight ? "bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium" : "bg-white/5 hover:bg-white/10 text-slate-300"
                }`}
              >
                {language === "RU" ? "Отмена" : "Cancel"}
              </button>
              <button
                onClick={() => {
                  if (textInputValue.trim()) {
                    setDrawings(prev => [
                      ...prev,
                      {
                        id: textInputModal.id,
                        type: "text" as const,
                        startTs: textInputModal.startTs,
                        startPrice: textInputModal.startPrice,
                        endTs: textInputModal.endTs,
                        endPrice: textInputModal.endPrice,
                        text: textInputValue.trim(),
                        color: textInputColor,
                        fontSize: textInputFontSize,
                      },
                    ]);
                  }
                  setTextInputModal(null);
                }}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 cursor-pointer"
              >
                {language === "RU" ? "Создать" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
