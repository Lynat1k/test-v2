import type { IndicatorModule } from "./types";
import { volumeOnChartIndicator } from "./volumeOnChart";
import { deltaIndicator } from "./delta";
import { cvdIndicator } from "./cvd";
import { clusterSearchIndicator } from "./clusterSearch";
import { stackedImbalanceIndicator } from "./stackedImbalance";
import { depthOfMarketIndicator } from "./depthOfMarket";

export * from "./types";
export * from "./volumeOnChart";
export * from "./delta";
export * from "./cvd";
export * from "./clusterSearch";
export * from "./stackedImbalance";
export * from "./depthOfMarket";

export const MODULAR_INDICATORS: IndicatorModule[] = [
  volumeOnChartIndicator,
  deltaIndicator,
  cvdIndicator,
  clusterSearchIndicator,
  stackedImbalanceIndicator,
  depthOfMarketIndicator
];
