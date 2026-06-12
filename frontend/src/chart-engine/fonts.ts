import { BitmapFont } from 'pixi.js';
import { ENGINE_CONFIG } from './config';

export const CLUSTER_FONT_NAME = 'clusterFont';

let fontInstalled = false;

export function installClusterFont(): void {
  if (fontInstalled) return;
  BitmapFont.install({
    name: CLUSTER_FONT_NAME,
    style: {
      fontFamily: 'monospace',
      fontSize: ENGINE_CONFIG.bitmapFontSize,
      fill: 0xffffff,
    },
    chars: [['0', '9'], '.', '-', ' '],
    resolution: window.devicePixelRatio || 1,
    skipKerning: true,
  });
  fontInstalled = true;
}
