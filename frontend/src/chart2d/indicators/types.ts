import type { IndicatorSettings } from "../types";

export interface IndicatorModule {
  id: string;
  label: string;
  category: "Все индикаторы" | "Избранные" | "Сообщество";
  type: "Оверлей" | "Подвальный" | "Глобальный";
  description: string;
  details: string;
  defaultSettings: IndicatorSettings;
  isActiveDefault?: boolean;
}
