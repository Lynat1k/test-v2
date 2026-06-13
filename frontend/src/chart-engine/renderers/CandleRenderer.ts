import { Container, Graphics } from 'pixi.js';
import type { Candle } from '../types';
import { ObjectPool } from '../pool/ObjectPool';
import type { Scales } from '../Scales';

const BULL = 0x10b981;
const BEAR = 0xf43f5e;
const BULL_ALT = 0xe2e8f0;
const BEAR_ALT = 0x374151;
const CANDLE_GAP = 0.2;

interface CandleGraphics {
  body: Graphics;
  wick: Graphics;
  container: Container;
}

export class CandleRenderer {
  private parentContainer: Container;
  private container: Container;
  private scales: Scales;
  private pool: ObjectPool<CandleGraphics>;
  private activeCandles: CandleGraphics[] = [];
  private bullColor = BULL;
  private bearColor = BEAR;

  constructor(parentContainer: Container, scales: Scales) {
    this.parentContainer = parentContainer;
    this.container = new Container();
    parentContainer.addChild(this.container);
    this.scales = scales;

    this.pool = new ObjectPool<CandleGraphics>(
      () => this.createCandleGraphics(),
      (cg) => this.resetCandleGraphics(cg),
      1000,
    );
  }

  private createCandleGraphics(): CandleGraphics {
    const wick = new Graphics();
    const body = new Graphics();
    const container = new Container();
    container.addChild(wick, body);
    this.container.addChild(container);
    return { body, wick, container };
  }

  private resetCandleGraphics(cg: CandleGraphics): void {
    cg.container.visible = false;
    try { cg.wick.clear(); } catch { /* context destroyed */ }
    try { cg.body.clear(); } catch { /* context destroyed */ }
  }

  render(candles: Candle[], startIndex: number, endIndex: number, firstTimestamp: number): void {
    try { this.pool.releaseAll(); } catch {}
    this.activeCandles.length = 0;

    const spacing = this.scales.getCandleSpacing();
    const bodyWidth = Math.max(1, Math.min(Math.floor(spacing * (1 - CANDLE_GAP)), Math.floor(spacing - 1)));
    const halfBody = bodyWidth / 2;

    for (let i = startIndex; i <= endIndex; i++) {
      const candle = candles[i];
      if (!candle) continue;

      const cg = this.pool.acquire();
      this.activeCandles.push(cg);

      const isBull = candle.close >= candle.open;
      const color = isBull ? this.bullColor : this.bearColor;

      const x = this.scales.timeToScreen(candle.timestamp, firstTimestamp);
      const openY = this.scales.priceToScreen(candle.open);
      const closeY = this.scales.priceToScreen(candle.close);
      const highY = this.scales.priceToScreen(candle.high);
      const lowY = this.scales.priceToScreen(candle.low);

      cg.wick.clear();
      cg.wick.rect(x - 0.5, highY, 1, lowY - highY);
      cg.wick.fill(color);

      const bodyY = Math.min(openY, closeY);
      const bodyH = Math.abs(closeY - openY) || 1;
      cg.body.clear();
      cg.body.rect(x - halfBody, bodyY, bodyWidth, bodyH);
      cg.body.fill(color);

      cg.container.visible = true;
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
