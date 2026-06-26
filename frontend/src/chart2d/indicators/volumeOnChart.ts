import type { IndicatorModule } from "./types";

export interface VolumeOnChartSettings {
  opacity: number;
  volumeOnChartDeltaThreshold: number;
  volumeOnChartMaxHeightPercent: number;
}

export const volumeOnChartIndicator: IndicatorModule & {
  defaultSettings: VolumeOnChartSettings;
  calculateBarHeight: (
    candleVolume: number,
    maxVisibleVolume: number,
    chartHeight: number,
    maxHeightPercent: number
  ) => number;
  getStyles: (
    candleDelta: number,
    deltaThreshold: number,
    isLight: boolean
  ) => { fillStyle: string; strokeStyle: string };
} = {
  id: "volumeOnChart",
  label: "(PROCLUSTER) Volume on Chart",
  category: "Все индикаторы",
  type: "Оверлей",
  description: "Накладывает вертикальную гистограмму проторгованного объема прямо поверх тела и теней свечей на график.",
  details: "Помогает сопоставлять ценовые уровни и проторгованную активность внутри каждой свечи, не переводя взгляд на отдельные подвальные индикаторы. Наглядно очерчивает ценовые зоны, вызвавшие наибольший интерес трейдеров.",
  defaultSettings: {
    opacity: 0.9,
    volumeOnChartDeltaThreshold: 500,
    volumeOnChartMaxHeightPercent: 15,
  },
  isActiveDefault: true,

  calculateBarHeight: (candleVolume, maxVisibleVolume, chartHeight, maxHeightPercent) => {
    const maxBarHeight = chartHeight * (maxHeightPercent / 100);
    return maxVisibleVolume > 0 ? (candleVolume / maxVisibleVolume) * maxBarHeight : 0;
  },

  getStyles: (candleDelta, deltaThreshold, isLight) => {
    if (candleDelta > deltaThreshold) {
      return {
        fillStyle: isLight ? "rgba(16, 185, 129, 0.28)" : "rgba(16, 185, 129, 0.35)",
        strokeStyle: isLight ? "rgba(5, 150, 105, 0.55)" : "rgba(16, 185, 129, 0.65)"
      };
    } else if (candleDelta < -deltaThreshold) {
      return {
        fillStyle: isLight ? "rgba(244, 63, 94, 0.28)" : "rgba(244, 63, 94, 0.35)",
        strokeStyle: isLight ? "rgba(220, 38, 38, 0.55)" : "rgba(244, 63, 94, 0.65)"
      };
    } else {
      return {
        fillStyle: isLight ? "rgba(100, 116, 139, 0.18)" : "rgba(148, 163, 184, 0.22)",
        strokeStyle: isLight ? "rgba(71, 85, 105, 0.38)" : "rgba(148, 163, 184, 0.48)"
      };
    }
  }
};
