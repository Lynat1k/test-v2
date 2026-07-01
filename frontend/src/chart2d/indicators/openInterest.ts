import type { IndicatorModule } from "./types";

export interface OpenInterestSettings {
  openInterestDisplayMode?: "line" | "candles";
  openInterestLineColor?: string;
}

/**
 * Open Interest — подвальный индикатор. Как Long/Short Ratio, данные НЕ считаются
 * из свечей, а тянутся с бэкенда (GET /api/v1/open-interest) в виде OHLC значений
 * открытого интереса (контракты) на бакет ТФ. Только futures. Здесь только
 * метаданные и дефолтные настройки; фетч и отрисовка (линия/свечи) — в
 * ClusterChart.tsx.
 */
export const openInterestIndicator: IndicatorModule & {
  defaultSettings: OpenInterestSettings;
} = {
  id: "openInterest",
  label: "(PROCLUSTER) Open Interest",
  category: "Все индикаторы",
  type: "Подвальный",
  description:
    "Открытый интерес фьючерсов — суммарное число открытых контрактов по всем незакрытым позициям. Рост OI подтверждает силу тренда, падение — закрытие позиций. Только futures.",
  details:
    "Источник — статистика Binance openInterestHist (период 5 мин), значение в контрактах. Режим «Линия» рисует сплошную линию по закрытию бакета, режим «Свечи» — OHLC-свечи (зелёная при close≥open, красная при close<open). Данные берутся из истории на бэкенде.",
  defaultSettings: {
    openInterestDisplayMode: "line",
    openInterestLineColor: "#f59e0b",
  },
  isActiveDefault: false,
};
