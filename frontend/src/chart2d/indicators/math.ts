/**
 * Pure-TS numeric helpers for composite oscillator indicators (Buy/Sell Zone).
 *
 * The project had no EMA/SMA/STDEV/z-score utilities, so they live here. Every
 * helper is null-aware: series may contain `null` for candles where a source is
 * missing (e.g. no long/short point for that bar). Functions return `null` for
 * indices that lack enough valid history instead of throwing — the caller breaks
 * the drawn line on `null`.
 */

/** Population mean of a plain number array (no null handling). */
function meanOf(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation of a plain number array. */
function stdevOf(xs: number[]): number {
  const m = meanOf(xs);
  let acc = 0;
  for (const x of xs) {
    const d = x - m;
    acc += d * d;
  }
  return Math.sqrt(acc / xs.length);
}

/**
 * Collect the `len` most recent non-null values ending at index `i` (inclusive),
 * walking backwards over gaps. Returns them oldest→newest, or `null` if `i` is
 * out of range, `series[i]` is null, or fewer than `len` valid values exist.
 * This makes SMA/STDEV/z-score work on sparse series (e.g. long/short ratio).
 */
function trailingValid(series: ReadonlyArray<number | null>, len: number, i: number): number[] | null {
  if (i < 0 || i >= series.length) return null;
  if (series[i] == null) return null;
  const out: number[] = [];
  for (let k = i; k >= 0 && out.length < len; k--) {
    const v = series[k];
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  if (out.length < len) return null;
  out.reverse();
  return out;
}

/** Rolling simple moving average over a dense array. null until `len` samples. */
export function sma(arr: number[], len: number): (number | null)[] {
  const n = arr.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (len < 1) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += arr[i]!;
    if (i >= len) sum -= arr[i - len]!;
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

/** Rolling population standard deviation over a dense array. null until `len`. */
export function stdev(arr: number[], len: number): (number | null)[] {
  const n = arr.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (len < 1) return out;
  for (let i = len - 1; i < n; i++) {
    out[i] = stdevOf(arr.slice(i - len + 1, i + 1));
  }
  return out;
}

/**
 * Exponential moving average over a dense array. Seeded with the SMA of the
 * first `len` values (so out[len-1] is the seed), then `alpha = 2/(len+1)`
 * smoothing. null for indices < len-1.
 */
export function ema(arr: number[], len: number): (number | null)[] {
  const n = arr.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (len < 1 || n < len) return out;
  const alpha = 2 / (len + 1);
  let seed = 0;
  for (let i = 0; i < len; i++) seed += arr[i]!;
  let e = seed / len;
  out[len - 1] = e;
  for (let i = len; i < n; i++) {
    e = alpha * arr[i]! + (1 - alpha) * e;
    out[i] = e;
  }
  return out;
}

/**
 * MACD histogram (12/26/9): hist = MACD − signal, where MACD = EMA12 − EMA26 and
 * signal = EMA9 of the MACD line. Returns null for warmup indices. The MACD line
 * is contiguous once EMA26 is available, so the signal EMA is taken over that
 * non-null tail.
 */
export function macdHist(closes: number[]): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macd: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (e12[i] != null && e26[i] != null) macd[i] = (e12[i] as number) - (e26[i] as number);
  }
  const firstValid = macd.findIndex((v) => v != null);
  if (firstValid < 0) return out;
  const tail: number[] = [];
  for (let i = firstValid; i < n; i++) tail.push(macd[i] as number);
  const sig = ema(tail, 9);
  for (let k = 0; k < tail.length; k++) {
    if (sig[k] != null) out[firstValid + k] = tail[k]! - (sig[k] as number);
  }
  return out;
}

/**
 * z-score of `series[i]` over its trailing `len`-window, scaled to 0..100:
 *   m = SMA(window); sd = STDEV(window); z = (src − m)/sd;
 *   zc = clamp(z/3, −1, 1); result = 50·(1 + zc)
 * Returns null when there is not enough valid history, src is null, or sd == 0.
 * Sparse-aware: the window is the `len` most recent non-null values up to `i`.
 */
export function zToScale(series: ReadonlyArray<number | null>, len: number, i: number): number | null {
  const cur = series[i];
  if (cur == null || !Number.isFinite(cur)) return null;
  const w = trailingValid(series, len, i);
  if (!w) return null;
  const m = meanOf(w);
  const sd = stdevOf(w);
  if (sd === 0 || !Number.isFinite(sd)) return null;
  const z = (cur - m) / sd;
  const zc = Math.max(-1, Math.min(1, z / 3));
  return 50 * (1 + zc);
}
