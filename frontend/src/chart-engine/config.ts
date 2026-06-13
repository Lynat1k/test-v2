export const ENGINE_CONFIG = {
  autoModeThresholds: {
    clusters: 100,
    footprint: 300,
  },
  imbalanceThreshold: 300,
  compressionLevels: 10,
  maxVisibleCandles: 2000,
  maxBitmapTextZoom: 0.5,
  bitmapFontSize: 12,
  rightPadding: 60,
  bottomPadding: 30,
  candleWidthDefault: 8,
  clusterLevelHeight: 14,
  volumeBarMaxWidth: 30,
} as const;
