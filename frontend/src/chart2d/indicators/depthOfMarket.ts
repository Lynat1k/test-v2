import type { IndicatorModule } from "./types";

export interface DepthOfMarketSettings {
  domWidthMode: "auto" | "manual";
  domMaxWidth: number;
  domColorBid: string;
  domColorAsk: string;
  domOpacity: number;
}

export const depthOfMarketIndicator: IndicatorModule & {
  defaultSettings: DepthOfMarketSettings;
} = {
  id: "depthOfMarket",
  label: "(PROCLUSTER) Depth of Market (DOM)",
  category: "Все индикаторы",
  type: "Оверлей",
  description: "Отображает горизонтальную гистограмму лимитных заявок (биржевой стакан) непосредственно на графике у ценовой шкалы.",
  details: "Показывает распределение крупных лимитных заявок на покупку (Bids) и продажу (Asks). Помогает моментально идентифицировать сильные стены сопротивлений и поддержек, приближение к которым может вызвать отскок или ускорение пробоя.",
  defaultSettings: {
    domWidthMode: "auto",
    domMaxWidth: 100,
    domColorBid: "#FF228B22",
    domColorAsk: "#FFC80000",
    domOpacity: 40
  },
  isActiveDefault: false
};
