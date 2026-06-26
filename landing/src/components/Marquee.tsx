const PAIRS = [
  { s: 'BTC/USDT', p: '69 184.5', d: +1.84 },
  { s: 'ETH/USDT', p: '3 642.18', d: +0.92 },
  { s: 'SOL/USDT', p: '184.07', d: -2.31 },
  { s: 'BNB/USDT', p: '612.40', d: +0.41 },
  { s: 'XRP/USDT', p: '0.6218', d: -1.07 },
  { s: 'DOGE/USDT', p: '0.1642', d: +3.55 },
  { s: 'AVAX/USDT', p: '38.92', d: -0.64 },
  { s: 'LINK/USDT', p: '17.84', d: +2.18 },
];

export function Marquee() {
  const row = [...PAIRS, ...PAIRS];
  return (
    <div className="relative overflow-hidden border-y border-white/5 bg-white/[0.015] py-2.5">
      <div className="marquee-track">
        {row.map((pair, i) => (
          <span key={i} className="inline-flex items-center gap-2 px-5 text-sm">
            <span className="font-display text-white/80">{pair.s}</span>
            <span className="tnum text-white/55">{pair.p}</span>
            <span className={`tnum text-xs ${pair.d >= 0 ? 'text-bid' : 'text-ask'}`}>
              {pair.d >= 0 ? '▲' : '▼'} {Math.abs(pair.d).toFixed(2)}%
            </span>
            <span className="text-white/10 pl-3">•</span>
          </span>
        ))}
      </div>
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24" style={{ background: 'linear-gradient(90deg, #03040a, transparent)' }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24" style={{ background: 'linear-gradient(270deg, #03040a, transparent)' }} />
    </div>
  );
}
