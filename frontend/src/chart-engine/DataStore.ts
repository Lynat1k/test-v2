import type { Candle } from './types';

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

  setData(candles: Candle[]): void {
    this.candles = candles.sort((a, b) => a.timestamp - b.timestamp);
    this.onUpdate?.();
  }

  prependData(newCandles: Candle[]): void {
    const merged = [...newCandles, ...this.candles];
    this.candles = merged.sort((a, b) => a.timestamp - b.timestamp);
    this.onUpdate?.();
  }

  updateLast(candle: Candle): void {
    const last = this.candles[this.candles.length - 1];
    if (last && last.timestamp === candle.timestamp) {
      this.candles[this.candles.length - 1] = candle;
    } else {
      this.candles.push(candle);
    }
    this.onUpdate?.();
  }

  getCandles(): readonly Candle[] {
    return this.candles;
  }

  getVisibleCandles(startIndex: number, endIndex: number): readonly Candle[] {
    return this.candles.slice(startIndex, endIndex + 1);
  }

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

  checkHistoryNeeded(visibleStartIndex: number): void {
    if (visibleStartIndex < 100 && this.candles.length > 0) {
      const firstTimestamp = this.candles[0]!.timestamp;
      this.onNeedHistory?.(firstTimestamp);
    }
  }

  get length(): number {
    return this.candles.length;
  }
}
