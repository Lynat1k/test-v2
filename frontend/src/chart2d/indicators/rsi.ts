import type { IndicatorModule } from "./types";

export interface RsiSettings {
  rsiPeriod: number;
  rsiLineColor: string;
  rsiZoneColor: string;
  rsiZoneOpacity: number;
}

/**
 * Classic Wilder's RSI.
 * - first `period` price changes -> simple average gain/loss (SMA seed)
 * - subsequent values -> Wilder smoothing: avg = (prevAvg*(period-1) + cur) / period
 * - RSI = 100 - 100/(1 + avgGain/avgLoss); if avgLoss == 0 -> RSI = 100
 * Returns null for indices where there is not enough data (< period + 1 closes).
 */
export function calculateRSI(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const p = Math.max(2, Math.floor(period));
  if (n < p + 1) return result;

  const computeRsi = (avgGain: number, avgLoss: number): number => {
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };

  // SMA seed over the first `p` changes (indices 1..p)
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= p; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / p;
  let avgLoss = lossSum / p;
  result[p] = computeRsi(avgGain, avgLoss);

  // Wilder smoothing for the rest
  for (let i = p + 1; i < n; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (p - 1) + gain) / p;
    avgLoss = (avgLoss * (p - 1) + loss) / p;
    result[i] = computeRsi(avgGain, avgLoss);
  }

  return result;
}

export const rsiIndicator: IndicatorModule & {
  defaultSettings: RsiSettings;
  calculateRSI: typeof calculateRSI;
} = {
  id: "rsi",
  label: "(PROCLUSTER) RSI",
  category: "Все индикаторы",
  type: "Подвальный",
  description:
    "Индекс относительной силы (RSI) — осциллятор со шкалой 0–100, измеряющий скорость и величину ценовых движений по close-ценам свечей.",
  details:
    "Значения выше 70 указывают на перекупленность (вероятен откат вниз), ниже 30 — на перепроданность (вероятен отскок вверх). Расхождения линии RSI с ценой используются для поиска разворотов. Период по умолчанию 14 (формула Уайлдера).",
  defaultSettings: {
    rsiPeriod: 14,
    rsiLineColor: "#a855f7",
    rsiZoneColor: "#64748b",
    rsiZoneOpacity: 12
  },
  isActiveDefault: false,

  calculateRSI
};
