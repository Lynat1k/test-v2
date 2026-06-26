import { motion } from 'motion/react';
import { Rocket } from 'lucide-react';
import { DeviceFrame } from '../components/DeviceFrame';
import readyToStart from '../../img/ready-to-start.jpg';

const ease = [0.16, 1, 0.3, 1] as const;

export function ReadyToStart() {
  return (
    <section className="relative mx-auto max-w-6xl px-5 py-16 sm:py-24">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.8, ease }}
        className="text-center max-w-2xl mx-auto mb-10"
      >
        <div className="inline-flex items-center gap-2 mb-4">
          <Rocket className="w-5 h-5 text-gold" strokeWidth={1.75} />
          <span className="eyebrow">дефолты</span>
        </div>
        <h2 className="font-display font-bold tracking-tight leading-tight" style={{ fontSize: 'clamp(1.9rem, 4.4vw, 3.2rem)' }}>
          Открыл — и сразу анализируешь
        </h2>
        <p className="mt-4 text-muted">
          Cluster Search, Stacked Imbalance и Value Area уже выверены автором. Никакой настройки перед стартом — рабочее окружение готово с первого экрана.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.9, ease }}
      >
        <DeviceFrame
          src={readyToStart}
          alt="Готовый к анализу терминал ProCluster при первом открытии"
          chip="BTC/USDT · FUTURES · готов к анализу"
        />
      </motion.div>
    </section>
  );
}
