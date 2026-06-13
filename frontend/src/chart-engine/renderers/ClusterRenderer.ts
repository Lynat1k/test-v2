import { Container, Graphics } from 'pixi.js';
import type { Candle, ClusterCandle, ClusterLevel, VolumeMode } from '../types';
import { ObjectPool } from '../pool/ObjectPool';
import type { Scales } from '../Scales';
import { ENGINE_CONFIG } from '../config';
import { DataStore } from '../DataStore';
import type { ClusterTextOverlay } from './ClusterTextOverlay';

function compressLevels(levels: ClusterLevel[], factor: number): ClusterLevel[] {
  return DataStore.compressLevels(levels, factor);
}

interface ClusterCell {
  body: Graphics;
  wick: Graphics;
  container: Container;
}

export class ClusterRenderer {
  private parentContainer: Container;
  private container: Container;
  private scales: Scales;
  private pool: ObjectPool<ClusterCell>;
  private activeCells: ClusterCell[] = [];
  private volumeMode: VolumeMode = 'bidask';
  private compression: number = 1;

  constructor(_parentContainer: Container, scales: Scales) {
    this.parentContainer = _parentContainer;
    this.container = new Container();
    _parentContainer.addChild(this.container);
    this.scales = scales;

    this.pool = new ObjectPool<ClusterCell>(
      () => this.createCell(),
      (cell) => this.resetCell(cell),
      2000,
    );
  }

  private createCell(): ClusterCell {
    const container = new Container();
    const body = new Graphics();
    const wick = new Graphics();
    container.addChild(wick, body);
    this.container.addChild(container);
    return { body, wick, container };
  }

  private resetCell(cell: ClusterCell): void {
    cell.container.visible = false;
    try { cell.wick.clear(); } catch { /* context destroyed */ }
    try { cell.body.clear(); } catch { /* context destroyed */ }
  }

  render(candles: Candle[], startIndex: number, endIndex: number, firstTimestamp: number, textOverlay?: ClusterTextOverlay): void {
    try { this.pool.releaseAll(); } catch {}
    this.activeCells.length = 0;

    const step = ENGINE_CONFIG.clusterLevelHeight;
    const spacing = this.scales.getCandleSpacing();
    const bodyWidth = Math.max(1, Math.min(Math.floor(spacing * 0.8), Math.floor(spacing - 1)));
    const halfBody = bodyWidth / 2;

    for (let i = startIndex; i <= endIndex; i++) {
      const candle = candles[i] as ClusterCandle;
      if (!candle || !candle.levels || candle.levels.length === 0) continue;

      const levels = this.compression > 1
        ? compressLevels(candle.levels, this.compression)
        : candle.levels;

      const x = this.scales.timeToScreen(candle.timestamp, firstTimestamp);
      const highY = this.scales.priceToScreen(candle.high);
      const lowY = this.scales.priceToScreen(candle.low);
      const topY = Math.min(highY, lowY);
      const bottomY = Math.max(highY, lowY);
      const visTop = Math.max(0, topY);
      const visBottom = Math.min(672, bottomY);
      const visHeight = visBottom - visTop;
      if (visHeight < step * 0.5) continue;

      const visibleLevels = Math.min(
        levels.length,
        Math.max(1, Math.floor(visHeight / step)),
      );

      if (visibleLevels <= 0) continue;

      const startLevel = Math.floor((levels.length - visibleLevels) / 2);

      for (let j = 0; j < visibleLevels; j++) {
        const levelIdx = startLevel + j;
        const level = levels[levelIdx];
        if (!level) continue;

        const levelY = this.scales.priceToScreen(level.priceLevel);
        const cellY = levelY - step / 2;

        if (cellY + step < 0 || cellY > 672) continue;

        const cell = this.pool.acquire();
        this.activeCells.push(cell);

        cell.container.visible = true;

        if (textOverlay) {
          const prev = levelIdx > 0 ? levels[levelIdx - 1] : undefined;
          const threshold = ENGINE_CONFIG.imbalanceThreshold / 100;
          const askImbalance = prev && prev.bidVolume > 0 && level.askVolume / prev.bidVolume > threshold;
          const bidImbalance = prev && prev.askVolume > 0 && level.bidVolume / prev.askVolume > threshold;

          let text1: string;
          let text2: string;
          let color1: string;
          let color2: string;

          if (this.volumeMode === 'volume') {
            const vol = (level.bidVolume + level.askVolume).toFixed(1);
            text1 = vol;
            text2 = '';
            color1 = '#a78bfa';
            color2 = '';
          } else if (this.volumeMode === 'delta') {
            const delta = level.bidVolume - level.askVolume;
            const sign = delta >= 0 ? '+' : '';
            text1 = `${sign}${delta.toFixed(1)}`;
            text2 = '';
            color1 = delta >= 0 ? '#10b981' : '#f43f5e';
            color2 = '';
          } else {
            text1 = level.bidVolume.toFixed(1);
            text2 = level.askVolume.toFixed(1);
            color1 = bidImbalance ? '#ff6090' : '#10b981';
            color2 = askImbalance ? '#00e5a0' : '#f43f5e';
          }

          textOverlay.drawText(text1, x - halfBody, cellY, color1, 'left');
          if (text2) {
            textOverlay.drawText(text2, x + 2, cellY, color2, 'left');
          }
        }
      }
    }
  }

  setVolumeMode(mode: VolumeMode): void {
    this.volumeMode = mode;
  }

  setCompression(level: number): void {
    this.compression = level;
  }

  setVisible(visible: boolean): void {
    if (visible) {
      if (!this.container.parent) {
        this.parentContainer.addChild(this.container);
      }
    } else {
      if (this.container.parent) {
        this.container.parent.removeChild(this.container);
      }
    }
  }

  destroy(): void {
    this.pool.releaseAll();
    this.container.destroy({ children: true });
  }
}
