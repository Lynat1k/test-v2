import type { ViewportState } from '../types';
import type { Scales } from '../Scales';

export class AxisRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private rightPadding: number = 60;
  private bottomPadding: number = 30;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  render(viewport: ViewportState, scales: Scales, minPrice: number, maxPrice: number): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawPriceAxis(viewport, scales, minPrice, maxPrice);
    this.drawTimeAxis(viewport, scales);
    this.drawGrid(viewport, scales, minPrice, maxPrice);
  }

  private drawPriceAxis(_viewport: ViewportState, scales: Scales, minPrice: number, maxPrice: number): void {
    const axisX = this.width - this.rightPadding + 10;
    const step = this.calculatePriceStep(maxPrice - minPrice);

    this.ctx.fillStyle = '#9ca3af';
    this.ctx.font = '11px monospace';
    this.ctx.textAlign = 'left';

    for (let price = Math.ceil(minPrice / step) * step; price <= maxPrice; price += step) {
      const y = scales.priceToScreen(price);
      if (y > 20 && y < this.height - this.bottomPadding) {
        this.ctx.fillText(this.formatPrice(price), axisX, y + 4);
      }
    }
  }

  private drawTimeAxis(viewport: ViewportState, scales: Scales): void {
    const axisY = this.height - this.bottomPadding + 15;

    this.ctx.fillStyle = '#9ca3af';
    this.ctx.font = '11px monospace';
    this.ctx.textAlign = 'center';

    const candleWidth = 8 * viewport.scaleX;
    const labelInterval = Math.max(1, Math.floor(100 / candleWidth));

    for (let i = 0; i < 1000; i += labelInterval) {
      const timestamp = Date.now() - (1000 - i) * 60000;
      const x = scales.timeToScreen(timestamp, Date.now() - 1000 * 60000);
      if (x > 0 && x < this.width - this.rightPadding) {
        const label = new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        this.ctx.fillText(label, x, axisY);
      }
    }
  }

  private drawGrid(_viewport: ViewportState, scales: Scales, minPrice: number, maxPrice: number): void {
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.lineWidth = 1;

    const step = this.calculatePriceStep(maxPrice - minPrice);

    for (let price = Math.ceil(minPrice / step) * step; price <= maxPrice; price += step) {
      const y = scales.priceToScreen(price);
      if (y > 0 && y < this.height - this.bottomPadding) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(this.width - this.rightPadding, y);
        this.ctx.stroke();
      }
    }
  }

  private calculatePriceStep(range: number): number {
    const idealSteps = 8;
    const rawStep = range / idealSteps;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;

    if (normalized < 1.5) return magnitude;
    if (normalized < 3.5) return 2 * magnitude;
    if (normalized < 7.5) return 5 * magnitude;
    return 10 * magnitude;
  }

  private formatPrice(price: number): string {
    if (price >= 1000) return price.toFixed(0);
    if (price >= 1) return price.toFixed(2);
    return price.toFixed(4);
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  destroy(): void {
    // Canvas is garbage collected
  }
}
