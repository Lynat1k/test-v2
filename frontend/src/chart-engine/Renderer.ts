import { Application, Container } from 'pixi.js';
import type { ViewportState, Candle, CandleMode, VolumeMode } from './types';
import { CandleRenderer } from './renderers/CandleRenderer';
import { ClusterRenderer } from './renderers/ClusterRenderer';
import { FootprintRenderer } from './renderers/FootprintRenderer';
import { BarRenderer } from './renderers/BarRenderer';
import { AxisRenderer } from './renderers/AxisRenderer';
import { ClusterTextOverlay } from './renderers/ClusterTextOverlay';
import { Scales } from './Scales';

export class Renderer {
  private app: Application;
  private stage: Container;
  private candleRenderer: CandleRenderer;
  private clusterRenderer: ClusterRenderer;
  private footprintRenderer: FootprintRenderer;
  private barRenderer: BarRenderer;
  private axisRenderer: AxisRenderer;
  private clusterTextOverlay: ClusterTextOverlay;
  private scales: Scales;
  private width: number;
  private height: number;
  private fps: number = 0;
  private frameCount: number = 0;
  private lastFpsTime: number = performance.now();
  private currentMode: CandleMode = 'japanese';
  private pixiCanvas: HTMLCanvasElement | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.app = new Application();
    this.stage = new Container();

    const viewport: ViewportState = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
    this.scales = new Scales(viewport, width, height);

    this.candleRenderer = new CandleRenderer(this.stage, this.scales);
    this.clusterRenderer = new ClusterRenderer(this.stage, this.scales);
    this.footprintRenderer = new FootprintRenderer(this.stage, this.scales);
    this.barRenderer = new BarRenderer(this.stage, this.scales);
    this.axisRenderer = new AxisRenderer(width, height);
    this.clusterTextOverlay = new ClusterTextOverlay(width, height);
  }

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({
      width: this.width,
      height: this.height,
      backgroundAlpha: 0,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
    });

    this.pixiCanvas = this.app.canvas as HTMLCanvasElement;
    container.appendChild(this.pixiCanvas);

    const textCanvas = this.clusterTextOverlay.getCanvas();
    textCanvas.style.position = 'absolute';
    textCanvas.style.top = '0';
    textCanvas.style.left = '0';
    textCanvas.style.pointerEvents = 'none';
    container.appendChild(textCanvas);

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

    // Hide all, show active
    this.candleRenderer.setVisible(this.currentMode === 'japanese');
    this.clusterRenderer.setVisible(this.currentMode === 'clusters');
    this.footprintRenderer.setVisible(this.currentMode === 'footprint');
    this.barRenderer.setVisible(this.currentMode === 'bars');

    this.clusterTextOverlay.clear();

    // Only render active mode
    switch (this.currentMode) {
      case 'clusters':
        this.clusterRenderer.render(candles, start, end, firstTimestamp, this.clusterTextOverlay);
        break;
      case 'footprint':
        this.footprintRenderer.render(candles, start, end, firstTimestamp, this.clusterTextOverlay);
        break;
      case 'bars':
        this.barRenderer.render(candles, start, end, firstTimestamp);
        break;
      case 'japanese':
      default:
        this.candleRenderer.render(candles, start, end, firstTimestamp);
        break;
    }
  }

  renderAxis(viewport: ViewportState, minPrice: number, maxPrice: number, candles?: Candle[]): void {
    this.scales.updateViewport(viewport);
    this.axisRenderer.render(viewport, this.scales, minPrice, maxPrice, candles);
  }

  setPalette(palette: 'default' | 'alternative'): void {
    this.candleRenderer.setPalette(palette);
    this.barRenderer.setPalette(palette);
  }

  setMode(mode: CandleMode): void {
    this.currentMode = mode;
  }

  setVolumeMode(mode: VolumeMode): void {
    this.clusterRenderer.setVolumeMode(mode);
    this.footprintRenderer.setVolumeMode(mode);
  }

  setCompression(level: number): void {
    this.clusterRenderer.setCompression(level);
    this.footprintRenderer.setCompression(level);
  }

  getFPS(): number {
    return this.fps;
  }

  getScales(): Scales {
    return this.scales;
  }

  getPixiCanvas(): HTMLCanvasElement | null {
    return this.pixiCanvas;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.scales.updateSize(width, height);
    this.axisRenderer.resize(width, height);
    this.clusterTextOverlay.resize(width, height);
  }

  destroy(): void {
    this.candleRenderer.destroy();
    this.clusterRenderer.destroy();
    this.footprintRenderer.destroy();
    this.barRenderer.destroy();
    this.axisRenderer.destroy();
    this.clusterTextOverlay.destroy();
    this.pixiCanvas?.remove();
    this.pixiCanvas = null;
    try { this.app.destroy(); } catch { /* PixiJS v8 compat */ }
  }
}
