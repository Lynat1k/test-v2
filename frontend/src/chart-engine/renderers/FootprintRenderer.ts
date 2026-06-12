import { Container, Graphics } from 'pixi.js';
import type { Candle, ClusterCandle, VolumeMode } from '../types';
import { ObjectPool } from '../pool/ObjectPool';
import type { Scales } from '../Scales';
import { ENGINE_CONFIG } from '../config';
import type { ClusterTextOverlay } from './ClusterTextOverlay';

const BID_COLOR = 0x10b981;
const ASK_COLOR = 0xf43f5e;

interface FootprintCell {
  body: Graphics;
  wick: Graphics;
  volumeBar: Graphics;
  container: Container;
}

export class FootprintRenderer {
  private container: Container;
  private scales: Scales;
  private pool: ObjectPool<FootprintCell>;
  private activeCells: FootprintCell[] = [];
  private bullColor = BID_COLOR;
  private bearColor = ASK_COLOR;
  private volumeMode: VolumeMode = 'bidask';

  constructor(_parentContainer: Container, scales: Scales) {
    this.container = new Container();
    _parentContainer.addChild(this.container);
    this.scales = scales;

    this.pool = new ObjectPool<FootprintCell>(
      () => this.createCell(),
      (cell) => this.resetCell(cell),
      2000,
    );
  }

  private createCell(): FootprintCell {
    const container = new Container();
    const body = new Graphics();
    const wick = new Graphics();
    const volumeBar = new Graphics();
    container.addChild(body, wick, volumeBar);
    this.container.addChild(container);
    return { container, body, wick, volumeBar };
  }

  private resetCell(cell: FootprintCell): void {
    cell.container.visible = false;
    cell.wick.clear();
    cell.body.clear();
    cell.volumeBar.clear();
  }

  render(candles: Candle[], startIndex: number, endIndex: number, firstTimestamp: number, textOverlay?: ClusterTextOverlay): void {
    this.pool.releaseAll();
    this.activeCells.length = 0;

    const step = ENGINE_CONFIG.clusterLevelHeight;
    const spacing = this.scales.getCandleSpacing();
    const bodyWidth = Math.max(1, Math.floor(spacing * 0.8));
    const halfBody = bodyWidth / 2;
    let maxVolume = 0;

    for (let i = startIndex; i <= endIndex; i++) {
      const candle = candles[i] as ClusterCandle;
      if (!candle || !candle.levels || candle.levels.length === 0) continue;
      for (const level of candle.levels) {
        const vol = this.volumeMode === 'delta'
          ? Math.abs(level.bidVolume - level.askVolume)
          : level.bidVolume + level.askVolume;
        if (vol > maxVolume) maxVolume = vol;
      }
    }

    if (maxVolume === 0) maxVolume = 1;

    for (let i = startIndex; i <= endIndex; i++) {
      const candle = candles[i] as ClusterCandle;
      if (!candle || !candle.levels || candle.levels.length === 0) continue;

      const x = this.scales.timeToScreen(candle.timestamp, firstTimestamp);
      const highY = this.scales.priceToScreen(candle.high);
      const lowY = this.scales.priceToScreen(candle.low);
      const topY = Math.min(highY, lowY);
      const bottomY = Math.max(highY, lowY);
      const visTop = Math.max(0, topY);
      const visBottom = Math.min(672, bottomY);
      const visHeight = visBottom - visTop;
      const isBull = candle.close >= candle.open;
      const wickColor = isBull ? this.bullColor : this.bearColor;

      if (visHeight < step * 0.5) continue;

      const visibleLevels = Math.min(
        candle.levels.length,
        Math.max(1, Math.floor(visHeight / step)),
      );

      if (visibleLevels <= 0) continue;

      const startLevel = Math.floor((candle.levels.length - visibleLevels) / 2);

      for (let j = 0; j < visibleLevels; j++) {
        const levelIdx = startLevel + j;
        const level = candle.levels[levelIdx];
        if (!level) continue;

        const levelY = this.scales.priceToScreen(level.priceLevel);
        const cellY = levelY - step / 2;

        if (cellY + step < 0 || cellY > 672) continue;

        const cell = this.pool.acquire();
        this.activeCells.push(cell);

        cell.container.visible = true;

        cell.wick.clear();
        cell.wick.rect(x - 0.5, cellY, 1, step);
        cell.wick.fill({ color: wickColor, alpha: 0.3 });

        cell.body.clear();
        cell.body.rect(x - halfBody, cellY, bodyWidth, step);
        cell.body.fill({ color: wickColor, alpha: 0.15 });

        let volume = 0;
        if (this.volumeMode === 'delta') {
          volume = Math.abs(level.bidVolume - level.askVolume);
        } else {
          volume = level.bidVolume + level.askVolume;
        }

        const barWidth = (volume / maxVolume) * ENGINE_CONFIG.volumeBarMaxWidth;
        const barColor = this.volumeMode === 'delta'
          ? (level.bidVolume > level.askVolume ? BID_COLOR : ASK_COLOR)
          : 0x6366f1;

        cell.volumeBar.clear();
        cell.volumeBar.rect(x + halfBody + 2, cellY + 2, barWidth, step - 4);
        cell.volumeBar.fill({ color: barColor, alpha: 0.4 });

        if (textOverlay) {
          const bidStr = level.bidVolume.toFixed(1);
          const askStr = level.askVolume.toFixed(1);
          textOverlay.drawText(bidStr, x - halfBody, cellY, '#10b981', 'left');
          textOverlay.drawText(askStr, x + 2, cellY, '#f43f5e', 'left');
        }
      }
    }
  }

  setPalette(palette: 'default' | 'alternative'): void {
    if (palette === 'alternative') {
      this.bullColor = 0xe2e8f0;
      this.bearColor = 0x374151;
    } else {
      this.bullColor = 0x10b981;
      this.bearColor = 0xf43f5e;
    }
  }

  setVolumeMode(mode: VolumeMode): void {
    this.volumeMode = mode;
  }

  destroy(): void {
    this.pool.releaseAll();
    this.container.destroy({ children: true });
  }
}
