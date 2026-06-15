import type { IndicatorModule } from "./types";

export interface DeltaSettings {
  showLabels: boolean;
  sensitivity: number;
  deltaPlotType?: "candles" | "bars";
}

export const deltaIndicator: IndicatorModule & {
  defaultSettings: DeltaSettings;
  getDeltaStyle: (
    delta: number,
    isLight: boolean
  ) => {
    fillStyle: string;
    textStyle: string;
  };
} = {
  id: "delta",
  label: "(PROCLUSTER) Delta",
  category: "Все индикаторы",
  type: "Подвальный",
  description: "Рыночная дельту — чистая разница между агрессивными рыночными покупками (Market Buys) и продажами (Market Sells) по каждой свече.",
  details: "Отвечает на вопрос, кто прямо сейчас доминирует на рынке — быки или медведи. Положительная (зеленая) дельта означает перевес рыночных покупок, отрицательная (красная) — преобладание рыночных продаж.",
  defaultSettings: {
    showLabels: true,
    sensitivity: 5,
    deltaPlotType: "candles"
  },
  isActiveDefault: true,

  getDeltaStyle: (delta, isLight) => {
    if (delta >= 0) {
      return {
        fillStyle: "rgba(16, 185, 129, 0.3)",
        textStyle: isLight ? "#047857" : "#10b981"
      };
    } else {
      return {
        fillStyle: "rgba(244, 63, 94, 0.3)",
        textStyle: isLight ? "#be123c" : "#f43f5e"
      };
    }
  }
};
