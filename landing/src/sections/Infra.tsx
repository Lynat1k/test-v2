import { motion } from 'motion/react';
import { Server, Zap, ArrowRight } from 'lucide-react';

const ease = [0.16, 1, 0.3, 1] as const;

const STATS = [
  { k: 'Источник данных', v: 'Binance', sub: 'спот и фьючерсы' },
  { k: 'Дата-центр', v: 'Гонконг', sub: 'рядом с биржевыми' },
  { k: 'Задержка', v: 'минимум', sub: 'чистый поток тиков' },
];

export function Infra() {
  return (
    <section className="relative mx-auto max-w-6xl px-5 py-12">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.8, ease }}
        className="glass rounded-3xl px-6 sm:px-12 py-12 sm:py-14 relative overflow-hidden"
      >
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-2 mb-4">
              <Server className="w-5 h-5 text-cyan" strokeWidth={1.75} />
              <span className="eyebrow">инфраструктура</span>
            </div>
            <h2 className="font-display font-bold tracking-tight leading-tight" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.9rem)' }}>
              Серверы в Гонконге.<br className="hidden sm:block" /> <span className="headline-quiet">Вплотную к Binance.</span>
            </h2>
            <p className="text-muted mt-5 max-w-md">
              Данные берём напрямую с Binance, а наши серверы стоят в Гонконге — рядом с биржевыми. Меньше задержка, чище поток, точнее кластеры.
            </p>
            <a href="https://chart.procluster.online" className="term-btn rounded-xl px-6 py-3.5 font-display font-semibold inline-flex items-center gap-2 mt-8">
              Попробовать бесплатно <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          <div className="grid sm:grid-cols-3 lg:grid-cols-1 gap-3">
            {STATS.map((s) => (
              <div key={s.k} className="glass-btn rounded-2xl px-5 py-4 flex items-center gap-4">
                <Zap className="w-4 h-4 text-gold shrink-0" />
                <div>
                  <div className="tnum text-[10px] uppercase tracking-[0.18em] text-muted/70">{s.k}</div>
                  <div className="font-display font-semibold text-lg leading-tight">{s.v}</div>
                  <div className="tnum text-[11px] text-muted/70">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
