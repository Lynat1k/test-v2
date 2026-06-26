import { useEffect, useMemo } from 'react';
import {
  motion,
  useMotionValue,
  useMotionTemplate,
  useSpring,
  useScroll,
  useTransform,
  useReducedMotion,
} from 'motion/react';

/* ── deterministic, seamless (periodic) zigzag price walk → candles ── */
const W = 2600;
const H = 900;
const STEP = 22;
const CW = 12;
const COUNT = Math.floor(W / STEP);
const TWO_PI = Math.PI * 2;

// Periodic over COUNT so the two tiled copies loop seamlessly.
// High harmonics give realistic zigzag jaggedness.
function priceY(i: number) {
  const p = COUNT;
  const v =
    150 * Math.sin((TWO_PI * 1 * i) / p + 0.6) +
    74 * Math.sin((TWO_PI * 2 * i) / p + 1.3) +
    46 * Math.sin((TWO_PI * 3 * i) / p) +
    30 * Math.sin((TWO_PI * 5 * i) / p + 0.4) +
    22 * Math.sin((TWO_PI * 8 * i) / p) +
    16 * Math.sin((TWO_PI * 13 * i) / p + 0.9) +
    12 * Math.sin((TWO_PI * 21 * i) / p);
  return H * 0.5 - v;
}

type Candle = { x: number; cx: number; top: number; h: number; high: number; low: number; up: boolean };

function buildCandles(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < COUNT; i++) {
    const o = priceY(i);
    const c = priceY(i + 1);
    const top = Math.min(o, c);
    const bot = Math.max(o, c);
    const amp = 6 + Math.abs(Math.sin(i * 1.7)) * 22;
    out.push({ x: i * STEP, cx: i * STEP + CW / 2, top, h: Math.max(2, bot - top), high: top - amp, low: bot + amp, up: c <= o });
  }
  return out;
}

function CandleStrip() {
  const candles = useMemo(buildCandles, []);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      {candles.map((cd, i) => {
        const color = cd.up ? 'rgba(16,185,129,0.55)' : 'rgba(244,63,94,0.5)';
        return (
          <g key={i}>
            <line x1={cd.cx} y1={cd.high} x2={cd.cx} y2={cd.low} stroke={color} strokeWidth={1.5} />
            <rect x={cd.x} y={cd.top} width={CW} height={cd.h} fill={color} rx={1} />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Trading-style parallax atmosphere: a faint candlestick tape with a
 * realistic zigzag, rotated to run diagonally across the screen, plus
 * three glow blobs. Blur is light near the top and ramps up on scroll.
 * Depth-shifted by cursor (spring) and scroll. No grid, no waves.
 */
export function ParallaxBackground() {
  const reduce = useReducedMotion();

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 40, damping: 18, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 40, damping: 18, mass: 0.6 });

  const { scrollY } = useScroll();
  const blobDrift = useTransform(scrollY, [0, 1600], [0, -260]);
  const candleScroll = useTransform(scrollY, [0, 2000], [0, -150]);

  // weaker blur in the hero, stronger as you scroll
  const blurPx = useTransform(scrollY, [0, 1100], [1.2, 5]);
  const blurFilter = useMotionTemplate`blur(${blurPx}px)`;

  useEffect(() => {
    if (reduce) return;
    const onMove = (e: MouseEvent) => {
      px.set((e.clientX / window.innerWidth) * 2 - 1);
      py.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [px, py, reduce]);

  // depth offsets
  const cyanX = useTransform(sx, [-1, 1], [-50, 50]);
  const cyanY = useTransform(sy, [-1, 1], [-40, 40]);
  const emeraldX = useTransform(sx, [-1, 1], [40, -40]);
  const emeraldY = useTransform(sy, [-1, 1], [30, -30]);
  const goldX = useTransform(sx, [-1, 1], [-24, 24]);

  const candleX = useTransform(sx, [-1, 1], [22, -22]);
  const candleY = useTransform(sy, [-1, 1], [16, -16]);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-bg-deep" aria-hidden>
      {/* deep radial base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 70% -10%, rgba(34,211,238,0.10) 0%, transparent 45%), radial-gradient(100% 80% at 10% 110%, rgba(16,185,129,0.08) 0%, transparent 50%), #03040a',
        }}
      />

      {/* glow blobs */}
      <motion.div className="blob blob-cyan" style={{ width: 620, height: 620, top: '-12%', right: '-6%', x: reduce ? 0 : cyanX, y: reduce ? 0 : cyanY }} />
      <motion.div className="blob blob-emerald" style={{ width: 540, height: 540, top: '38%', left: '-10%', x: reduce ? 0 : emeraldX, y: reduce ? 0 : emeraldY }} />
      <motion.div className="blob blob-gold" style={{ width: 460, height: 460, bottom: '-14%', right: '18%', x: reduce ? 0 : goldX, y: reduce ? 0 : blobDrift }} />

      {/* diagonal drifting candlestick tape */}
      <motion.div
        className="absolute left-0 right-0"
        style={{
          top: 'calc(50% - 450px)',
          x: reduce ? 0 : candleX,
          y: reduce ? 0 : candleScroll,
          skewY: -16,
          transformOrigin: 'center',
          opacity: 0.24,
          filter: reduce ? 'blur(4px)' : blurFilter,
        }}
      >
        <div className={`chart-drift ${reduce ? '[animation:none]' : ''}`}>
          <motion.div style={{ y: reduce ? 0 : candleY }}><CandleStrip /></motion.div>
          <motion.div style={{ y: reduce ? 0 : candleY }}><CandleStrip /></motion.div>
        </div>
      </motion.div>

      {/* vignette to seat the glass */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(150% 130% at 50% 45%, transparent 50%, rgba(2,3,8,0.74) 100%)',
        }}
      />
    </div>
  );
}
