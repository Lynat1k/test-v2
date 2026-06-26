export interface ClusterCell {
  price: number;
  bid: number;
  ask: number;
  volume: number;
  isPoc: boolean;
  isBuyImbalance: boolean;
  isSellImbalance: boolean;
}

export interface ClusterCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  pocPrice: number;
  cells: ClusterCell[];
  vah: number;
  val: number;
  tickCount?: number;
}

export interface OrderBookRow {
  price: number;
  amount: number;
  total: number;
  percentage: number;
}

export interface OrderBook {
  bids: OrderBookRow[];
  asks: OrderBookRow[];
}

export interface LiveTrade {
  id: string;
  timestamp: number;
  price: number;
  amount: number;
  side: "buy" | "sell";
  isWhale: boolean;
}

export interface CryptoPair {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  delta24h: number;
  priceStep: number;
  compressionSpot?: number;
  compressionFutures?: number;
  minTickStep?: number;
  minTickStepSpot?: number;
  minTickStepFutures?: number;
}

export interface AIAnalysis {
  timestamp: number;
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  details: string;
  support: number;
  resistance: number;
  recommendation: string;
}

export interface IndicatorSettings {
  mode?: string;
  direction?: string;
  location?: string;
  sensitivity?: number;
  useMinMax?: boolean;
  opacity?: number;
  showLabels?: boolean;
  smoothing?: number;
  ratio?: number;

  csMedEnabled?: boolean;
  csMedMinVolume?: number;
  csMedMaxVolume?: number;
  csMedMinSize?: number;
  csMedMaxSize?: number;
  csMedShape?: "circle" | "square" | "rhombus";
  csMedColorBid?: string;
  csMedColorAsk?: string;
  csMedOpacity?: number;
  csMedTgAlert?: boolean;
  csMedMergeLevels?: number;
  csMedImbalancePercent?: number;
  csMedMinDelta?: number;
  csMedLocation?: "any" | "body" | "lowerWick" | "upperWick";

  csLargeEnabled?: boolean;
  csLargeMinVolume?: number;
  csLargeMinSize?: number;
  csLargeMaxSize?: number;
  csLargeShape?: "circle" | "square" | "rhombus";
  csLargeColorBid?: string;
  csLargeColorAsk?: string;
  csLargeOpacity?: number;
  csLargeTgAlert?: boolean;
  csLargeMergeLevels?: number;
  csLargeImbalancePercent?: number;
  csLargeMinDelta?: number;
  csLargeLocation?: "any" | "body" | "lowerWick" | "upperWick";

  csMergeLevels?: number;
  csImbalancePercent?: number;

  volumeOnChartDeltaThreshold?: number;
  volumeOnChartMaxHeightPercent?: number;

  cvdLineColor?: string;
  cvdPeriod?: "all" | "day" | "week" | "month" | "visible";
  cvdPlotType?: "line" | "candles";

  rsiPeriod?: number;
  rsiLineColor?: string;
  rsiZoneColor?: string;
  rsiZoneOpacity?: number;

  deltaPlotType?: "candles" | "bars";

  siRatio?: number;
  siRange?: number;
  siVolume?: number;
  siColorNeg?: string;
  siColorPos?: string;
  siLineWidth?: number;

  domWidthMode?: "auto" | "manual";
  domMaxWidth?: number;
  domColorBid?: string;
  domColorAsk?: string;
  domOpacity?: number;
}

export interface Indicator {
  id: string;
  label: string;
  category: "Все индикаторы" | "Избранные" | "Сообщество";
  type: "Оверлей" | "Подвальный" | "Глобальный";
  isFavorite: boolean;
  isActive: boolean;
  isVisible?: boolean;
  settings: IndicatorSettings;
}

export interface ProfileUser {
  name: string;
  email: string;
  avatar: string;
  regDate: string;
  tier: "Free" | "Pro" | "VIP";
}
