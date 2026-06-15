import type { ViewportState } from './types';

export class Viewport {
  private state: ViewportState;
  private width: number;
  private height: number;
  private onChange?: (state: ViewportState) => void;
  private clampScaleX?: (scaleX: number, dataLength: number) => number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.state = {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
    };
  }

  getState(): ViewportState {
    return { ...this.state };
  }

  setOnChange(callback: (state: ViewportState) => void): void {
    this.onChange = callback;
  }

  setClampScaleX(fn: (scaleX: number, dataLength: number) => number): void {
    this.clampScaleX = fn;
  }

  pan(dx: number, dy: number): void {
    this.state.offsetX -= dx / this.state.scaleX;
    this.state.offsetY += dy / this.state.scaleY;
    this.notifyChange();
  }

  zoomAt(screenX: number, screenY: number, factorX: number, factorY: number): void {
    const oldOffsetX = this.state.offsetX;
    const oldScaleX = this.state.scaleX;
    const dataY = this.screenToDataY(screenY);

    let newScaleX = oldScaleX * factorX;
    const newScaleY = this.state.scaleY * factorY;

    if (this.clampScaleX) {
      newScaleX = this.clampScaleX(newScaleX, 0);
    }

    const effectiveFactor = newScaleX / oldScaleX;

    this.state.scaleX = newScaleX;
    this.state.scaleY = newScaleY;

    this.state.offsetX = (screenX + oldOffsetX) * effectiveFactor - screenX;
    this.state.offsetY = dataY - (this.height / 2 - screenY) / this.state.scaleY;

    this.notifyChange();
  }

  zoomX(screenX: number, factor: number): void {
    const oldOffsetX = this.state.offsetX;
    const oldScaleX = this.state.scaleX;

    let newScaleX = oldScaleX * factor;
    if (this.clampScaleX) {
      newScaleX = this.clampScaleX(newScaleX, 0);
    }

    const effectiveFactor = newScaleX / oldScaleX;

    this.state.scaleX = newScaleX;
    this.state.offsetX = (screenX + oldOffsetX) * effectiveFactor - screenX;

    this.notifyChange();
  }

  zoomY(screenY: number, factor: number): void {
    const dataY = this.screenToDataY(screenY);

    this.state.scaleY *= factor;
    this.state.offsetY = dataY - (this.height / 2 - screenY) / this.state.scaleY;

    this.notifyChange();
  }

  autoFit(minPrice: number, maxPrice: number, dataLength: number, candleWidth: number): void {
    const priceRange = maxPrice - minPrice;
    const padding = priceRange * 0.1;

    this.state.scaleY = (this.height - 100) / (priceRange + padding);
    this.state.offsetY = (minPrice + maxPrice) / 2;

    this.state.scaleX = (this.width - 80) / (dataLength * candleWidth);
    this.state.offsetX = 0;

    this.notifyChange();
  }

  shiftOffsetX(pixels: number): void {
    this.state.offsetX += pixels;
    this.notifyChange();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  private screenToDataY(screenY: number): number {
    return this.state.offsetY + (this.height / 2 - screenY) / this.state.scaleY;
  }

  private notifyChange(): void {
    this.onChange?.(this.getState());
  }
}
