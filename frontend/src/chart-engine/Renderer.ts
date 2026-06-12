import { Application, Container } from 'pixi.js';
import type { ViewportState, Candle } from './types';
import { CandleRenderer } from './renderers/CandleRenderer';
import { AxisRenderer } from './renderers/AxisRenderer';
import { Scales } from './Scales';

export class Renderer {
  private app: Application;
  private stage: Container;
  private candleRenderer: CandleRenderer;
  private axisRenderer: AxisRenderer;
  private scales: Scales;
  private width: number;
  private height: number;
  private fps: number = 0;
  private frameCount: number = 0;
  private lastFpsTime: number = performance.now();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.app = new Application();
    this.stage = new Container();

    const viewport: ViewportState = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
    this.scales = new Scales(viewport, width, height);

    this.candleRenderer = new CandleRenderer(this.stage, this.scales);
    this.axisRenderer = new AxisRenderer(width, height);
  }

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({
      width: this.width,
      height: this.height,
      backgroundAlpha: 0,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
    });

    container.appendChild(this.app.canvas as HTMLCanvasElement);
    container.appendChild(this.axisRenderer.getCanvas());

    const axisCanvas = this.axisRenderer.getCanvas();
    axisCanvas.style.position = 'absolute';
    axisCanvas.style.top = '0';
    axisCanvas.style.left = '0';
    axisCanvas.style.pointerEvents = 'none';

    this.app.stage.addChild(this.stage);

    this.app.ticker.add(() => {
      this.frameCount++;
      const now = performance.now();
      if (now - this.lastFpsTime >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsTime = now;
      }
    });
  }

  renderCandles(candles: Candle[], viewport: ViewportState, firstTimestamp: number): void {
    this.scales.updateViewport(viewport);
    const { start, end } = this.scales.getVisibleRange(candles.length);
    this.candleRenderer.render(candles, start, end, firstTimestamp);
  }

  renderAxis(viewport: ViewportState, minPrice: number, maxPrice: number): void {
    this.scales.updateViewport(viewport);
    this.axisRenderer.render(viewport, this.scales, minPrice, maxPrice);
  }

  setPalette(palette: 'default' | 'alternative'): void {
    this.candleRenderer.setPalette(palette);
  }

  getFPS(): number {
    return this.fps;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.scales.updateSize(width, height);
    this.axisRenderer.resize(width, height);
  }

  destroy(): void {
    this.candleRenderer.destroy();
    this.axisRenderer.destroy();
    this.app.destroy(true);
  }
}
