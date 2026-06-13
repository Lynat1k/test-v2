import type { Candle, ClusterCandle, ClusterLevel } from './types';

export class DataStore {
  private candles: Candle[] = [];
  private clusterMap: Map<number, ClusterLevel[]> = new Map();
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
      const existingLevels = (last as ClusterCandle).levels;
      Object.assign(last, candle);
      if (existingLevels) {
        (last as ClusterCandle).levels = existingLevels;
      }
    } else {
      this.candles.push(candle);
    }
    this.onUpdate?.();
  }

  setClusterData(timestamp: number, levels: ClusterLevel[]): void {
    this.clusterMap.set(timestamp, levels);
    const candle = this.candles.find(c => c.timestamp === timestamp);
    if (candle) {
      (candle as ClusterCandle).levels = levels;
    }
  }

  setClusterDataBatch(data: Map<number, ClusterLevel[]>): void {
    for (const [timestamp, levels] of data) {
      this.clusterMap.set(timestamp, levels);
      const candle = this.candles.find(c => c.timestamp === timestamp);
      if (candle) {
        (candle as ClusterCandle).levels = levels;
      }
    }
  }

  getCandles(): readonly Candle[] {
    return this.candles;
  }

  getVisibleCandles(startIndex: number, endIndex: number): readonly Candle[] {
    return this.candles.slice(startIndex, endIndex + 1);
  }

  getClusterLevels(timestamp: number): ClusterLevel[] | undefined {
    return this.clusterMap.get(timestamp);
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

  static compressLevels(levels: ClusterLevel[], factor: number): ClusterLevel[] {
    if (factor <= 1 || levels.length === 0) return levels;
    const result: ClusterLevel[] = [];
    for (let i = 0; i < levels.length; i += factor) {
      let bidSum = 0;
      let askSum = 0;
      for (let k = i; k < Math.min(i + factor, levels.length); k++) {
        const lv = levels[k]!;
        bidSum += lv.bidVolume;
        askSum += lv.askVolume;
      }
      result.push({
        priceLevel: levels[i]!.priceLevel,
        bidVolume: bidSum,
        askVolume: askSum,
      });
    }
    return result;
  }
}
