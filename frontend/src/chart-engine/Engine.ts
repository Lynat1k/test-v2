import type { Candle, CandleMode, ClusterLevel, EngineConfig, ViewportState, VolumeMode } from './types';
import { Renderer } from './Renderer';
import { Viewport } from './Viewport';
import { DataStore } from './DataStore';
import { InteractionManager } from './interaction/InteractionManager';
import { ENGINE_CONFIG } from './config';

export class Engine {
  private renderer: Renderer;
  private viewport: Viewport;
  private dataStore: DataStore;
  private interaction!: InteractionManager;
  private config: EngineConfig;
  private animationFrameId: number = 0;
  private isPaused: boolean = false;
  private currentMode: CandleMode = 'japanese';
  private volumeMode: VolumeMode = 'bidask';
  private compression: number = 1;

  private onViewportChange?: (state: ViewportState) => void;
  private onNeedHistory?: (before: number) => void;

  constructor(config: EngineConfig) {
    this.config = config;

    this.renderer = new Renderer(config.width, config.height);
    this.viewport = new Viewport(config.width, config.height);
    this.dataStore = new DataStore();

    this.viewport.setOnChange((state) => {
      this.onViewportChange?.(state);
      this.requestRender();
    });

    this.dataStore.setOnNeedHistory((before) => {
      this.onNeedHistory?.(before);
    });

    this.dataStore.setOnUpdate(() => {
      this.requestRender();
    });
  }

  async init(): Promise<void> {
    await this.renderer.init(this.config.container);

    const scales = this.renderer.getScales();
    this.viewport.setClampScaleX((scaleX, _dataLength) => {
      return scales.clampScaleX(scaleX, this.dataStore.length);
    });

    this.interaction = new InteractionManager(
      this.config.container.querySelector('canvas')!,
      this.viewport,
    );

    this.requestRender();
  }

  setData(candles: Candle[]): void {
    this.dataStore.setData(candles);

    const { min, max } = this.dataStore.getPriceRange();
    this.viewport.autoFit(min, max, this.dataStore.length, 8);
  }

  prependData(candles: Candle[]): void {
    this.dataStore.prependData(candles);
  }

  updateLast(candle: Candle): void {
    this.dataStore.updateLast(candle);
  }

  setClusterData(timestamp: number, levels: ClusterLevel[]): void {
    this.dataStore.setClusterData(timestamp, levels);
    this.requestRender();
  }

  setClusterDataBatch(data: Map<number, ClusterLevel[]>): void {
    this.dataStore.setClusterDataBatch(data);
    this.requestRender();
  }

  setPalette(palette: 'default' | 'alternative'): void {
    this.renderer.setPalette(palette);
    this.requestRender();
  }

  setMode(mode: CandleMode): void {
    this.currentMode = mode;
    this.requestRender();
  }

  setVolumeMode(mode: VolumeMode): void {
    this.volumeMode = mode;
    this.renderer.setVolumeMode(mode);
    this.requestRender();
  }

  setCompression(level: number): void {
    this.compression = level;
    this.renderer.setCompression(level);
    this.requestRender();
  }

  getMode(): CandleMode {
    return this.currentMode;
  }

  getResolvedMode(): Exclude<CandleMode, 'auto'> {
    if (this.currentMode !== 'auto') return this.currentMode;
    const scales = this.renderer.getScales();
    const { start, end } = scales.getVisibleRange(this.dataStore.length);
    return this.resolveAutoMode(end - start + 1);
  }

  getVolumeMode(): VolumeMode {
    return this.volumeMode;
  }

  getCompression(): number {
    return this.compression;
  }

  on(event: 'viewportChange', callback: (state: ViewportState) => void): void;
  on(event: 'needHistory', callback: (before: number) => void): void;
  on(event: string, callback: (...args: any[]) => void): void {
    switch (event) {
      case 'viewportChange':
        this.onViewportChange = callback as (state: ViewportState) => void;
        break;
      case 'needHistory':
        this.onNeedHistory = callback as (before: number) => void;
        break;
    }
  }

  private requestRender(): void {
    if (this.isPaused) return;

    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = requestAnimationFrame(() => {
      this.render();
    });
  }

  private render(): void {
    const viewportState = this.viewport.getState();
    const candles = this.dataStore.getCandles();

    if (candles.length === 0) return;

    const firstTimestamp = candles[0]!.timestamp;
    const { min, max } = this.dataStore.getPriceRange();

    const scales = this.renderer.getScales();
    const { start, end } = scales.getVisibleRange(candles.length);
    const visibleCount = end - start + 1;

    const resolvedMode = this.currentMode === 'auto'
      ? this.resolveAutoMode(visibleCount)
      : this.currentMode;

    this.renderer.setMode(resolvedMode);
    this.renderer.renderCandles(candles as Candle[], viewportState, firstTimestamp);
    this.renderer.renderAxis(viewportState, min, max);

    this.dataStore.checkHistoryNeeded(start);
  }

  private resolveAutoMode(visibleCount: number): Exclude<CandleMode, 'auto'> {
    const t = ENGINE_CONFIG.autoModeThresholds;
    if (visibleCount < t.clusters) return 'clusters';
    if (visibleCount <= t.footprint) return 'footprint';
    return 'japanese';
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
    this.requestRender();
  }

  resize(width: number, height: number): void {
    this.renderer.resize(width, height);
    this.viewport.resize(width, height);
  }

  getFPS(): number {
    return this.renderer.getFPS();
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.interaction?.destroy();
    this.renderer.destroy();
  }
}
