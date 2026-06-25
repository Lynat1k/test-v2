import { useState } from "react";
import ClusterChartAdapter from "./ClusterChartAdapter";

type CandleType = "auto" | "japanese" | "footprint" | "clusters";
type CandleDataType = "bid_ask" | "delta" | "volume";

const btn = (active: boolean) =>
  `px-2 py-0.5 text-[10px] font-mono font-bold rounded cursor-pointer border transition-all duration-100 ${
    active
      ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300"
      : "bg-zinc-800/50 border-zinc-700/30 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
  }`;

export default function Chart2dPreview() {
  const [candleType, setCandleType] = useState<CandleType>("japanese");
  const [candleDataType, setCandleDataType] = useState<CandleDataType>("bid_ask");

  return (
    <div className="w-screen h-screen bg-zinc-950 flex flex-col" style={{ height: '100dvh' }}>
      <div className="flex-none px-3 py-1.5 border-b border-zinc-800 flex items-center gap-3">
        <span className="text-zinc-500 text-[10px] font-mono tracking-wider mr-2">preview</span>

        <span className="text-zinc-700 text-[10px]">Type:</span>
        {(["japanese", "clusters", "footprint"] as const).map((t) => (
          <button key={t} className={btn(candleType === t)} onClick={() => setCandleType(t)}>
            {t}
          </button>
        ))}

        <span className="text-zinc-700 text-[10px] ml-2">Data:</span>
        {(["bid_ask", "delta", "volume"] as const).map((d) => (
          <button key={d} className={btn(candleDataType === d)} onClick={() => setCandleDataType(d)}>
            {d === "bid_ask" ? "Bid/Ask" : d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}

        <span className="flex-1" />

        <a href="/" className="text-zinc-600 hover:text-zinc-400 text-[10px] underline underline-offset-2">
          main app →
        </a>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <ClusterChartAdapter
          symbol="BTCUSDT"
          market="futures"
          timeframe="1m"
          candleType={candleType}
          candleDataType={candleDataType}
          candlePalette="default"
        />
      </div>
    </div>
  );
}
