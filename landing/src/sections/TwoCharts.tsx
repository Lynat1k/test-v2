import { motion } from 'motion/react';
import { Columns2 } from 'lucide-react';
import { DeviceFrame } from '../components/DeviceFrame';
import twoChart from '../../img/2chart.jpg';

const ease = [0.16, 1, 0.3, 1] as const;

export function TwoCharts() {
  return (
    <section className="relative mx-auto max-w-6xl px-5 py-12">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.8, ease }}
        className="text-center max-w-2xl mx-auto mb-10"
      >
        <div className="inline-flex items-center gap-2 mb-4">
          <Columns2 className="w-5 h-5 text-cyan" strokeWidth={1.75} />
          <span className="eyebrow">два графика</span>
        </div>
        <h2 className="font-display font-bold tracking-tight leading-tight" style={{ fontSize: 'clamp(1.9rem, 4.4vw, 3.2rem)' }}>
          Два графика. <span className="headline-quiet">Один экран.</span>
        </h2>
        <p className="mt-4 text-muted">
          Свечи со Stacked Imbalance и футпринт рядом — сравнивайте таймфреймы и инструменты, не переключая вкладки.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.9, ease }}
      >
        <DeviceFrame
          src={twoChart}
          alt="Два кластерных графика параллельно на одном экране"
          chip="2 графика · параллельный режим"
        />
      </motion.div>
    </section>
  );
}
