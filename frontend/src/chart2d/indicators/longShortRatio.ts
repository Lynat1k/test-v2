import type { IndicatorModule } from "./types";

export interface LongShortRatioSettings {
  longShortRatioLineColor?: string;
  longShortRatioDisplayMode?: "ratio" | "longPct";
}

/**
 * Long/Short Account Ratio — подвальный индикатор. Как Bid & Ask Ratio, данные НЕ
 * считаются из свечей, а тянутся с бэкенда (GET /api/v1/long-short-ratio). Только
 * futures. Здесь только метаданные и дефолтные настройки; фетч и отрисовка линии —
 * в ClusterChart.tsx.
 */
export const longShortRatioIndicator: IndicatorModule & {
  defaultSettings: LongShortRatioSettings;
} = {
  id: "longShortRatio",
  label: "(PROCLUSTER) Long/Short Ratio",
  category: "Все индикаторы",
  type: "Подвальный",
  description:
    "Глобальное соотношение числа аккаунтов в long к числу в short по всем биржевым счетам. Значение >1 — перевес лонгов, <1 — перевес шортов. Только futures.",
  details:
    "Источник — статистика Binance globalLongShortAccountRatio (период 5 мин). Режим «Ratio» показывает само соотношение (нейтраль = 1.0), режим «Long %» — долю лонг-аккаунтов = ratio/(ratio+1)·100 (нейтраль = 50%). Данные берутся из истории на бэкенде.",
  defaultSettings: {
    longShortRatioLineColor: "#a855f7",
    longShortRatioDisplayMode: "ratio",
  },
  isActiveDefault: false,
};
