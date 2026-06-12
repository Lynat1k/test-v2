import type { ViewportState } from './types';

export class Viewport {
  private state: ViewportState;
  private width: number;
  private height: number;
  private onChange?: (state: ViewportState) => void;

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

  // Pan by screen pixels
  pan(dx: number, dy: number): void {
    this.state.offsetX -= dx / this.state.scaleX;
    this.state.offsetY += dy / this.state.scaleY;
    this.notifyChange();
  }

  // Zoom toward screen point
  zoomAt(screenX: number, screenY: number, factorX: number, factorY: number): void {
    // Convert screen point to data space
    const dataX = screenX / this.state.scaleX + this.state.offsetX;
    const dataY = this.state.offsetY + (this.height / 2 - screenY) / this.state.scaleY;

    // Apply zoom
    this.state.scaleX *= factorX;
    this.state.scaleY *= factorY;

    // Adjust offset to keep data point under cursor
    this.state.offsetX = dataX - screenX / this.state.scaleX;
    this.state.offsetY = this.state.offsetY + (this.height / 2 - screenY) / this.state.scaleY - dataY;

    this.notifyChange();
  }

  // Zoom X axis only (CTRL + wheel)
  zoomX(screenX: number, factor: number): void {
    const dataX = screenX / this.state.scaleX + this.state.offsetX;
    this.state.scaleX *= factor;
    this.state.offsetX = dataX - screenX / this.state.scaleX;
    this.notifyChange();
  }

  // Zoom Y axis only (SHIFT + wheel)
  zoomY(screenY: number, factor: number): void {
    const dataY = this.state.offsetY + (this.height / 2 - screenY) / this.state.scaleY;
    this.state.scaleY *= factor;
    this.state.offsetY = dataY - (this.height / 2 - screenY) / this.state.scaleY;
    this.notifyChange();
  }

  // Auto-fit data range
  autoFit(minPrice: number, maxPrice: number, dataLength: number, candleWidth: number): void {
    const priceRange = maxPrice - minPrice;
    const padding = priceRange * 0.1;

    this.state.scaleY = (this.height - 100) / (priceRange + padding);
    this.state.offsetY = (minPrice + maxPrice) / 2;

    this.state.scaleX = (this.width - 80) / (dataLength * candleWidth);
    this.state.offsetX = 0;

    this.notifyChange();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  private notifyChange(): void {
    this.onChange?.(this.getState());
  }
}
