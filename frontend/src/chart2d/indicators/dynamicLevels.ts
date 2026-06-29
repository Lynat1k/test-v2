import type { IndicatorModule } from "./types";
import type { ClusterCandle } from "../types";

export interface DynamicLevelsSettings {
  dlPeriod: "hour" | "day" | "week" | "month" | "all";
  dlPocColor: string;
  dlPocWidth: number;
  dlVaFillColor: string;
  dlVaBorderColor: string;
  dlShowValueArea: boolean;
  dlVaFillOpacity: number;
  dlVaBorderOpacity: number;
  dlPocOpacity: number;
  dlVaBorderStyle: "solid" | "dashed" | "dotted";
}

// One developing level sample, computed from the volume accumulated from the
// start of the current period up to (and including) the candle at this index.
export interface DynamicLevel {
  poc: number;
  vah: number;
  val: number;
  periodStart: boolean; // true on the first candle of a new period (reset point)
}

// Bucket key for a UTC timestamp under the chosen period. Candles sharing a key
// belong to the same period. Mirrors the reset boundaries used in cvd.ts
// (day/week/month) and adds hour. "all" collapses everything into one bucket.
function bucketKey(t: number, period: DynamicLevelsSettings["dlPeriod"]): number {
  switch (period) {
    case "hour":
      return Math.floor(t / 3600000);
    case "day":
      return Math.floor(t / 86400000);
    case "week": {
      // Thursday-anchored UTC week, identical to cvd.ts getUTCWeek.
      const dayOffset = 4;
      const msInDay = 86400000;
      return Math.floor((t + dayOffset * msInDay) / (7 * msInDay));
    }
    case "month": {
      const d = new Date(t);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    }
    case "all":
    default:
      return 0;
  }
}

// Find POC (price with max volume) for a price->volume profile, then expand a
// 70% Value Area outward from POC. The expansion loop is taken one-to-one from
// design-src drawingRenderer.ts ("Calculate 70% Value Area" block). Prices are
// sorted DESCENDING (index 0 = highest price), so VAH = top, VAL = bottom.
export function computePocVa(
  volByPrice: Map<number, number>
): { poc: number; vah: number; val: number } | null {
  if (volByPrice.size === 0) return null;

  const prices = Array.from(volByPrice.keys()).sort((a, b) => b - a);
  const vols = prices.map((p) => Math.abs(volByPrice.get(p) || 0));
  const n = prices.length;

  let totalVolume = 0;
  let maxBinVal = 0;
  let pocIdx = 0;
  for (let b = 0; b < n; b++) {
    totalVolume += vols[b]!;
    if (vols[b]! > maxBinVal) {
      maxBinVal = vols[b]!;
      pocIdx = b;
    }
  }

  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  let vaVolume = vols[pocIdx]!;
  const targetVolume = totalVolume * 0.7;

  if (totalVolume > 0 && maxBinVal > 0) {
    while (vaVolume < targetVolume && (lowIdx > 0 || highIdx < n - 1)) {
      let addLowVol = 0;
      let addHighVol = 0;
      if (lowIdx > 0) addLowVol = vols[lowIdx - 1]!;
      if (highIdx < n - 1) addHighVol = vols[highIdx + 1]!;

      if (addLowVol >= addHighVol && lowIdx > 0) {
        vaVolume += addLowVol;
        lowIdx--;
      } else if (highIdx < n - 1) {
        vaVolume += addHighVol;
        highIdx++;
      } else if (lowIdx > 0) {
        vaVolume += addLowVol;
        lowIdx--;
      } else {
        break;
      }
    }
  }

  return {
    poc: prices[pocIdx]!,
    vah: prices[lowIdx]!,  // smallest index reached = highest price = VAH
    val: prices[highIdx]!, // largest index reached = lowest price = VAL
  };
}

// Developing levels (ATAS/Tiger "Dynamic Levels"): walk candles left to right
// keeping a running price->volume profile that resets on every period boundary.
// Each candle yields the POC/VA computed from everything accumulated since the
// start of its period — so the levels evolve bar by bar and snap back at resets.
// Returns one entry per candle (null until the period has any volume).
export function computeDynamicLevels(
  candles: ClusterCandle[],
  period: DynamicLevelsSettings["dlPeriod"]
): (DynamicLevel | null)[] {
  const out: (DynamicLevel | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;

  const acc = new Map<number, number>();
  let prevKey = bucketKey(candles[0]!.timestamp, period);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const key = bucketKey(c.timestamp, period);
    const periodStart = i === 0 || key !== prevKey;
    if (periodStart && i !== 0) acc.clear();
    prevKey = key;

    const cells = c.cells;
    if (cells) {
      for (let j = 0; j < cells.length; j++) {
        const cell = cells[j]!;
        acc.set(cell.price, (acc.get(cell.price) || 0) + cell.volume);
      }
    }

    const pv = computePocVa(acc);
    out[i] = pv ? { ...pv, periodStart } : null;
  }

  return out;
}

export const dynamicLevelsIndicator: IndicatorModule & {
  defaultSettings: DynamicLevelsSettings;
} = {
  id: "dynamicLevels",
  label: "(PROCLUSTER) Dynamic Levels",
  category: "Все индикаторы",
  type: "Оверлей",
  description:
    "Развивающиеся уровни POC и зона Value Area (70%) объёмного профиля: пересчитываются накопительно бар за баром от начала периода (час/день/неделя/месяц/все бары).",
  details:
    "Профиль объёма накапливается от начала текущего периода: на каждой свече заново находятся POC (цена с максимальным объёмом) и Value Area — диапазон вокруг POC, вмещающий 70% объёма (VAH сверху, VAL снизу). Уровни образуют ступенчатую развивающуюся линию, липнущую к цене; на границе периода расчёт сбрасывается.",
  defaultSettings: {
    dlPeriod: "day",
    dlPocColor: "#f59e0b",
    dlPocWidth: 2,
    dlVaFillColor: "#3b82f6",
    dlVaBorderColor: "#3b82f6",
    dlShowValueArea: true,
    dlVaFillOpacity: 0.12,
    dlVaBorderOpacity: 0.7,
    dlPocOpacity: 1,
    dlVaBorderStyle: "dashed",
  },
  isActiveDefault: false,
};
