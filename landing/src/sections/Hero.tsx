import { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';
import { ArrowRight, Sparkles, Laptop } from 'lucide-react';
import { DeviceFrame, LiveBadge } from '../components/DeviceFrame';
import chartCluster from '../../img/chart-cluster.jpg';

const ease = [0.16, 1, 0.3, 1] as const;

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease } },
};

export function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const imgY = useTransform(scrollYProgress, [0, 1], [0, -90]);

  return (
    <section ref={ref} className="relative mx-auto max-w-6xl px-5 pt-16 pb-8 sm:pt-24">
      {/* copy */}
      <motion.div variants={container} initial="hidden" animate="show" className="max-w-3xl">
        <motion.div variants={item} className="inline-flex items-center gap-2 rounded-full glass-btn px-3.5 py-1.5 mb-6">
          <Sparkles className="w-3.5 h-3.5 text-cyan" />
          <span className="eyebrow !tracking-[0.2em]">кластерный терминал · LIVE</span>
        </motion.div>

        <motion.h1 variants={item} className="font-display font-bold leading-[1.05] tracking-tight" style={{ fontSize: 'clamp(2.3rem, 5.6vw, 4.6rem)' }}>
          <span className="headline-strong">Рыночные данные такими,</span><br />
          <span className="headline-strong">какими должны быть.</span>{' '}
          <span className="headline-quiet">а не такими, как раньше</span>
        </motion.h1>

        <motion.p variants={item} className="mt-6 text-base sm:text-lg text-muted max-w-2xl leading-relaxed">
          Точность отображения объёмов уровня профессиональных десктопных терминалов{' '}
          <span className="text-white/80">ATAS</span> и <span className="text-white/80">Tiger Trade</span> —
          проф-индикаторы и читаемый футпринт для крипто-трейдеров.
        </motion.p>

        <motion.p variants={item} className="mt-5 flex items-start gap-2.5 font-display text-lg sm:text-xl text-white/90 max-w-xl leading-snug">
          <Laptop className="w-5 h-5 text-cyan mt-1 shrink-0" strokeWidth={1.75} />
          Дай компьютеру отдохнуть — смотри кластерный график прямо в браузере.
        </motion.p>

        <motion.div variants={item} className="mt-8 flex flex-wrap items-center gap-3">
          <a href="https://chart.procluster.online" className="term-btn rounded-xl px-6 py-3.5 font-display font-semibold inline-flex items-center gap-2">
            Открыть терминал <ArrowRight className="w-4 h-4" />
          </a>
          <a href="https://chart.procluster.online" className="glass-btn rounded-xl px-6 py-3.5 font-display font-medium text-white/90 inline-flex items-center gap-2">
            Попробовать бесплатно
          </a>
        </motion.div>
      </motion.div>

      {/* real terminal screenshot */}
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease, delay: 0.25 }}
        className="mt-12 sm:mt-14"
      >
        <motion.div style={{ y: reduce ? 0 : imgY }}>
          <DeviceFrame
            src={chartCluster}
            alt="Кластерный (футпринт) график ProCluster — BTC/USDT"
            chip="BTC/USDT · FUTURES · кластеры"
            badge={<LiveBadge />}
            priority
          />
        </motion.div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs tnum text-muted/80">
          <span className="text-bid">●</span> Binance
          <span className="text-white/15">/</span> футпринт
          <span className="text-white/15">/</span> DOM
          <span className="text-white/15">/</span> CVD · Delta
          <span className="text-white/15">/</span> Stacked Imbalance
        </div>
      </motion.div>
    </section>
  );
}
