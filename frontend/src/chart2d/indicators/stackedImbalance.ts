import type { IndicatorModule } from "./types";

export interface StackedImbalanceSettings {
  siRatio: number;
  siRange: number;
  siVolume: number;
  siColorNeg: string;
  siColorPos: string;
  siLineWidth: number;
}

export const stackedImbalanceIndicator: IndicatorModule & {
  defaultSettings: StackedImbalanceSettings;
} = {
  id: "stackedImbalance",
  label: "(PROCLUSTER) Stacked Imbalance",
  category: "Все индикаторы",
  type: "Оверлей",
  description: "Строит зоны последовательных рыночных дисбалансов (Stacked Imbalances) покупателей и продавцов на нескольких уровнях цены подряд.",
  details: "Показывает агрессивную рыночную однонаправленную инициативу. Складывание дисбалансов (например, когда рыночный спрос многократно превышает лимитное предложение 3 уровня подряд) образует сильнейшие зоны поддержки или сопротивления на будущее.",
  defaultSettings: {
    siRatio: 300,
    siRange: 3,
    siVolume: 10,
    siColorNeg: "#FFC80000",
    siColorPos: "#FF228B22",
    siLineWidth: 2
  },
  isActiveDefault: false
};
