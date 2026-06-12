import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { Candle } from '../types';
import { ObjectPool } from '../pool/ObjectPool';
import type { Scales } from '../Scales';

interface CandleGraphics {
  body: Graphics;
  wick: Graphics;
  container: Container;
}

export class CandleRenderer {
  private container: Container;
  private scales: Scales;
  private pool: ObjectPool<CandleGraphics>;
  private activeCandles: CandleGraphics[] = [];
  
  // Pre-built contexts (one per color)
  private bullBodyCtx: GraphicsContext;
  private bearBodyCtx: GraphicsContext;
  private bullWickCtx: GraphicsContext;
  private bearWickCtx: GraphicsContext;

  constructor(parentContainer: Container, scales: Scales) {
    this.container = new Container();
    parentContainer.addChild(this.container);
    this.scales = scales;

    // Create shared contexts (expensive, done once)
    this.bullBodyCtx = new GraphicsContext()
      .rect(-0.5, -1, 1, 1)
      .fill(0x10b981);  // Green
    
    this.bearBodyCtx = new GraphicsContext()
      .rect(-0.5, -1, 1, 1)
      .fill(0xf43f5e);  // Red
    
    this.bullWickCtx = new GraphicsContext()
      .rect(-0.5, -1, 1, 1)
      .fill(0x10b981);
    
    this.bearWickCtx = new GraphicsContext()
      .rect(-0.5, -1, 1, 1)
      .fill(0xf43f5e);

    // Initialize pool
    this.pool = new ObjectPool<CandleGraphics>(
      () => this.createCandleGraphics(),
      (cg) => this.resetCandleGraphics(cg),
      1000  // Pre-allocate 1000 candles
    );
  }

  private createCandleGraphics(): CandleGraphics {
    const body = new Graphics(this.bullBodyCtx);
    const wick = new Graphics(this.bullWickCtx);
    const container = new Container();
    container.addChild(wick, body);
    this.container.addChild(container);
    
    return { body, wick, container };
  }

  private resetCandleGraphics(cg: CandleGraphics): void {
    cg.container.visible = false;
  }

  render(candles: Candle[], startIndex: number, endIndex: number, firstTimestamp: number): void {
    // Release previous candles back to pool
    for (const cg of this.activeCandles) {
      this.pool.release(cg);
    }
    this.activeCandles = [];

    // Render only visible candles
    for (let i = startIndex; i <= endIndex; i++) {
      const candle = candles[i];
      if (!candle) continue;

      const cg = this.pool.acquire();
      this.activeCandles.push(cg);

      const isBull = candle.close >= candle.open;
      const bodyCtx = isBull ? this.bullBodyCtx : this.bearBodyCtx;
      const wickCtx = isBull ? this.bullWickCtx : this.bearWickCtx;

      // Position body
      const x = this.scales.timeToScreen(candle.timestamp, firstTimestamp);
      const openY = this.scales.priceToScreen(candle.open);
      const closeY = this.scales.priceToScreen(candle.close);
      const highY = this.scales.priceToScreen(candle.high);
      const lowY = this.scales.priceToScreen(candle.low);

      // Wick (high to low)
      cg.wick.context = wickCtx;
      cg.wick.x = x;
      cg.wick.y = highY;
      cg.wick.scale.set(1, lowY - highY);
      cg.wick.visible = true;

      // Body (open to close)
      cg.body.context = bodyCtx;
      cg.body.x = x;
      cg.body.y = Math.min(openY, closeY);
      cg.body.scale.set(8, Math.abs(closeY - openY) || 1);  // Min 1px height
      cg.body.visible = true;

      cg.container.visible = true;
    }
  }

  setPalette(palette: 'default' | 'alternative'): void {
    if (palette === 'alternative') {
      this.bullBodyCtx = new GraphicsContext().rect(-0.5, -1, 1, 1).fill(0xe2e8f0);
      this.bearBodyCtx = new GraphicsContext().rect(-0.5, -1, 1, 1).fill(0x374151);
      this.bullWickCtx = new GraphicsContext().rect(-0.5, -1, 1, 1).fill(0xe2e8f0);
      this.bearWickCtx = new GraphicsContext().rect(-0.5, -1, 1, 1).fill(0x374151);
    } else {
      this.bullBodyCtx = new GraphicsContext().rect(-0.5, -1, 1, 1).fill(0x10b981);
      this.bearBodyCtx = new GraphicsContext().rect(-0.5, -1, 1, 1).fill(0xf43f5e);
      this.bullWickCtx = new GraphicsContext().rect(-0.5, -1, 1, 1).fill(0x10b981);
      this.bearWickCtx = new GraphicsContext().rect(-0.5, -1, 1, 1).fill(0xf43f5e);
    }
  }

  destroy(): void {
    this.pool.releaseAll();
    this.container.destroy({ children: true });
  }
}
