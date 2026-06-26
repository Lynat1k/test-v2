import { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';
import { Zap, Maximize2, Calculator, AlignVerticalJustifyCenter, type LucideIcon } from 'lucide-react';
import { DeviceFrame, LiveBadge } from '../components/DeviceFrame';
import anomaly from '../../img/anomaly.jpg';
import clusterAuto from '../../img/cluster-auto.gif';
import longShort from '../../img/long-short-object.jpg';
import dom from '../../img/dom.jpg';

const ease = [0.16, 1, 0.3, 1] as const;

type Row = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  desc: string;
  src: string;
  alt: string;
  chip: string;
  accent: string;
  portrait?: boolean;
  badge?: 'live' | 'gif';
};

const ROWS: Row[] = [
  {
    icon: Zap, eyebrow: 'аномалии', accent: 'text-ask',
    title: 'Видно, кто давит рынок',
    desc: 'Агрессивные объёмы с дисбалансом подсвечиваются автоматически. Карточка покажет монеты, объём в USDT и силу дисбаланса — не пропустите вход крупного игрока.',
    src: anomaly, alt: 'Подсветка аномального объёма — агрессивный продавец', chip: 'footprint · anomaly',
  },
  {
    icon: Maximize2, eyebrow: 'масштаб', accent: 'text-cyan',
    title: 'Свечи плавно становятся кластерами',
    desc: 'При зуме график без рывков переходит от свечей к футпринту и обратно. Видно общую картину и детали ячеек — в одном движении.',
    src: clusterAuto, alt: 'Плавный переход от свечей к кластерам при зуме', chip: 'zoom · candles → clusters', badge: 'gif',
  },
  {
    icon: Calculator, eyebrow: 'риск-менеджмент', accent: 'text-bid',
    title: 'Риск и объём с учётом комиссии',
    desc: 'Позиционный калькулятор прямо на графике: задайте депозит и риск — получите цель, стоп, размер позиции и соотношение риск/прибыль с учётом мейкер/тейкер комиссий.',
    src: longShort, alt: 'Инструмент расчёта риска и объёма позиции', chip: 'position · risk tool',
  },
  {
    icon: AlignVerticalJustifyCenter, eyebrow: 'глубина', accent: 'text-cyan',
    title: 'Детальный стакан рынка',
    desc: 'DOM по ценовым уровням: bid и ask, плотности и крупные лимитники — как на бирже, рядом с кластерами.',
    src: dom, alt: 'Стакан глубины рынка (DOM)', chip: 'DOM · depth', portrait: true,
  },
];

export function Showcase() {
  return (
    <section id="showcase" className="relative mx-auto max-w-6xl px-5 py-20 sm:py-28">
      <div className="max-w-2xl mb-14">
        <p className="eyebrow mb-3">Δ что внутри</p>
        <h2 className="font-display font-bold tracking-tight leading-tight" style={{ fontSize: 'clamp(1.9rem, 4vw, 3rem)' }}>
          Реальный терминал,<br className="hidden sm:block" /> не рендеры
        </h2>
        <p className="mt-4 text-muted">Всё ниже — живые скриншоты ProCluster.</p>
      </div>

      <div className="flex flex-col gap-20 sm:gap-28">
        {ROWS.map((row, i) => (
          <ShowcaseRow key={row.title} row={row} flip={i % 2 === 1} />
        ))}
      </div>

      <p className="tnum text-[11px] text-muted/50 mt-16 max-w-xl">
        <span className="text-gold">*</span> Точность — уровня проф-терминалов. Погрешность минимальна, но возможны расхождения с биржевыми данными.
      </p>
    </section>
  );
}

function ShowcaseRow({ row, flip }: { row: Row; flip: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [40, -40]);
  const Icon = row.icon;

  return (
    <div ref={ref} className={`grid lg:grid-cols-2 gap-8 lg:gap-14 items-center ${flip ? 'lg:[direction:rtl]' : ''}`}>
      {/* text */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7, ease }}
        className="[direction:ltr]"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="glass-btn rounded-xl w-11 h-11 flex items-center justify-center shrink-0">
            <Icon className={`w-5 h-5 ${row.accent}`} strokeWidth={1.75} />
          </span>
          <span className="eyebrow">{row.eyebrow}</span>
        </div>
        <h3 className="font-display font-semibold tracking-tight leading-snug" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.1rem)' }}>
          {row.title}
        </h3>
        <p className="mt-4 text-muted leading-relaxed max-w-md">{row.desc}</p>
      </motion.div>

      {/* screenshot */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.8, ease }}
        className="[direction:ltr]"
      >
        <motion.div style={{ y: reduce ? 0 : y }} className={row.portrait ? 'max-w-[300px] mx-auto' : ''}>
          <DeviceFrame
            src={row.src}
            alt={row.alt}
            chip={row.chip}
            badge={row.badge === 'gif' ? <LiveBadge label="LIVE" /> : row.badge === 'live' ? <LiveBadge /> : undefined}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}
