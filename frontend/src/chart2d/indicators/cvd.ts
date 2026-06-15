import type { IndicatorModule } from "./types";
import type { ClusterCandle } from "../types";

export interface CvdSettings {
  smoothing: number;
  cvdLineColor?: string;
  cvdPeriod?: "all" | "day" | "week" | "month" | "visible";
  cvdPlotType?: "line" | "candles";
}

export const cvdIndicator: IndicatorModule & {
  defaultSettings: CvdSettings;
  calculateCVD: (
    candles: ClusterCandle[],
    period?: "all" | "day" | "week" | "month" | "visible",
    visibleStartIdx?: number
  ) => {
    value: number;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
} = {
  id: "cvd",
  label: "(PROCLUSTER) CVD",
  category: "Все индикаторы",
  type: "Подвальный",
  description: "Кумулятивная дельта объема (Cumulative Volume Delta), суммирующая значения дельты нарастающим итогом на протяжении всего графика.",
  details: "Используется для поиска рыночных скрытых дивергенций: например, если цена движется вверх к новым вершинам, а линия CVD падает, это признак сильного лимитного давления продавцов и скорого разворота цены вниз.",
  defaultSettings: {
    smoothing: 10,
    cvdLineColor: "#a855f7",
    cvdPeriod: "all",
    cvdPlotType: "line"
  },
  isActiveDefault: true,

  calculateCVD: (candles: ClusterCandle[], period = "all", visibleStartIdx = 0) => {
    let runningSum = 0;
    return candles.map((candle, idx) => {
      const priorCandle = idx > 0 ? candles[idx - 1]! : null;
      let shouldReset = false;

      if (priorCandle) {
        if (period === "day") {
          const d1 = new Date(candle.timestamp);
          const d2 = new Date(priorCandle.timestamp);
          shouldReset = d1.getUTCDate() !== d2.getUTCDate() ||
                        d1.getUTCMonth() !== d2.getUTCMonth() ||
                        d1.getUTCFullYear() !== d2.getUTCFullYear();
        } else if (period === "week") {
          const getUTCWeek = (t: number) => {
            const dayOffset = 4;
            const msInDay = 86400000;
            return Math.floor((t + dayOffset * msInDay) / (7 * msInDay));
          };
          shouldReset = getUTCWeek(candle.timestamp) !== getUTCWeek(priorCandle.timestamp);
        } else if (period === "month") {
          const d1 = new Date(candle.timestamp);
          const d2 = new Date(priorCandle.timestamp);
          shouldReset = d1.getUTCMonth() !== d2.getUTCMonth() ||
                        d1.getUTCFullYear() !== d2.getUTCFullYear();
        }
      }

      if (period === "visible" && idx === visibleStartIdx) {
        shouldReset = true;
      }

      if (shouldReset) {
        runningSum = 0;
      }

      const openVal = runningSum;
      runningSum += candle.delta;
      const closeVal = runningSum;

      const deltaAbs = Math.abs(candle.delta);
      const highVal = Math.max(openVal, closeVal) + deltaAbs * 0.15;
      const lowVal = Math.min(openVal, closeVal) - deltaAbs * 0.15;

      return {
        value: closeVal,
        timestamp: candle.timestamp,
        open: openVal,
        high: highVal,
        low: lowVal,
        close: closeVal
      };
    });
  }
};
