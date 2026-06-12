import { Viewport } from '../Viewport';

export class InteractionManager {
  private canvas: HTMLCanvasElement;
  private viewport: Viewport;
  private isDragging = false;
  private lastX = 0;
  private lastY = 0;
  private mouseX = -1;
  private mouseY = -1;
  private hovering = false;
  private onMouseMoveCallback?: (x: number, y: number) => void;

  private boundOnPointerDown: (e: PointerEvent) => void;
  private boundOnPointerMove: (e: PointerEvent) => void;
  private boundOnPointerUp: () => void;
  private boundOnPointerLeave: () => void;
  private boundOnWheel: (e: WheelEvent) => void;

  constructor(canvas: HTMLCanvasElement, viewport: Viewport) {
    this.canvas = canvas;
    this.viewport = viewport;

    this.boundOnPointerDown = this.onPointerDown.bind(this);
    this.boundOnPointerMove = this.onPointerMove.bind(this);
    this.boundOnPointerUp = this.onPointerUp.bind(this);
    this.boundOnPointerLeave = this.onPointerLeave.bind(this);
    this.boundOnWheel = this.onWheel.bind(this);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('pointerdown', this.boundOnPointerDown);
    this.canvas.addEventListener('pointermove', this.boundOnPointerMove);
    this.canvas.addEventListener('pointerup', this.boundOnPointerUp);
    this.canvas.addEventListener('pointerleave', this.boundOnPointerLeave);
    this.canvas.addEventListener('wheel', this.boundOnWheel, { passive: false });
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.style.cursor = 'grabbing';
  }

  private onPointerMove(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    this.hovering = true;

    this.onMouseMoveCallback?.(this.mouseX, this.mouseY);

    if (!this.isDragging) return;

    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;

    this.viewport.pan(dx, dy);

    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private onPointerUp(): void {
    this.isDragging = false;
    this.canvas.style.cursor = 'crosshair';
  }

  private onPointerLeave(): void {
    this.isDragging = false;
    this.hovering = false;
    this.mouseX = -1;
    this.mouseY = -1;
    this.canvas.style.cursor = 'crosshair';
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const factor = e.deltaY > 0 ? 0.9 : 1.1;

    if (e.ctrlKey) {
      this.viewport.zoomX(screenX, factor);
    } else if (e.shiftKey) {
      this.viewport.zoomY(screenY, factor);
    } else {
      this.viewport.zoomAt(screenX, screenY, factor, factor);
    }
  }

  onMouseMove(callback: (x: number, y: number) => void): void {
    this.onMouseMoveCallback = callback;
  }

  getMousePosition(): { x: number; y: number } {
    return { x: this.mouseX, y: this.mouseY };
  }

  isHovering(): boolean {
    return this.hovering;
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.boundOnPointerDown);
    this.canvas.removeEventListener('pointermove', this.boundOnPointerMove);
    this.canvas.removeEventListener('pointerup', this.boundOnPointerUp);
    this.canvas.removeEventListener('pointerleave', this.boundOnPointerLeave);
    this.canvas.removeEventListener('wheel', this.boundOnWheel);
  }
}
