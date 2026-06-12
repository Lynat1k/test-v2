export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

export type CandleMode = 'japanese' | 'footprint' | 'clusters';
