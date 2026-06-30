/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// @ts-nocheck — matches ClusterChart.tsx strictness style; props use loose typing on purpose.

// Branch A, step 1: the drawing-tool sidebar was inline in ClusterChart and walked
// by React on every commit (WS tick ~2/s × ~160 ms each, scroll-state push). Its
// props don't depend on candles / WS / scroll / cursor, so wrapped in React.memo
// it is skipped entirely on those commits. See plan-chart2d-piped-hare.md.

import React, { memo } from "react";
import {
  Slash,
  ArrowUpRight,
  Equal,
  Minus,
  Square,
  Grid3X3,
  Ruler,
  Type,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Trash2,
} from "lucide-react";

// Module-level literal — allocated once, not on every render of the toolbar.
const DRAWING_TOOLS = [
  { id: "trend", icon: Slash, titleRU: "Трендовая линия", titleEN: "Trend Line" },
  { id: "arrow", icon: ArrowUpRight, titleRU: "Стрелка направления", titleEN: "Direction Arrow" },
  { id: "channel", icon: Equal, titleRU: "Параллельный канал", titleEN: "Parallel Channel" },
  { id: "horizontal", icon: Minus, titleRU: "Горизонтальный уровень", titleEN: "Horizontal Level" },
  { id: "rect", icon: Square, titleRU: "Прямоугольник", titleEN: "Rectangle" },
  { id: "fibonacci", icon: Grid3X3, titleRU: "Уровни Фибоначчи", titleEN: "Fibonacci Retracement" },
  { id: "ruler", icon: Ruler, titleRU: "Линейка диапазона", titleEN: "Range Ruler" },
  { id: "text", icon: Type, titleRU: "Текстовая заметка", titleEN: "Text Annotation" },
  { id: "volume", icon: BarChart3, titleRU: "Профиль объема диапазона", titleEN: "Range Volume Profile" },
  { id: "long", icon: TrendingUp, titleRU: "Длинная позиция (Long)", titleEN: "Long Position" },
  { id: "short", icon: TrendingDown, titleRU: "Короткая позиция (Short)", titleEN: "Short Position" },
] as const;

interface DrawingToolbarProps {
  activeDrawingTool: string | null;
  setActiveDrawingTool: (id: string | null) => void;
  areDrawingsVisible: boolean;
  onToggleDrawingsVisibility: () => void;
  onClearAllDrawings: () => void;
  drawingsLocked: boolean;
  onToggleLock: () => void;
  // Pass a boolean instead of the drawings array — otherwise every setDrawings
  // would change the reference and defeat React.memo.
  hasDrawings: boolean;
  isLight: boolean;
  language: "RU" | "EN" | "KZ";
}

function DrawingToolbarImpl({
  activeDrawingTool,
  setActiveDrawingTool,
  areDrawingsVisible,
  onToggleDrawingsVisibility,
  onClearAllDrawings,
  drawingsLocked,
  onToggleLock,
  hasDrawings,
  isLight,
  language,
}: DrawingToolbarProps) {
  return (
    <div className={`w-11 flex-none flex flex-col items-center py-3 border-r select-none transition-all duration-300 relative z-30 ${
      isLight
        ? "bg-white border-slate-200/80 text-slate-600 shadow-sm"
        : "bg-[#06080f]/90 border-white/5 text-slate-300 backdrop-blur-md"
    }`}>
      <div className="flex flex-col gap-1.5 items-center w-full grow">
        {DRAWING_TOOLS.map((tool) => {
          const IconComp = tool.icon;
          const isActive = activeDrawingTool === tool.id;
          const title = language === "RU" ? tool.titleRU : tool.titleEN;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveDrawingTool(isActive ? null : tool.id)}
              className={`p-2 rounded-lg transition-all duration-150 relative group cursor-pointer ${
                isActive
                  ? "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                  : isLight
                    ? "hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-transparent"
                    : "hover:bg-white/5 text-slate-400 hover:text-white border border-transparent"
              }`}
              title={title}
            >
              {tool.id === "long" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <circle cx="4" cy="5" r="1.5" />
                  <line x1="6" y1="5" x2="20" y2="5" />
                  <text x="12" y="12" fontFamily="sans-serif" fontSize="7.5" fontWeight="bold" textAnchor="middle" fill="currentColor" stroke="none">L</text>
                  <line x1="4" y1="17" x2="20" y2="17" />
                  <circle cx="4" cy="21" r="1.5" />
                  <line x1="6" y1="21" x2="20" y2="21" />
                </svg>
              ) : tool.id === "short" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <circle cx="4" cy="5" r="1.5" />
                  <line x1="6" y1="5" x2="20" y2="5" />
                  <line x1="4" y1="10" x2="20" y2="10" />
                  <text x="12" y="18" fontFamily="sans-serif" fontSize="7.5" fontWeight="bold" textAnchor="middle" fill="currentColor" stroke="none">S</text>
                  <circle cx="4" cy="21" r="1.5" />
                  <line x1="6" y1="21" x2="20" y2="21" />
                </svg>
              ) : tool.id === "volume" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <line x1="4" y1="4" x2="4" y2="20" strokeWidth="1.5" opacity="0.6" />
                  <line x1="4" y1="6" x2="10" y2="6" strokeWidth="1.8" />
                  <line x1="4" y1="9" x2="16" y2="9" strokeWidth="1.8" />
                  <line x1="4" y1="12" x2="21" y2="12" strokeWidth="2.2" />
                  <line x1="4" y1="15" x2="16" y2="15" strokeWidth="1.8" />
                  <line x1="4" y1="18" x2="10" y2="18" strokeWidth="1.8" />
                </svg>
              ) : tool.id === "fibonacci" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <line x1="3" y1="4" x2="21" y2="4" strokeWidth="1.5" opacity="0.9" />
                  <line x1="3" y1="7.5" x2="21" y2="7.5" strokeWidth="1" opacity="0.4" />
                  <line x1="3" y1="11" x2="21" y2="11" strokeWidth="1" opacity="0.65" />
                  <line x1="3" y1="14.5" x2="21" y2="14.5" strokeWidth="1" opacity="0.4" />
                  <line x1="3" y1="17.5" x2="21" y2="17.5" strokeWidth="1" opacity="0.4" />
                  <line x1="3" y1="21" x2="21" y2="21" strokeWidth="1.5" opacity="0.9" />
                  <line x1="5" y1="21" x2="19" y2="4" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
                  <circle cx="5" cy="21" r="1.5" fill="currentColor" />
                  <circle cx="19" cy="4" r="1.5" fill="currentColor" stroke="none" />
                </svg>
              ) : (
                <IconComp className="w-4 h-4" />
              )}

              {/* Tooltip on Hover to the right */}
              <div className={`absolute left-full ml-2 top-1.2 font-sans font-semibold text-[10px] px-2 py-1 rounded bg-slate-950 text-slate-100 border border-white/10 hidden group-hover:block whitespace-nowrap z-50 pointer-events-none shadow-xl`}>
                {title}
              </div>
            </button>
          );
        })}
      </div>

      {/* Separator */}
      <div className={`w-6 h-px my-1 ${isLight ? "bg-slate-200" : "bg-white/10"}`} />

      {/* Show/Hide drawings */}
      <button
        onClick={onToggleDrawingsVisibility}
        className={`p-2 rounded-lg transition-all duration-150 relative group cursor-pointer ${
          !areDrawingsVisible
            ? "bg-amber-500/10 text-amber-500 border border-amber-500/25"
            : isLight
              ? "hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-transparent"
              : "hover:bg-white/5 text-slate-400 hover:text-white border border-transparent"
        }`}
        title={language === "RU" ? (areDrawingsVisible ? "Скрыть все рисунки" : "Показать все рисунки") : (areDrawingsVisible ? "Hide All Drawings" : "Show All Drawings")}
      >
        {areDrawingsVisible ? (
          <Eye className="w-4 h-4" />
        ) : (
          <EyeOff className="w-4 h-4 text-rose-500" />
        )}
        <div className={`absolute left-full ml-2 top-1.2 font-sans font-semibold text-[10px] px-2 py-1 rounded bg-slate-950 text-slate-100 border border-white/10 hidden group-hover:block whitespace-nowrap z-50 pointer-events-none shadow-xl`}>
          {language === "RU" ? (areDrawingsVisible ? "Скрыть все объекты" : "Показать все объекты") : (areDrawingsVisible ? "Hide All Objects" : "Show All Objects")}
        </div>
      </button>

      {/* Lock / unlock object editing — mirrors the visibility toggle: amber when
          active (locked). Blocks move/resize/delete; drawing new objects stays on. */}
      <button
        onClick={onToggleLock}
        className={`p-2 rounded-lg transition-all duration-150 relative group cursor-pointer ${
          drawingsLocked
            ? "bg-amber-500/10 text-amber-500 border border-amber-500/25"
            : isLight
              ? "hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-transparent"
              : "hover:bg-white/5 text-slate-400 hover:text-white border border-transparent"
        }`}
        title={language === "RU" ? "Заблокировать объекты" : "Lock drawings"}
      >
        {drawingsLocked ? (
          <Lock className="w-4 h-4" />
        ) : (
          <LockOpen className="w-4 h-4" />
        )}
        <div className={`absolute left-full ml-2 top-1.2 font-sans font-semibold text-[10px] px-2 py-1 rounded bg-slate-950 text-slate-100 border border-white/10 hidden group-hover:block whitespace-nowrap z-50 pointer-events-none shadow-xl`}>
          {language === "RU" ? "Заблокировать объекты" : "Lock drawings"}
        </div>
      </button>

      {/* Delete drawings option at the bottom — hidden while locked so clear-all
          can't bypass the lock. */}
      {hasDrawings && !drawingsLocked && (
        <button
          onClick={onClearAllDrawings}
          className={`p-2 rounded-lg transition-all duration-150 relative group cursor-pointer ${
            isLight
              ? "hover:bg-rose-50 text-rose-600 hover:text-rose-700 hover:border-rose-100"
              : "hover:bg-rose-950/20 text-rose-505 hover:text-rose-455 hover:border-rose-955/35"
          } border border-transparent`}
          title={language === "RU" ? "Удалить все рисунки" : "Clear Drawings"}
        >
          <Trash2 className="w-4 h-4" />

          <div className={`absolute left-full ml-2 top-1.2 font-sans font-extrabold text-[10px] px-2 py-1 rounded bg-rose-950 text-rose-300 border border-rose-900/30 hidden group-hover:block whitespace-nowrap z-50 pointer-events-none shadow-xl`}>
            {language === "RU" ? "Удалить все рисунки" : "Clear All Drawings"}
          </div>
        </button>
      )}
    </div>
  );
}

export const DrawingToolbar = memo(DrawingToolbarImpl);
