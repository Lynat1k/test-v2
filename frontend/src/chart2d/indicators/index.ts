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
import { openInterestIndicator } from "./openInterest";
import { netOpenInterestIndicator } from "./netOpenInterest";
import { buySellZoneIndicator } from "./buySellZone";
import { dynamicLevelsIndicator } from "./dynamicLevels";

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
export * from "./openInterest";
export * from "./netOpenInterest";
export * from "./buySellZone";
export * from "./dynamicLevels";

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
  openInterestIndicator,
  netOpenInterestIndicator,
  buySellZoneIndicator,
  dynamicLevelsIndicator
];
