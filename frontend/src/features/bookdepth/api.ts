/**
 * HTTP client for GET /api/v1/bookdepth-ratio (Bid & Ask Ratio indicator data).
 *
 * NOTE: unlike the {ok,data} endpoints behind features/auth `request()`, this
 * route returns a BARE JSON array, so we fetch directly. Auth is optional
 * (beta-gated server-side) — the Bearer token is attached when available, same
 * as hooks/useDOM.ts.
 */

const BASE = "/api/v1";

export interface BookDepthRatioPoint {
  t: number; // candle_open, unix ms
  r1: number;
  r3: number;
  r5: number;
}

/**
 * Fetch the bid/ask depth ratio series for [from, to] (unix ms), bucketed by
 * `timeframe` on the server. futures-only. Returns [] on any error so the
 * caller (ClusterChart) never throws into the render loop.
 */
export async function fetchBookDepthRatio(
  symbol: string,
  market: string,
  timeframe: string,
  from: number,
  to: number,
  accessToken?: string | null,
): Promise<BookDepthRatioPoint[]> {
  const qs = new URLSearchParams({
    symbol,
    market,
    timeframe,
    from: String(Math.floor(from)),
    to: String(Math.floor(to)),
  }).toString();

  const res = await fetch(`${BASE}/bookdepth-ratio?${qs}`, {
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) {
    throw new Error(`bookdepth-ratio HTTP ${res.status}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const out: BookDepthRatioPoint[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const t = rec["t"];
    if (typeof t !== "number") continue;
    out.push({
      t,
      r1: typeof rec["r1"] === "number" ? (rec["r1"] as number) : 0,
      r3: typeof rec["r3"] === "number" ? (rec["r3"] as number) : 0,
      r5: typeof rec["r5"] === "number" ? (rec["r5"] as number) : 0,
    });
  }
  return out;
}
