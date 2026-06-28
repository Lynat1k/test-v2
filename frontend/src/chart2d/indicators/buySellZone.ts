import type { IndicatorModule } from "./types";

export interface BuySellZoneSettings {
  // Component weights (renormalised over available components per candle).
  bsZoneWLS?: number;
  bsZoneWRSI?: number;
  bsZoneWMACD?: number;
  bsZoneWBAR?: number;
  // Which bid/ask depth band feeds the bar component (r1/r3/r5).
  bsZoneBand?: "1" | "3" | "5";
  // Lookbacks: RSI period, MACD-hist z-score window, long/short z-score window.
  bsZoneRsiLen?: number;
  bsZoneMacdZlen?: number;
  bsZoneLsZlen?: number;
  // Balance corridor + overheat thresholds (0..100).
  bsZoneBalUp?: number;
  bsZoneBalDown?: number;
  bsZoneOverUp?: number;
  bsZoneOverDown?: number;
  // Colours.
  bsZoneLineColor?: string;
  bsZoneBalColor?: string;
  bsZoneBalOpacity?: number;
  bsZoneOverUpColor?: string;
  bsZoneOverDownColor?: string;
  // Overheat fill brightness (0..100) — shared by both zones.
  bsZoneOverOpacity?: number;
  // Show LONG/SHORT badges at each zone-entry extremum.
  bsZoneShowBadges?: boolean;
}

/**
 * Buy/Sell Zone — подвальный композитный осциллятор 0..100. Порт TradingView
 * «PROCLUSTER BUY SELL zone» (без Bybit). Композит из 4 компонентов: инверсия
 * long/short, RSI, z-score гистограммы MACD и bid/ask ratio. Каждый компонент
 * нормируется в 0..100 и усредняется по доступным с весами. Только futures.
 *
 * Источники: RSI/MACD — из свечей; long/short и bid/ask — с бэкенда (как у
 * Long/Short Ratio и Bid & Ask Ratio). Здесь только метаданные и дефолты —
 * расчёт композита и отрисовка живут в ClusterChart.tsx.
 */
export const buySellZoneIndicator: IndicatorModule & {
  defaultSettings: BuySellZoneSettings;
} = {
  id: "buySellZone",
  label: "(PROCLUSTER) Buy/Sell Zone",
  category: "Все индикаторы",
  type: "Подвальный",
  description:
    "Композитный осциллятор 0..100, объединяющий long/short ratio (инверсия), RSI, импульс MACD и баланс стакана bid/ask в единый индекс перевеса покупателей/продавцов. Только futures.",
  details:
    "Каждый компонент нормируется в 0..100 и усредняется по доступным с весами (по умолчанию LS 0.35, RSI 0.25, MACD 0.20, Bar 0.20). Значения внутри коридора 35–65 — баланс; выше 80 — перегрев покупателей (красная заливка), ниже 20 — перегрев продавцов (зелёная). Если у свечи нет данных стакана/соотношения или мало истории для z-score, компонент исключается, а вес перераспределяется на оставшиеся.",
  defaultSettings: {
    bsZoneWLS: 0.35,
    bsZoneWRSI: 0.25,
    bsZoneWMACD: 0.2,
    bsZoneWBAR: 0.2,
    bsZoneBand: "5",
    bsZoneRsiLen: 14,
    bsZoneMacdZlen: 50,
    bsZoneLsZlen: 150,
    bsZoneBalUp: 65,
    bsZoneBalDown: 35,
    bsZoneOverUp: 80,
    bsZoneOverDown: 20,
    bsZoneLineColor: "#22d3ee",
    bsZoneBalColor: "#64748b",
    bsZoneBalOpacity: 10,
    bsZoneOverUpColor: "#ef4444",
    bsZoneOverDownColor: "#10b981",
    bsZoneOverOpacity: 30,
    bsZoneShowBadges: true,
  },
  isActiveDefault: false,
};
