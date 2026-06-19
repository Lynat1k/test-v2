import { useEffect, useRef } from "react";
import type { ClusterCandle } from "./types";
import { apiRowsToCells, computeValueArea } from "./adapter";
import type { ApiClusterRow } from "./adapter";

export type LiveChartState =
  | { status: "connecting" }
  | { status: "active" }
  | { status: "rejected"; reason: string }
  | { status: "evicted"; reason: string }
  | { status: "disconnected" };

interface UseLiveChartOptions {
  symbol: string;
  market: string;
  timeframe: string;
  accessToken: string | null | undefined;
  enabled: boolean;
  onCandleUpdate: (candle: ClusterCandle) => void;
  onStateChange: (state: LiveChartState) => void;
}

export function useLiveChart({
  symbol,
  market,
  timeframe,
  accessToken,
  enabled,
  onCandleUpdate,
  onStateChange,
}: UseLiveChartOptions) {
  const onCandleUpdateRef = useRef(onCandleUpdate);
  const onStateChangeRef = useRef(onStateChange);
  onCandleUpdateRef.current = onCandleUpdate;
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    if (!enabled) {
      onStateChangeRef.current?.({ status: "disconnected" });
      return;
    }

    const state: {
      mounted: boolean;
      ws: WebSocket | null;
      heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    } = { mounted: true, ws: null, heartbeatTimer: undefined, reconnectTimer: undefined };

    function cleanup() {
      if (state.heartbeatTimer !== undefined) {
        clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = undefined;
      }
      if (state.reconnectTimer !== undefined) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = undefined;
      }
      if (state.ws) {
        try {
          if (state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: "chart_unsubscribe" }));
          }
        } catch {}
        state.ws.close();
        state.ws = null;
      }
    }

    function connect() {
      cleanup();
      if (!state.mounted) return;

      onStateChangeRef.current?.({ status: "connecting" });

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const tokenParam = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";
      const wsUrl = `${wsProtocol}//${window.location.host}/ws${tokenParam}`;

      try {
        state.ws = new WebSocket(wsUrl);
      } catch {
        onStateChangeRef.current?.({ status: "disconnected" });
        state.reconnectTimer = setTimeout(() => {
          if (state.mounted) connect();
        }, 3000);
        return;
      }

      state.ws.onopen = () => {
        if (!state.mounted) {
          state.ws?.close();
          return;
        }
        state.ws!.send(
          JSON.stringify({ type: "chart_subscribe", symbol, market, timeframe })
        );

        state.heartbeatTimer = setInterval(() => {
          if (state.ws?.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: "heartbeat" }));
          }
        }, 8000);
      };

      state.ws.onmessage = (event) => {
        if (!state.mounted) return;
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "candle_update":
              if (msg.data) {
                onCandleUpdateRef.current(parseCandleUpdate(msg.data));
              }
              break;
            case "session_active":
              onStateChangeRef.current?.({ status: "active" });
              break;
            case "session_rejected":
              onStateChangeRef.current?.({
                status: "rejected",
                reason: msg.reason || "limit",
              });
              break;
            case "session_evicted":
              onStateChangeRef.current?.({
                status: "evicted",
                reason: msg.reason || "expired",
              });
              break;
          }
        } catch {}
      };

      state.ws.onclose = () => {
        cleanup();
        if (state.mounted) {
          onStateChangeRef.current?.({ status: "disconnected" });
          state.reconnectTimer = setTimeout(() => {
            if (state.mounted) connect();
          }, 3000);
        }
      };

      state.ws.onerror = () => {};
    }

    connect();

    return () => {
      state.mounted = false;
      cleanup();
    };
  }, [symbol, market, timeframe, accessToken, enabled]);
}

function parseCandleUpdate(data: any): ClusterCandle {
  const open = data.open;
  const close = data.close;

  const candle: ClusterCandle = {
    timestamp: data.candleOpen,
    open,
    high: data.high,
    low: data.low,
    close,
    volume: data.totalVolume,
    delta: 0,
    pocPrice: (open + close) / 2,
    cells: [],
    vah: data.high,
    val: data.low,
    ...(data.tradesCount > 0 ? { tickCount: data.tradesCount } : {}),
  };

  if (data.levels && Array.isArray(data.levels)) {
    const rows: ApiClusterRow[] = data.levels.map((l: any) => ({
      PriceLevel: l.priceLevel,
      BidVolume: l.bidVolume,
      AskVolume: l.askVolume,
    }));
    const cells = apiRowsToCells(rows);
    const pocCell = cells.find((c) => c.isPoc);
    const { vah, val } = computeValueArea(cells);
    const totalBid = cells.reduce((s, c) => s + c.bid, 0);
    const totalAsk = cells.reduce((s, c) => s + c.ask, 0);
    candle.cells = cells;
    candle.pocPrice = pocCell ? pocCell.price : (open + close) / 2;
    candle.delta = totalBid - totalAsk;
    candle.vah = vah;
    candle.val = val;
  }

  return candle;
}
