export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ClusterLevel {
  priceLevel: number;
  bidVolume: number;
  askVolume: number;
}

export interface ClusterCandle extends Candle {
  levels: ClusterLevel[];
  openPrice: number;
  closePrice: number;
  totalBid: number;
  totalAsk: number;
  totalDelta: number;
  tradesCount: number;
}

export interface ViewportState {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

export interface EngineConfig {
  container: HTMLElement;
  width: number;
  height: number;
  palette: 'default' | 'alternative';
}

export interface EngineEvents {
  viewportChange: (state: ViewportState) => void;
  needHistory: (before: number) => void;
  frame: (fps: number) => void;
}

export type CandleMode = 'auto' | 'japanese' | 'footprint' | 'clusters' | 'bars';

export type VolumeMode = 'bidask' | 'volume' | 'delta';
