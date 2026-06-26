// @ts-nocheck
import React, { memo, useState, useRef, useEffect } from "react";
import {
  ZoomIn, ZoomOut, Globe, ChevronDown, Check, Settings, Move,
} from "lucide-react";
import type { CryptoPair, Indicator } from "./types";

interface ChartToolsHeaderProps {
  activePair: CryptoPair;
  marketType: "SPOT" | "FUTURES";
  onToggleMarketType?: () => void;
  indicators?: Indicator[];
  workspaceLayout?: "1" | "2h" | "2v";
  onWorkspaceLayoutChange?: (layout: "1" | "2h" | "2v") => void;
  workspacesCount?: number;
  isLight: boolean;
  language: "RU" | "EN" | "KZ";
  selectedTimezone: string;
  onTimezoneChange: (tz: string) => void;
  showChartSettings: boolean;
  onToggleChartSettings: (rect?: DOMRect) => void;
  onZoom: (factor: number) => void;
  onVerticalZoom: (factor: number) => void;
  onResetZoom: () => void;
}

// Icons are static JSX — allocated once at module load, never recreated
const WORKSPACE_LAYOUTS = [
  {
    id: "1",
    icon: <div className="w-4 h-2.5 border border-current rounded-sm opacity-80" />,
  },
  {
    id: "2h",
    icon: (
      <div className="flex gap-0.5 items-center">
        <div className="w-2 h-2 border border-current rounded-[1px] opacity-80" />
        <div className="w-2 h-2 border border-current rounded-[1px] opacity-80" />
      </div>
    ),
  },
  {
    id: "2v",
    icon: (
      <div className="flex flex-col gap-0.5 items-center justify-center">
        <div className="w-4 h-1.5 border border-current rounded-[1px] opacity-80" />
        <div className="w-4 h-1.5 border border-current rounded-[1px] opacity-80" />
      </div>
    ),
  },
];

function ChartToolsHeaderImpl({
  activePair,
  marketType,
  onToggleMarketType,
  indicators,
  workspaceLayout,
  onWorkspaceLayoutChange,
  workspacesCount = 1,
  isLight,
  language,
  selectedTimezone,
  onTimezoneChange,
  showChartSettings,
  onToggleChartSettings,
  onZoom,
  onVerticalZoom,
  onResetZoom,
}: ChartToolsHeaderProps) {
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (workspaceDropdownRef.current && !workspaceDropdownRef.current.contains(event.target as Node)) {
        setShowWorkspaceMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className={`px-2.5 sm:px-5 py-1 sm:py-1.5 flex items-center justify-between z-20 backdrop-blur-lg border-b transition-all duration-300 ${
      isLight ? "bg-white/35 border-slate-200/50" : "bg-slate-950/80 border-white/5"
    }`}>
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0 flex-1">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-md shadow-emerald-500/30 shrink-0" />
        <h3 className={`text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-1.5 sm:gap-2 shrink-0 ${
          isLight ? "text-slate-700" : "text-slate-200"
        }`}>
          <span className={`font-display font-extrabold text-[12px] sm:text-sm tracking-tight ${
            isLight ? "text-slate-900" : "text-slate-100"
          }`}>{activePair.symbol}</span>
          <span className="text-[10px] text-slate-500">•</span>
          <button
            onClick={onToggleMarketType}
            className={`text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2.5 py-0.5 rounded cursor-pointer border transition-all ${
              marketType === "SPOT"
                ? isLight
                  ? "text-cyan-900 bg-cyan-100 border-cyan-300 font-extrabold shadow-sm hover:bg-cyan-200"
                  : "text-cyan-400 bg-cyan-950/30 border-cyan-500/10 hover:bg-cyan-900/40"
                : isLight
                  ? "text-purple-900 bg-purple-100 border-purple-300 font-extrabold shadow-sm hover:bg-purple-200"
                  : "text-purple-400 bg-purple-950/30 border-purple-500/10 hover:bg-purple-900/40"
            }`}
            title="Click to toggle Market Type"
          >
            {marketType}
          </button>
        </h3>

      </div>

      {/* Toolbar Controls */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Zoom Buttons */}
        <div className={`flex rounded-lg sm:rounded-xl p-[2px] sm:p-[3px] border backdrop-blur-sm shadow-inner gap-0.5 transition-all duration-300 ${
          isLight ? "bg-slate-100 border-slate-200" : "bg-slate-950/60 border-white/5"
        }`} title="Horizontal Scale">
          <button
            onClick={() => onZoom(15)}
            className={`p-1 rounded-md sm:rounded-lg transition-all duration-150 cursor-pointer ${
              isLight ? "hover:bg-slate-200 text-slate-650 hover:text-slate-900" : "hover:bg-white/5 text-slate-400 hover:text-yellow-450"
            }`}
            title="Zoom In (Expand Clusters)"
          >
            <ZoomIn className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
          </button>
          <button
            onClick={() => onZoom(-15)}
            className={`p-1 rounded-md sm:rounded-lg transition-all duration-150 cursor-pointer ${
              isLight ? "hover:bg-slate-200 text-slate-650 hover:text-slate-900" : "hover:bg-white/5 text-slate-400 hover:text-yellow-450"
            }`}
            title="Zoom Out"
          >
            <ZoomOut className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
          </button>
        </div>

        {/* Vertical Price Scale Buttons */}
        <div className={`hidden sm:flex rounded-lg sm:rounded-xl p-[2px] sm:p-[3px] border backdrop-blur-sm shadow-inner gap-0.5 transition-all duration-300 ${
          isLight ? "bg-slate-100 border-slate-200" : "bg-slate-950/60 border-white/5"
        }`} title="Vertical Price Scale">
          <button
            onClick={() => onVerticalZoom(0.15)}
            className={`px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-mono font-bold rounded-md sm:rounded-lg transition-all duration-150 cursor-pointer ${
              isLight ? "hover:bg-slate-200 text-slate-600 hover:text-slate-900" : "hover:bg-white/5 text-slate-400 hover:text-cyan-405"
            }`}
            title="Stretch Vertically (Narrow visible range)"
          >
            ↕+
          </button>
          <button
            onClick={() => onVerticalZoom(-0.15)}
            className={`px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-mono font-bold rounded-md sm:rounded-lg transition-all duration-150 cursor-pointer ${
              isLight ? "hover:bg-slate-200 text-slate-600 hover:text-slate-900" : "hover:bg-white/5 text-slate-400 hover:text-cyan-405"
            }`}
            title="Compress Vertically (Widen visible range)"
          >
            ↕-
          </button>
          <button
            onClick={onResetZoom}
            className={`px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-bold rounded-md sm:rounded-lg transition-all duration-150 font-mono cursor-pointer ${
              isLight ? "hover:bg-slate-200 text-slate-600 hover:text-yellow-600" : "hover:bg-white/5 text-slate-400 hover:text-yellow-450"
            }`}
            title="Reset Zoom & Offsets"
          >
            100%
          </button>
        </div>

        {/* Timezone Select Control */}
        <div className={`border px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-mono font-bold hidden sm:flex items-center gap-1 sm:gap-1.5 shadow-inner transition-all duration-300 ${
          isLight ? "bg-slate-100 border-slate-200/60 text-slate-600" : "bg-slate-950/60 border-white/5 text-slate-400"
        }`}>
          <Globe className={`w-3 sm:w-3.5 h-3 sm:h-3.5 shrink-0 hidden lg:inline ${isLight ? "text-slate-500" : "text-slate-400"}`} />
          <select
            value={selectedTimezone}
            onChange={(e) => onTimezoneChange(e.target.value)}
            className="bg-transparent border-none text-[9px] sm:text-[10px] text-inherit font-sans font-semibold cursor-pointer focus:outline-none pr-0.5 sm:pr-1"
            title={language === "RU" ? "Выбор часового пояса" : "Select Timezone"}
          >
            <option value="local" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
              {language === "RU" ? "Системное" : language === "KZ" ? "Жүйелік" : "Local Time"}
            </option>
            <option value="UTC" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>UTC (GMT)</option>
            <option value="Europe/Moscow" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
              {language === "RU" ? "Москва" : language === "KZ" ? "Мәскеу" : "Moscow"}
            </option>
            <option value="Asia/Almaty" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
              {language === "RU" ? "Алматы" : language === "KZ" ? "Алматы" : "Almaty"}
            </option>
            <option value="Asia/Aqtobe" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
              {language === "RU" ? "Актобе" : language === "KZ" ? "Ақтөбе" : "Aqtobe"}
            </option>
            <option value="Asia/Singapore" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
              {language === "RU" ? "Сингапур" : language === "KZ" ? "Сингапур" : "Singapore"}
            </option>
            <option value="Asia/Tokyo" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
              {language === "RU" ? "Токио" : language === "KZ" ? "Токио" : "Tokyo"}
            </option>
            <option value="Europe/Paris" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
              {language === "RU" ? "Париж" : language === "KZ" ? "Париж" : "Paris"}
            </option>
            <option value="America/New_York" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
              {language === "RU" ? "Нью-Йорк" : language === "KZ" ? "Нью-Йорк" : "New York"}
            </option>
          </select>
        </div>

        {/* Workspace Layout Control */}
        {workspaceLayout && onWorkspaceLayoutChange && (
          <div className="relative font-sans shrink-0" ref={workspaceDropdownRef}>
            <button
              onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
              className={`flex items-center justify-between gap-1 px-1.5 sm:px-2.5 py-1 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-all min-w-0 lg:min-w-[125px] h-[24px] sm:h-[28px] select-none border font-bold ${
                isLight
                  ? "bg-white hover:bg-slate-100 border-slate-200 text-slate-800 shadow-sm"
                  : "bg-slate-950/60 hover:bg-white/5 border-white/5 text-slate-200"
              }`}
              title={language === "RU" ? "Рабочее пространство" : "Workspace Layout"}
            >
              <div className="flex items-center gap-1 leading-none">
                <div className="flex items-center justify-center w-4 h-3 text-blue-450 shrink-0">
                  {workspaceLayout === "1" ? (
                    <div className="w-3.5 h-2.5 border border-current rounded-[1px] opacity-80" />
                  ) : workspaceLayout === "2h" ? (
                    <div className="flex gap-0.5 items-center">
                      <div className="w-1.5 h-1.5 border border-current rounded-[1px] opacity-80" />
                      <div className="w-1.5 h-1.5 border border-current rounded-[1px] opacity-80" />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5 items-center justify-center">
                      <div className="w-3 h-1 border border-current rounded-[1px] opacity-80" />
                      <div className="w-3 h-1 border border-current rounded-[1px] opacity-80" />
                    </div>
                  )}
                </div>
                <span className={`font-sans text-[9px] sm:text-[10px] whitespace-nowrap hidden lg:inline`}>
                  {workspaceLayout === "1"
                    ? (language === "EN" ? "1 Chart" : "1 график")
                    : workspaceLayout === "2h"
                    ? (language === "EN" ? "2 Horiz" : "2 гориз.")
                    : (language === "EN" ? "2 Vert" : "2 верт.")}
                </span>
              </div>
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 shrink-0 ${
                isLight ? "text-slate-600" : "text-slate-400"
              } ${showWorkspaceMenu ? "rotate-180" : ""}`} />
            </button>

            {showWorkspaceMenu && (
              <div
                className={`absolute right-0 mt-1.5 w-44 max-w-[calc(100vw-16px)] rounded-xl p-1 sm:p-1.5 z-50 text-left select-none shadow-2xl border ${
                  isLight
                    ? "bg-white border-slate-300 text-slate-900 shadow-xl"
                    : "bg-[#090d16]/98 border border-white/10 text-slate-100"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  {WORKSPACE_LAYOUTS.map((item) => {
                    const label = item.id === "1"
                      ? (language === "EN" ? "1 Chart" : "1 график")
                      : item.id === "2h"
                      ? (language === "EN" ? "2 Horizontal" : "2 по горизонтали")
                      : (language === "EN" ? "2 Vertical" : "2 по вертикали");
                    const isSelected = workspaceLayout === item.id;
                    const isLocked = workspacesCount < 2 && item.id !== "1";
                    return (
                      <button
                        key={item.id}
                        disabled={isLocked}
                        onClick={() => {
                          if (isLocked) return;
                          onWorkspaceLayoutChange(item.id as any);
                          setShowWorkspaceMenu(false);
                        }}
                        className={`flex items-center justify-between px-2 py-1 sm:py-1.5 rounded-lg text-left transition-all w-full ${
                          isLocked
                            ? "opacity-50 cursor-not-allowed text-slate-500"
                            : isSelected
                            ? isLight
                              ? "bg-blue-50 text-blue-800 font-extrabold border border-blue-200 shadow-sm"
                              : "bg-blue-500/10 text-blue-400 font-extrabold border border-blue-500/25"
                            : isLight
                              ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                              : "text-slate-300 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-center gap-2 select-none text-left">
                          <div className="flex items-center justify-center w-5 h-4 text-blue-405 shrink-0">
                            {isLocked ? "🔒" : item.icon}
                          </div>
                          <span className="font-sans text-[10px] font-bold">
                            {label}
                          </span>
                        </div>
                        {isSelected && !isLocked && (
                          <Check className="w-3 tracking-tight ml-1 text-blue-500 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <button
          ref={settingsBtnRef}
          onClick={() => onToggleChartSettings(settingsBtnRef.current?.getBoundingClientRect())}
          className={`flex items-center justify-center px-1.5 sm:px-2 py-1 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-bold cursor-pointer transition-all duration-150 select-none border ${
            isLight
              ? "bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-600 hover:text-slate-900"
              : "bg-slate-950/60 hover:bg-white/5 border-white/5 text-slate-400 hover:text-yellow-450"
          } ${showChartSettings ? (isLight ? "bg-slate-200 text-slate-900" : "bg-white/10 text-yellow-450") : ""}`}
          title={language === "RU" ? "Настройки графика" : "Chart Settings"}
        >
          <Settings className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
        </button>

        <div className="relative group">
          <div className={`border px-2.5 py-1.5 rounded-xl text-[10px] font-mono font-bold flex items-center gap-1.5 hidden xl:flex shadow-inner transition-all duration-300 cursor-help ${
            isLight ? "bg-slate-100 border-slate-200/60 text-slate-600" : "bg-slate-950/60 border-white/5 text-slate-400"
          }`}>
            <Move className="w-3 h-3 text-slate-500 animate-pulse" /> Click & Drag to Pan (2D)
          </div>
          <div className={`absolute top-full mt-2 z-50 hidden group-hover:block right-0 w-56 p-3 rounded-xl shadow-2xl border backdrop-blur-md pointer-events-none ${
            isLight ? "bg-white border-slate-300" : "bg-[#090d16]/98 border-white/10"
          }`}>
            <div className={`text-[9px] font-mono font-bold tracking-widest uppercase mb-2 ${
              isLight ? "text-slate-400" : "text-slate-500"
            }`}>
              {language === "RU" ? "Управление масштабом" : language === "KZ" ? "Масштабты басқару" : "Zoom Controls"}
            </div>
            <div className="flex items-center gap-2 mb-1.5 whitespace-nowrap">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                isLight ? "bg-blue-100 text-blue-700" : "bg-blue-900/40 text-blue-400"
              }`}>SHIFT + SCROLL</span>
              <span className="text-[10px] font-mono opacity-80">
                {language === "RU" ? "зум по вертикали" : language === "KZ" ? "тік масштаб" : "vertical zoom"}
              </span>
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                isLight ? "bg-blue-100 text-blue-700" : "bg-blue-900/40 text-blue-400"
              }`}>CTRL + SCROLL</span>
              <span className="text-[10px] font-mono opacity-80">
                {language === "RU" ? "зум по горизонтали" : language === "KZ" ? "көлденең масштаб" : "horizontal zoom"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ChartToolsHeader = memo(ChartToolsHeaderImpl);
