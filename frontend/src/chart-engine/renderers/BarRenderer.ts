import { Container, Graphics } from 'pixi.js';
import type { Candle } from '../types';
import { ObjectPool } from '../pool/ObjectPool';
import type { Scales } from '../Scales';

const BULL = 0x10b981;
const BEAR = 0xf43f5e;
const BULL_ALT = 0xe2e8f0;
const BEAR_ALT = 0x374151;

interface BarGraphics {
  wick: Graphics;
  openTick: Graphics;
  closeTick: Graphics;
  container: Container;
}

export class BarRenderer {
  private parentContainer: Container;
  private container: Container;
  private scales: Scales;
  private pool: ObjectPool<BarGraphics>;
  private activeItems: BarGraphics[] = [];
  private bullColor = BULL;
  private bearColor = BEAR;

  constructor(parentContainer: Container, scales: Scales) {
    this.parentContainer = parentContainer;
    this.container = new Container();
    parentContainer.addChild(this.container);
    this.scales = scales;

    this.pool = new ObjectPool<BarGraphics>(
      () => this.createBarGraphics(),
      (bg) => this.resetBarGraphics(bg),
      1000,
    );
  }

  private createBarGraphics(): BarGraphics {
    const wick = new Graphics();
    const openTick = new Graphics();
    const closeTick = new Graphics();
    const container = new Container();
    container.addChild(wick, openTick, closeTick);
    this.container.addChild(container);
    return { wick, openTick, closeTick, container };
  }

  private resetBarGraphics(bg: BarGraphics): void {
    bg.container.visible = false;
    try { bg.wick.clear(); } catch { /* context destroyed */ }
    try { bg.openTick.clear(); } catch { /* context destroyed */ }
    try { bg.closeTick.clear(); } catch { /* context destroyed */ }
  }

  render(candles: Candle[], startIndex: number, endIndex: number, firstTimestamp: number): void {
    try { this.pool.releaseAll(); } catch {}
    this.activeItems.length = 0;

    const spacing = this.scales.getCandleSpacing();
    const tickLen = Math.max(3, Math.floor(spacing * 0.3));

    for (let i = startIndex; i <= endIndex; i++) {
      const candle = candles[i];
      if (!candle) continue;

      const bg = this.pool.acquire();
      this.activeItems.push(bg);

      const isBull = candle.close >= candle.open;
      const color = isBull ? this.bullColor : this.bearColor;

      const x = this.scales.timeToScreen(candle.timestamp, firstTimestamp);
      const openY = this.scales.priceToScreen(candle.open);
      const closeY = this.scales.priceToScreen(candle.close);
      const highY = this.scales.priceToScreen(candle.high);
      const lowY = this.scales.priceToScreen(candle.low);

      bg.wick.clear();
      bg.wick.rect(x - 0.5, highY, 1, lowY - highY);
      bg.wick.fill(color);

      bg.openTick.clear();
      bg.openTick.rect(x - tickLen, openY - 0.5, tickLen, 1);
      bg.openTick.fill(color);

      bg.closeTick.clear();
      bg.closeTick.rect(x, closeY - 0.5, tickLen, 1);
      bg.closeTick.fill(color);

      bg.container.visible = true;
    }
  }

  setPalette(palette: 'default' | 'alternative'): void {
    if (palette === 'alternative') {
      this.bullColor = BULL_ALT;
      this.bearColor = BEAR_ALT;
    } else {
      this.bullColor = BULL;
      this.bearColor = BEAR;
    }
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
