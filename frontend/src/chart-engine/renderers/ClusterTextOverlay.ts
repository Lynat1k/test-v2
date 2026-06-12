export class ClusterTextOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  drawText(text: string, x: number, y: number, color: string, align: 'left' | 'right' = 'left'): void {
    if (y < 0 || y > this.height || x < 0 || x > this.width) return;
    this.ctx.fillStyle = color;
    this.ctx.font = '11px monospace';
    this.ctx.textAlign = align;
    this.ctx.fillText(text, x, y + 10);
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
}
