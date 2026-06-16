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
    visibleStartIdx?: number,
    smoothing?: number
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

  calculateCVD: (candles: ClusterCandle[], period = "all", visibleStartIdx = 0, smoothing = 10) => {
    let runningSum = 0;
    const raw = candles.map((candle, idx) => {
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

      return {
        value: closeVal,
        timestamp: candle.timestamp,
        open: openVal,
        high: 0,
        low: 0,
        close: closeVal
      };
    });

    if (smoothing <= 1) return raw;

    const windowSize = Math.max(1, Math.floor(smoothing));
    const smoothed: typeof raw = [];
    let windowSum = 0;
    for (let i = 0; i < raw.length; i++) {
      const cur = raw[i]!;
      windowSum += cur.value;
      if (i >= windowSize) windowSum -= raw[i - windowSize]!.value;
      const count = Math.min(i + 1, windowSize);
      const avg = windowSum / count;
      const prevClose = smoothed.length > 0 ? smoothed[smoothed.length - 1]!.close : avg;
      const deltaAbs = Math.abs(avg - prevClose);
      smoothed.push({
        value: avg,
        timestamp: cur.timestamp,
        open: prevClose,
        high: Math.max(prevClose, avg) + deltaAbs * 0.15,
        low: Math.min(prevClose, avg) - deltaAbs * 0.15,
        close: avg
      });
    }
    return smoothed;
  }
};
