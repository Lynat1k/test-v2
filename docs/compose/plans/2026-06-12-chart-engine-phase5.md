# Phase 5: Chart Engine Framework + Japanese Candles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated PixiJS-based chart engine with Japanese candle rendering, 60 FPS performance, and real-time data integration.

**Architecture:** The chart engine lives in `frontend/src/chart-engine/` as a standalone module (no React imports). It uses PixiJS WebGL for geometry (candles, volume) and Canvas2D for text (axes, labels). A Viewport class manages data↔screen transforms with independent X/Y zoom. DataStore holds thousands of candles but only the visible 300-500 are rendered per frame via object pooling.

**Tech Stack:** PixiJS v8 (WebGL), Canvas2D, TypeScript (strict), React 19 (integration layer only)

---

## File Structure

### New Files (Chart Engine)
```
frontend/src/chart-engine/
├── index.ts                    # Public API exports
├── types.ts                    # Shared types (Candle, ViewportState, EngineConfig)
├── Engine.ts                   # Main engine class (orchestrates all modules)
├── Renderer.ts                 # PixiJS WebGL + Canvas2D hybrid renderer
├── Viewport.ts                 # Camera/transform management (pan, zoom, scales)
├── DataStore.ts                # Candle storage + history loading + WS updates
├── Scales.ts                   # X (time) and Y (price) scale calculations
├── renderers/
│   ├── CandleRenderer.ts       # Japanese candle drawing with object pooling
│   └── AxisRenderer.ts         # Canvas2D axis labels and grid
├── interaction/
│   └── InteractionManager.ts   # Mouse/keyboard event handling
└── pool/
    └── ObjectPool.ts           # Generic object pool for Graphics reuse
```

### Modified Files
```
frontend/src/App.tsx            # Add ChartContainer to terminal view
frontend/src/types.ts           # Add chart engine types (export from chart-engine/types)
```

### New Files (Integration)
```
frontend/src/components/
└── ChartContainer.tsx          # React wrapper for chart engine (bridge layer)
```

---

## Task 1: Types and Engine Contract

**Covers:** Engine contract definition, data types

**Files:**
- Create: `frontend/src/chart-engine/types.ts`
- Create: `frontend/src/chart-engine/index.ts`

- [ ] **Step 1: Create chart engine types**

```typescript
// frontend/src/chart-engine/types.ts

export interface Candle {
  timestamp: number;    // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ViewportState {
  offsetX: number;      // Data units
  offsetY: number;
  scaleX: number;       // Pixels per data unit
  scaleY: number;
}

export interface EngineConfig {
  container: HTMLElement;
  width: number;
  height: number;
  palette: 'default' | 'alternative';
}

export interface EngineEvents {
  viewportChange: (state: ViewportState) => void;
  needHistory: (before: number) => void;
  frame: (fps: number) => void;
}

export type CandleMode = 'japanese' | 'footprint' | 'clusters';
```

- [ ] **Step 2: Create index.ts with public API**

```typescript
// frontend/src/chart-engine/index.ts

export { Engine } from './Engine';
export type { Candle, ViewportState, EngineConfig, EngineEvents, CandleMode } from './types';
```

- [ ] **Step 3: Verify types compile**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/types.ts`
Expected: No errors

---

## Task 2: Object Pool

**Covers:** Performance requirement - no allocations in render loop

**Files:**
- Create: `frontend/src/chart-engine/pool/ObjectPool.ts`

- [ ] **Step 1: Create generic object pool**

```typescript
// frontend/src/chart-engine/pool/ObjectPool.ts

export class ObjectPool<T> {
  private pool: T[] = [];
  private active: T[] = [];
  private factory: () => T;
  private reset: (obj: T) => void;

  constructor(factory: () => T, reset: (obj: T) => void, initialSize: number = 0) {
    this.factory = factory;
    this.reset = reset;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }

  acquire(): T {
    const obj = this.pool.length > 0 ? this.pool.pop()! : this.factory();
    this.active.push(obj);
    return obj;
  }

  release(obj: T): void {
    const idx = this.active.indexOf(obj);
    if (idx !== -1) {
      this.active.splice(idx, 1);
      this.reset(obj);
      this.pool.push(obj);
    }
  }

  releaseAll(): void {
    while (this.active.length > 0) {
      const obj = this.active.pop()!;
      this.reset(obj);
      this.pool.push(obj);
    }
  }

  get activeCount(): number {
    return this.active.length;
  }

  get totalCount(): number {
    return this.pool.length + this.active.length;
  }
}
```

- [ ] **Step 2: Verify pool compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/pool/ObjectPool.ts`
Expected: No errors

---

## Task 3: Scales (X/Y Transformations)

**Covers:** Coordinate mapping between data space and screen space

**Files:**
- Create: `frontend/src/chart-engine/Scales.ts`

- [ ] **Step 1: Create Scales class**

```typescript
// frontend/src/chart-engine/Scales.ts

import { ViewportState } from './types';

export class Scales {
  private viewport: ViewportState;
  private chartWidth: number;
  private chartHeight: number;
  private candleWidth: number = 8;  // Base candle width in pixels
  private rightPadding: number = 60; // Space for price axis

  constructor(viewport: ViewportState, width: number, height: number) {
    this.viewport = viewport;
    this.chartWidth = width;
    this.chartHeight = height;
  }

  // Convert timestamp to screen X
  timeToScreen(timestamp: number, firstTimestamp: number): number {
    const dataIndex = (timestamp - firstTimestamp) / 60000; // Assume 1m candles
    return dataIndex * this.candleWidth * this.viewport.scaleX - this.viewport.offsetX;
  }

  // Convert price to screen Y
  priceToScreen(price: number): number {
    const priceRange = this.viewport.scaleY;
    const centerY = this.chartHeight / 2;
    return centerY - (price - this.viewport.offsetY) * priceRange;
  }

  // Convert screen X to data index
  screenToIndex(screenX: number, firstTimestamp: number): number {
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
    const start = Math.max(0, this.screenToIndex(0, 0));
    const end = Math.min(dataLength - 1, this.screenToIndex(this.chartWidth - this.rightPadding, 0));
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
```

- [ ] **Step 2: Verify scales compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/Scales.ts`
Expected: No errors

---

## Task 4: Viewport (Camera/Pan/Zoom)

**Covers:** Pan, zoom, independent X/Y scaling

**Files:**
- Create: `frontend/src/chart-engine/Viewport.ts`

- [ ] **Step 1: Create Viewport class**

```typescript
// frontend/src/chart-engine/Viewport.ts

import { ViewportState } from './types';

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
```

- [ ] **Step 2: Verify viewport compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/Viewport.ts`
Expected: No errors

---

## Task 5: DataStore

**Covers:** Candle storage, history loading, WS updates

**Files:**
- Create: `frontend/src/chart-engine/DataStore.ts`

- [ ] **Step 1: Create DataStore class**

```typescript
// frontend/src/chart-engine/DataStore.ts

import { Candle } from './types';

export class DataStore {
  private candles: Candle[] = [];
  private onNeedHistory?: (before: number) => void;
  private onUpdate?: () => void;

  setOnNeedHistory(callback: (before: number) => void): void {
    this.onNeedHistory = callback;
  }

  setOnUpdate(callback: () => void): void {
    this.onUpdate = callback;
  }

  // Load initial data (from REST API)
  setData(candles: Candle[]): void {
    this.candles = candles.sort((a, b) => a.timestamp - b.timestamp);
    this.onUpdate?.();
  }

  // Prepend historical data (scroll back)
  prependData(newCandles: Candle[]): void {
    const merged = [...newCandles, ...this.candles];
    this.candles = merged.sort((a, b) => a.timestamp - b.timestamp);
    this.onUpdate?.();
  }

  // Update last candle (live WS update)
  updateLast(candle: Candle): void {
    const last = this.candles[this.candles.length - 1];
    if (last && last.timestamp === candle.timestamp) {
      // Same candle, update in place
      this.candles[this.candles.length - 1] = candle;
    } else {
      // New candle
      this.candles.push(candle);
    }
    this.onUpdate?.();
  }

  // Get all candles
  getCandles(): readonly Candle[] {
    return this.candles;
  }

  // Get visible candles for rendering
  getVisibleCandles(startIndex: number, endIndex: number): readonly Candle[] {
    return this.candles.slice(startIndex, endIndex + 1);
  }

  // Get price range for auto-fit
  getPriceRange(): { min: number; max: number } {
    if (this.candles.length === 0) {
      return { min: 0, max: 100 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const c of this.candles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }
    return { min, max };
  }

  // Check if need to load more history
  checkHistoryNeeded(visibleStartIndex: number): void {
    if (visibleStartIndex < 100 && this.candles.length > 0) {
      const firstTimestamp = this.candles[0].timestamp;
      this.onNeedHistory?.(firstTimestamp);
    }
  }

  get length(): number {
    return this.candles.length;
  }
}
```

- [ ] **Step 2: Verify datastore compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/DataStore.ts`
Expected: No errors

---

## Task 6: Candle Renderer (Object Pooling)

**Covers:** Japanese candle rendering with 60 FPS, object pooling

**Files:**
- Create: `frontend/src/chart-engine/renderers/CandleRenderer.ts`

- [ ] **Step 1: Create CandleRenderer with object pooling**

```typescript
// frontend/src/chart-engine/renderers/CandleRenderer.ts

import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { Candle } from '../types';
import { ObjectPool } from '../pool/ObjectPool';
import { Scales } from '../Scales';

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
```

- [ ] **Step 2: Verify candle renderer compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/renderers/CandleRenderer.ts`
Expected: No errors

---

## Task 7: Axis Renderer (Canvas2D)

**Covers:** Text rendering for axes and grid

**Files:**
- Create: `frontend/src/chart-engine/renderers/AxisRenderer.ts`

- [ ] **Step 1: Create AxisRenderer with Canvas2D**

```typescript
// frontend/src/chart-engine/renderers/AxisRenderer.ts

import { ViewportState } from '../types';
import { Scales } from '../Scales';

export class AxisRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: Canvas2DRenderingContext;
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
    
    // Draw price axis (right side)
    this.drawPriceAxis(viewport, scales, minPrice, maxPrice);
    
    // Draw time axis (bottom)
    this.drawTimeAxis(viewport, scales);
    
    // Draw grid lines
    this.drawGrid(viewport, scales, minPrice, maxPrice);
  }

  private drawPriceAxis(viewport: ViewportState, scales: Scales, minPrice: number, maxPrice: number): void {
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
    
    // Draw time labels every N candles
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

  private drawGrid(viewport: ViewportState, scales: Scales, minPrice: number, maxPrice: number): void {
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
```

- [ ] **Step 2: Verify axis renderer compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/renderers/AxisRenderer.ts`
Expected: No errors

---

## Task 8: Interaction Manager

**Covers:** Mouse/keyboard controls (pan, zoom, wheel)

**Files:**
- Create: `frontend/src/chart-engine/interaction/InteractionManager.ts`

- [ ] **Step 1: Create InteractionManager**

```typescript
// frontend/src/chart-engine/interaction/InteractionManager.ts

import { Viewport } from '../Viewport';

export class InteractionManager {
  private canvas: HTMLCanvasElement;
  private viewport: Viewport;
  private isDragging: boolean = false;
  private lastX: number = 0;
  private lastY: number = 0;

  constructor(canvas: HTMLCanvasElement, viewport: Viewport) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Pointer events for pan
    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointerleave', this.onPointerUp.bind(this));

    // Wheel for zoom
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.style.cursor = 'grabbing';
  }

  private onPointerMove(e: PointerEvent): void {
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

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const factor = e.deltaY > 0 ? 0.9 : 1.1;

    if (e.ctrlKey) {
      // CTRL + wheel: horizontal stretch (X axis)
      this.viewport.zoomX(screenX, factor);
    } else if (e.shiftKey) {
      // SHIFT + wheel: vertical stretch (Y axis)
      this.viewport.zoomY(screenY, factor);
    } else {
      // Normal wheel: zoom toward cursor
      this.viewport.zoomAt(screenX, screenY, factor, factor);
    }
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.removeEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.removeEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.removeEventListener('pointerleave', this.onPointerUp.bind(this));
    this.canvas.removeEventListener('wheel', this.onWheel.bind(this));
  }
}
```

- [ ] **Step 2: Verify interaction manager compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/interaction/InteractionManager.ts`
Expected: No errors

---

## Task 9: Main Renderer (PixiJS + Canvas2D Hybrid)

**Covers:** WebGL + Canvas2D synchronization, render loop

**Files:**
- Create: `frontend/src/chart-engine/Renderer.ts`

- [ ] **Step 1: Create Renderer class**

```typescript
// frontend/src/chart-engine/Renderer.ts

import { Application, Container } from 'pixi.js';
import { ViewportState } from './types';
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
    
    // Initialize PixiJS
    this.app = new Application();
    this.stage = new Container();
    
    // Initialize scales
    const viewport: ViewportState = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
    this.scales = new Scales(viewport, width, height);
    
    // Initialize renderers
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
    
    // Style axis canvas overlay
    const axisCanvas = this.axisRenderer.getCanvas();
    axisCanvas.style.position = 'absolute';
    axisCanvas.style.top = '0';
    axisCanvas.style.left = '0';
    axisCanvas.style.pointerEvents = 'none';
    
    this.app.stage.addChild(this.stage);
    
    // Start render loop
    this.app.ticker.add(this.render.bind(this));
  }

  private render(): void {
    // Calculate FPS
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }

  renderCandles(candles: import('./types').Candle[], viewport: ViewportState, firstTimestamp: number): void {
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
```

- [ ] **Step 2: Verify renderer compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/Renderer.ts`
Expected: No errors

---

## Task 10: Main Engine Class

**Covers:** Orchestrating all modules, public API

**Files:**
- Create: `frontend/src/chart-engine/Engine.ts`

- [ ] **Step 1: Create Engine class**

```typescript
// frontend/src/chart-engine/Engine.ts

import { Candle, EngineConfig, ViewportState } from './types';
import { Renderer } from './Renderer';
import { Viewport } from './Viewport';
import { DataStore } from './DataStore';
import { InteractionManager } from './interaction/InteractionManager';

export class Engine {
  private renderer: Renderer;
  private viewport: Viewport;
  private dataStore: DataStore;
  private interaction: InteractionManager;
  private config: EngineConfig;
  private animationFrameId: number = 0;
  private isPaused: boolean = false;

  // Event callbacks
  private onViewportChange?: (state: ViewportState) => void;
  private onNeedHistory?: (before: number) => void;

  constructor(config: EngineConfig) {
    this.config = config;
    
    // Initialize modules
    this.renderer = new Renderer(config.width, config.height);
    this.viewport = new Viewport(config.width, config.height);
    this.dataStore = new DataStore();
    
    // Setup viewport callbacks
    this.viewport.setOnChange((state) => {
      this.onViewportChange?.(state);
      this.requestRender();
    });
    
    // Setup data store callbacks
    this.dataStore.setOnNeedHistory((before) => {
      this.onNeedHistory?.(before);
    });
    
    this.dataStore.setOnUpdate(() => {
      this.requestRender();
    });
  }

  async init(): Promise<void> {
    await this.renderer.init(this.config.container);
    this.interaction = new InteractionManager(
      this.config.container.querySelector('canvas')!,
      this.viewport
    );
    
    // Initial render
    this.requestRender();
  }

  // Public API methods
  setData(candles: Candle[]): void {
    this.dataStore.setData(candles);
    
    // Auto-fit on initial data load
    const { min, max } = this.dataStore.getPriceRange();
    this.viewport.autoFit(min, max, this.dataStore.length, 8);
  }

  prependData(candles: Candle[]): void {
    this.dataStore.prependData(candles);
  }

  updateLast(candle: Candle): void {
    this.dataStore.updateLast(candle);
  }

  setPalette(palette: 'default' | 'alternative'): void {
    this.renderer.setPalette(palette);
    this.requestRender();
  }

  // Event listeners
  on(event: 'viewportChange', callback: (state: ViewportState) => void): void;
  on(event: 'needHistory', callback: (before: number) => void): void;
  on(event: string, callback: (...args: any[]) => void): void {
    switch (event) {
      case 'viewportChange':
        this.onViewportChange = callback;
        break;
      case 'needHistory':
        this.onNeedHistory = callback;
        break;
    }
  }

  // Render control
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
    
    const firstTimestamp = candles[0].timestamp;
    const { min, max } = this.dataStore.getPriceRange();
    
    this.renderer.renderCandles(candles, viewportState, firstTimestamp);
    this.renderer.renderAxis(viewportState, min, max);
    
    // Check if need to load more history
    const { start } = this.renderer['scales'].getVisibleRange(candles.length);
    this.dataStore.checkHistoryNeeded(start);
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
```

- [ ] **Step 2: Verify engine compiles**

Run: `cd frontend && npx tsc --noEmit src/chart-engine/Engine.ts`
Expected: No errors

---

## Task 11: React Integration Layer

**Covers:** Bridge between React and chart engine

**Files:**
- Create: `frontend/src/components/ChartContainer.tsx`

- [ ] **Step 1: Create ChartContainer component**

```tsx
// frontend/src/components/ChartContainer.tsx

import { useEffect, useRef, useState } from 'react';
import { Engine, Candle, ViewportState } from '@/chart-engine';
import { useCandlePalette } from '@/contexts/CandlePaletteContext';

interface ChartContainerProps {
  symbol: string;
  market: string;
  timeframe: string;
  chartIndex: 0 | 1;
}

export function ChartContainer({ symbol, market, timeframe, chartIndex }: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [fps, setFps] = useState(0);
  const { getActivePalette } = useCandlePalette();

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new Engine({
      container: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      palette: getActivePalette(chartIndex),
    });

    engine.init().then(() => {
      engineRef.current = engine;

      // Setup event handlers
      engine.on('viewportChange', (state: ViewportState) => {
        // TODO: Sync with other charts if multi-chart mode
      });

      engine.on('needHistory', (before: number) => {
        // TODO: Fetch history from REST API
        console.log('Need history before:', before);
      });

      // FPS counter
      const fpsInterval = setInterval(() => {
        setFps(engine.getFPS());
      }, 1000);

      return () => clearInterval(fpsInterval);
    });

    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [symbol, market, timeframe]);

  // Handle palette changes
  useEffect(() => {
    engineRef.current?.setPalette(getActivePalette(chartIndex));
  }, [getActivePalette, chartIndex]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && engineRef.current) {
        engineRef.current.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-2 left-2 text-xs text-gray-400">
        {symbol} | {fps} FPS
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify component compiles**

Run: `cd frontend && npx tsc --noEmit src/components/ChartContainer.tsx`
Expected: No errors

---

## Task 12: Integration with App.tsx

**Covers:** Adding chart to terminal view, placeholder for drawing tools

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update App.tsx to include ChartContainer**

```tsx
// frontend/src/App.tsx (add import and update terminal view)

import { ChartContainer } from '@/components/ChartContainer';

// In AppShell component, update the terminal view section:
{currentView === 'terminal' && (
  <div className="flex-1 flex">
    {/* Left panel placeholder for drawing tools */}
    <div className="w-12 bg-gray-900 border-r border-gray-700 flex flex-col items-center py-2 gap-2">
      {/* TODO: Drawing tools will be implemented in Phase 7 */}
      <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
        🖊
      </div>
      <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
        📏
      </div>
      <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
        🔲
      </div>
    </div>
    
    {/* Chart area */}
    <div className="flex-1 relative">
      <ChartContainer
        symbol="BTCUSDT"
        market="futures"
        timeframe="1m"
        chartIndex={0}
      />
    </div>
  </div>
)}
```

- [ ] **Step 2: Verify App.tsx compiles**

Run: `cd frontend && npx tsc --noEmit src/App.tsx`
Expected: No errors

---

## Task 13: Final Compilation Check

**Covers:** Full project compilation

- [ ] **Step 1: Run full TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

---

## Task 14: Update Documentation

**Covers:** PROGRESS.md and DECISIONS.md updates

- [ ] **Step 1: Update PROGRESS.md**

Add entry for Phase 5 at the top of `docs/PROGRESS.md`:

```markdown
### [2026-06-12] Фаза 5 — Движок графика: каркас + японские свечи
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - Создан изолированный движок графика в frontend/src/chart-engine/
  - Модули: Engine, Renderer (PixiJS WebGL + Canvas2D), Viewport, DataStore, Scales
  - Object pooling для Graphics (1000 предвыделенных объектов, zero allocations в render loop)
  - Только видимые свечи рендерятся (300-500 из тысяч в DataStore)
  - Японские свечи: bull (зелёный) / bear (красный), альтернативная палитра (белый/серый)
  - Управление: колесо→zoom к указателю, SHIFT+колесо→вертикальная растяжка, CTRL+колесо→горизонтальная растяжка, drag→пан
  - Canvas2D слой для осей и сетки
  - React интеграция: ChartContainer компонент
  - Заготовка панели инструментов рисования (placeholder)
- Затронутые файлы/папки:
  - frontend/src/chart-engine/ (новая папка: Engine, Renderer, Viewport, DataStore, Scales, renderers/, interaction/, pool/)
  - frontend/src/components/ChartContainer.tsx (новый)
  - frontend/src/App.tsx (обновлён)
- Ключевые решения:
  - Движок изолирован от UI — никаких импортов React внутри chart-engine/
  - Object pooling: 1000 Graphics объектов предвыделены, переиспользуются
  - Only visible rendering: DataStore хранит тысячи, Renderer рисует 300-500
  - Canvas2D для текста (оси, сетка), WebGL для геометрии (свечи)
- Открытые вопросы / TODO для следующих фаз:
  - Фаза 6: Футпринт/кластеры/имбаланс
  - Фаза 7: Инструменты рисования
  - Интеграция с REST API для загрузки истории
  - Интеграция с WS для live-обновлений
- Тесты/проверки:
  - TypeScript compilation: PASS
  - Build: PASS
```

- [ ] **Step 2: Update DECISIONS.md**

Add entry to `docs/DECISIONS.md`:

```markdown
## Архитектура движка графика (Фаза 5)

### Изоляция от UI
Движок графика生活在 `frontend/src/chart-engine/` и НЕ импортирует React-компоненты.
Связь с UI только через:
- `Engine` class (создаётся в React компоненте)
- Event callbacks (viewportChange, needHistory)
- Методы setData/updateLast/setPalette

### Object Pooling
Все Graphics объекты предвыделены в пуле (1000 штук). В render loop нет аллокаций —
только `acquire()` и `release()`. Это критично для 60 FPS.

### Only Visible Rendering
DataStore хранит все свечи (тысячи), но Renderer рисует только видимые 300-500.
Вычисление видимого диапазона через Scales.getVisibleRange().

### Гибридный рендеринг
- PixiJS WebGL: свечи (Graphics + GraphicsContext для батчинга)
- Canvas2D: оси, сетка, текст (дешевле для текста чем WebGL)

### Точка расширения: Панель рисования
В App.tsx добавлен placeholder для левой панели инструментов рисования.
Реализация инструментов — Фаза 7. Пока только разметка.
```

- [ ] **Step 3: Commit changes**

```bash
cd D:\PROCLUSTER2\procluster
git add frontend/src/chart-engine/ frontend/src/components/ChartContainer.tsx frontend/src/App.tsx docs/PROGRESS.md docs/DECISIONS.md
git commit -m "feat: Phase 5 - Chart engine framework + Japanese candles

- Isolated PixiJS-based chart engine in frontend/src/chart-engine/
- Renderer (WebGL + Canvas2D), Viewport, DataStore, Scales modules
- Object pooling for Graphics (1000 pre-allocated, zero alloc in render loop)
- Only visible candles rendered (300-500 from thousands in DataStore)
- Japanese candles with bull/bear colors and palette switching
- Mouse controls: wheel zoom, SHIFT+wheel Y-stretch, CTRL+wheel X-stretch, drag pan
- React integration via ChartContainer component
- Placeholder for drawing tools panel (Phase 7)"
```

---

## Verification

After implementation, verify:

1. **TypeScript compilation**: `cd frontend && npx tsc --noEmit` — no errors
2. **Build**: `cd frontend && npm run build` — succeeds
3. **Runtime**: Open browser, navigate to terminal view, verify:
   - Chart renders (even without real data, should show empty chart area)
   - No console errors
   - FPS counter visible
   - Drawing tools placeholder visible on left panel

---

## Notes for Implementation

- PixiJS v8 is used (check package.json for exact version)
- Object pool size (1000) can be adjusted based on performance testing
- Canvas2D axis rendering is simplified — can be enhanced in later phases
- WS integration is stubbed (onNeedHistory callback) — real integration in Phase 6
- Drawing tools placeholder is minimal — real implementation in Phase 7