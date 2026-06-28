/**
 * HTTP client for GET /api/v1/long-short-ratio (Long/Short Account Ratio data).
 *
 * Mirrors features/bookdepth/api.ts: the route returns a BARE JSON array, so we
 * fetch directly (not via the {ok,data} `request()` helper). Auth is optional
 * (beta-gated server-side) — the Bearer token is attached when available.
 * futures-only on the backend.
 */

const BASE = "/api/v1";

export interface LongShortRatioPoint {
  t: number; // candle_open, unix ms
  ratio: number; // global account long/short ratio (~0.5–5)
}

/**
 * Fetch the global long/short account ratio series for [from, to] (unix ms),
 * bucketed by `timeframe` on the server. futures-only. Returns [] on any error
 * so the caller (ClusterChart) never throws into the render loop.
 */
export async function fetchLongShortRatio(
  symbol: string,
  market: string,
  timeframe: string,
  from: number,
  to: number,
  accessToken?: string | null,
): Promise<LongShortRatioPoint[]> {
  const qs = new URLSearchParams({
    symbol,
    market,
    timeframe,
    from: String(Math.floor(from)),
    to: String(Math.floor(to)),
  }).toString();

  const res = await fetch(`${BASE}/long-short-ratio?${qs}`, {
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) {
    throw new Error(`long-short-ratio HTTP ${res.status}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const out: LongShortRatioPoint[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const t = rec["t"];
    const ratio = rec["ratio"];
    if (typeof t !== "number" || typeof ratio !== "number") continue;
    out.push({ t, ratio });
  }
  return out;
}
