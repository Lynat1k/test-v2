import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Activity, CloudUpload, Smartphone, BarChart3, SlidersHorizontal, type LucideIcon } from 'lucide-react';

const ease = [0.16, 1, 0.3, 1] as const;

type Feature = { icon: LucideIcon; title: string; desc: string; accent: string };

const FEATURES: Feature[] = [
  { icon: Activity, title: 'Проф-индикаторы', desc: 'Cluster Search, Stacked Imbalance, кастомный Volume и другие — все настраиваемые.', accent: 'text-gold' },
  { icon: BarChart3, title: 'CVD · Delta', desc: 'Накопительная дельта и подвальная панель дельты — режимы линий, свечей и баров.', accent: 'text-cyan' },
  { icon: CloudUpload, title: 'Настройки — на сервере', desc: 'Объекты рисования и настройки графика хранятся на сервере, а не только в кеше браузера. Открыл с любого устройства — и продолжил.', accent: 'text-bid' },
  { icon: Smartphone, title: 'Адаптив для мобильных', desc: 'Полноценный кластерный анализ с телефона, не только с десктопа.', accent: 'text-ask' },
];

function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs tnum bg-white/[0.04] border border-white/8 text-white/80 ${className}`}>
      {children}
    </span>
  );
}

export function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-5 py-16 sm:py-20">
      <div className="max-w-2xl mb-10">
        <p className="eyebrow mb-3">и ещё</p>
        <h2 className="font-display font-bold tracking-tight leading-tight" style={{ fontSize: 'clamp(1.7rem, 3.4vw, 2.6rem)' }}>
          График — под себя
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* customization — rich, spans 2 */}
        <motion.article
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease }}
          className="glass glass-hover rounded-2xl p-6 flex flex-col sm:col-span-2"
        >
          <div className="flex items-center gap-3 mb-4">
            <span className="glass-btn rounded-xl w-11 h-11 flex items-center justify-center">
              <SlidersHorizontal className="w-5 h-5 text-cyan" strokeWidth={1.75} />
            </span>
            <h3 className="font-display font-semibold text-lg">Гибкая кастомизация графика</h3>
          </div>

          <div className="flex flex-col gap-3 mt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted/70 w-28 shrink-0">Палитры свечей</span>
              <Tag>
                <i className="w-2.5 h-2.5 rounded-sm bg-bid inline-block" />
                <i className="w-2.5 h-2.5 rounded-sm bg-ask inline-block" />
                красно-зелёная
              </Tag>
              <Tag>
                <i className="w-2.5 h-2.5 rounded-sm bg-white inline-block" />
                <i className="w-2.5 h-2.5 rounded-sm bg-black border border-white/30 inline-block" />
                чёрно-белая
              </Tag>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted/70 w-28 shrink-0">Тип свечей</span>
              <Tag>японские</Tag>
              <Tag>бары</Tag>
              <Tag>футпринт</Tag>
              <Tag>кластеры</Tag>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted/70 w-28 shrink-0">В кластерах</span>
              <Tag className="!text-bid">bid</Tag>
              <Tag className="!text-ask">ask</Tag>
              <Tag>volume</Tag>
              <Tag>delta</Tag>
            </div>
          </div>
        </motion.article>

        {FEATURES.map((f, i) => (
          <motion.article
            key={f.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, ease, delay: (i % 3) * 0.06 }}
            className="glass glass-hover rounded-2xl p-6 flex flex-col"
          >
            <div className="glass-btn rounded-xl w-11 h-11 flex items-center justify-center mb-5">
              <f.icon className={`w-5 h-5 ${f.accent}`} strokeWidth={1.75} />
            </div>
            <h3 className="font-display font-semibold text-base mb-1.5">{f.title}</h3>
            <p className="text-sm text-muted leading-relaxed">{f.desc}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
