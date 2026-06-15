import type { Candle, ClusterCandle, ClusterLevel } from './types';

export class DataStore {
  private candles: Candle[] = [];
  private clusterMap: Map<number, ClusterLevel[]> = new Map();
  private onNeedHistory?: (before: number) => void;
  private onUpdate?: () => void;
  private allHistoryLoaded: boolean = false;
  private historyLoading: boolean = false;

  setOnNeedHistory(callback: (before: number) => void): void {
    this.onNeedHistory = callback;
  }

  setOnUpdate(callback: () => void): void {
    this.onUpdate = callback;
  }

  setAllHistoryLoaded(v: boolean): void {
    this.allHistoryLoaded = v;
  }

  setHistoryLoading(v: boolean): void {
    this.historyLoading = v;
  }

  isHistoryAllLoaded(): boolean {
    return this.allHistoryLoaded;
  }

  isHistoryLoading(): boolean {
    return this.historyLoading;
  }

  setData(candles: Candle[]): void {
    this.candles = candles.sort((a, b) => a.timestamp - b.timestamp);
    this.allHistoryLoaded = false;
    this.onUpdate?.();
  }

  prependData(newCandles: Candle[]): void {
    const prevFirstTs = this.candles.length > 0 ? this.candles[0]!.timestamp : Infinity;

    // Filter out candles already in buffer (same or newer timestamp than current first)
    const filtered = prevFirstTs === Infinity
      ? newCandles
      : newCandles.filter(c => c.timestamp < prevFirstTs);

    if (filtered.length === 0) {
      // No genuinely older data — history exhausted
      this.allHistoryLoaded = true;
      this.onUpdate?.();
      return;
    }

    const merged = [...filtered, ...this.candles];
    this.candles = merged.sort((a, b) => a.timestamp - b.timestamp);

    // Double-check firstTimestamp actually decreased
    const newFirstTs = this.candles[0]!.timestamp;
    if (newFirstTs >= prevFirstTs) {
      this.allHistoryLoaded = true;
    }

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
    if (this.allHistoryLoaded || this.historyLoading) return;
    if (visibleStartIndex < 100 && this.candles.length > 0) {
      // before = oldest ts - 1ms for strict exclusion
      const before = this.candles[0]!.timestamp - 1;
      this.onNeedHistory?.(before);
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
