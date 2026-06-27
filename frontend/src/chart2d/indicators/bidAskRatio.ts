import type { IndicatorModule } from "./types";

export interface BidAskRatioSettings {
  bidAskRatioBand?: "1" | "3" | "5";
  bidAskRatioBullColor?: string;
  bidAskRatioBearColor?: string;
  bidAskRatioOpacity?: number;
}

/**
 * Bid & Ask Ratio — подвальный индикатор. В ОТЛИЧИЕ от CVD/Delta данные НЕ
 * считаются из свечей на фронте, а тянутся с бэкенда
 * (GET /api/v1/bookdepth-ratio). Только futures. Здесь только метаданные и
 * дефолтные настройки; фетч и отрисовка — в ClusterChart.tsx.
 */
export const bidAskRatioIndicator: IndicatorModule & {
  defaultSettings: BidAskRatioSettings;
} = {
  id: "bidAskRatio",
  label: "(PROCLUSTER) Bid & Ask Ratio",
  category: "Все индикаторы",
  type: "Подвальный",
  description:
    "Соотношение глубины стакана bid/ask в диапазоне ±N% от цены. Зелёный — перевес лимитных бидов, красный — перевес асков. Только futures.",
  details:
    "Значение = (bid − ask) / (bid + ask) по суммарному лимитному объёму в полосе ±1/3/5%. Диапазон −1..+1: ближе к +1 — плотная поддержка снизу, ближе к −1 — давление сверху. Данные берутся из истории снапшотов стакана на бэкенде.",
  defaultSettings: {
    bidAskRatioBand: "5",
    bidAskRatioBullColor: "#10b981",
    bidAskRatioBearColor: "#ef4444",
    bidAskRatioOpacity: 100,
  },
  isActiveDefault: false,
};
