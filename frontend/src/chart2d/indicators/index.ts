import type { IndicatorModule } from "./types";
import { volumeOnChartIndicator } from "./volumeOnChart";
import { deltaIndicator } from "./delta";
import { cvdIndicator } from "./cvd";
import { clusterSearchIndicator } from "./clusterSearch";
import { stackedImbalanceIndicator } from "./stackedImbalance";
import { depthOfMarketIndicator } from "./depthOfMarket";
import { rsiIndicator } from "./rsi";
import { bidAskRatioIndicator } from "./bidAskRatio";
import { longShortRatioIndicator } from "./longShortRatio";
import { buySellZoneIndicator } from "./buySellZone";

export * from "./types";
export * from "./volumeOnChart";
export * from "./delta";
export * from "./cvd";
export * from "./clusterSearch";
export * from "./stackedImbalance";
export * from "./depthOfMarket";
export * from "./rsi";
export * from "./bidAskRatio";
export * from "./longShortRatio";
export * from "./buySellZone";

export const MODULAR_INDICATORS: IndicatorModule[] = [
  volumeOnChartIndicator,
  deltaIndicator,
  cvdIndicator,
  clusterSearchIndicator,
  stackedImbalanceIndicator,
  depthOfMarketIndicator,
  rsiIndicator,
  bidAskRatioIndicator,
  longShortRatioIndicator,
  buySellZoneIndicator
];
