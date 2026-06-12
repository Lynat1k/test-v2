import type { ViewportState } from './types';

export class Scales {
  private viewport: ViewportState;
  private chartWidth: number;
  private chartHeight: number;
  private candleWidth: number = 8;
  private rightPadding: number = 60;

  constructor(viewport: ViewportState, width: number, height: number) {
    this.viewport = viewport;
    this.chartWidth = width;
    this.chartHeight = height;
  }

  // Convert timestamp to screen X
  timeToScreen(timestamp: number, firstTimestamp: number): number {
    const dataIndex = (timestamp - firstTimestamp) / 60000;
    return dataIndex * this.candleWidth * this.viewport.scaleX - this.viewport.offsetX;
  }

  // Convert price to screen Y
  priceToScreen(price: number): number {
    const priceRange = this.viewport.scaleY;
    const centerY = this.chartHeight / 2;
    return centerY - (price - this.viewport.offsetY) * priceRange;
  }

  // Convert screen X to data index
  screenToIndex(screenX: number): number {
    const dataIndex = (screenX + this.viewport.offsetX) / (this.candleWidth * this.viewport.scaleX);
    return Math.floor(dataIndex);
  }

  // Convert screen Y to price
  screenToPrice(screenY: number): number {
    const centerY = this.chartHeight / 2;
    return this.viewport.offsetY + (centerY - screenY) / this.viewport.scaleY;
  }

  // Get visible index range
  getVisibleRange(dataLength: number): { start: number; end: number } {
    const start = Math.max(0, this.screenToIndex(0));
    const end = Math.min(dataLength - 1, this.screenToIndex(this.chartWidth - this.rightPadding));
    return { start, end };
  }

  updateViewport(viewport: ViewportState): void {
    this.viewport = viewport;
  }

  updateSize(width: number, height: number): void {
    this.chartWidth = width;
    this.chartHeight = height;
  }
}
