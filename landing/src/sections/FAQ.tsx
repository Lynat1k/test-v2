import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus } from 'lucide-react';

const QA = [
  {
    q: 'Что такое ProCluster?',
    a: 'Кластерный (футпринт) торговый терминал для крипто-трейдеров. Показывает распределение объёмов покупок и продаж внутри каждой свечи, POC, дисбалансы, дельту и стакан рынка — всё в браузере.',
  },
  {
    q: 'Какие биржи поддерживаются?',
    a: 'Сейчас — данные Binance (спот и фьючерсы), напрямую с биржи. Серверы стоят в Гонконге, рядом с биржевыми, ради минимальной задержки. Другие площадки на подходе.',
  },
  {
    q: 'Есть ли бесплатный тариф?',
    a: 'Да. Бесплатный доступ позволяет познакомиться с футпринтом, индикаторами и стаканом. Расширенные лимиты и функции — на платных тарифах.',
  },
  {
    q: 'Это веб или десктоп?',
    a: 'Веб. ProCluster работает прямо в браузере — на десктопе и на мобильном, без установки. Настройки и объекты рисования хранятся в профиле на сервере.',
  },
  {
    q: 'Откуда данные и насколько они точны?',
    a: 'Данные собираются на уровне точности проф-терминалов (ATAS, Tiger Trade). Погрешность минимальна, но возможны расхождения с биржевыми данными.',
  },
  {
    q: 'Как начать?',
    a: 'Откройте терминал, выберите пару и таймфрейм — дефолты Cluster Search и Stacked Imbalance уже выверены. Можно сразу анализировать, ничего не настраивая.',
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="relative mx-auto max-w-3xl px-5 py-20 sm:py-28">
      <div className="text-center mb-12">
        <p className="eyebrow mb-3">вопросы</p>
        <h2 className="font-display font-bold tracking-tight" style={{ fontSize: 'clamp(1.9rem, 4vw, 3rem)' }}>
          Коротко о главном
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {QA.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="glass rounded-2xl overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between gap-4 px-5 sm:px-6 py-5 text-left"
              >
                <span className="font-display font-medium text-base sm:text-lg">{item.q}</span>
                <motion.span
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className={`shrink-0 ${isOpen ? 'text-gold' : 'text-muted'}`}
                >
                  <Plus className="w-5 h-5" />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 sm:px-6 pb-5 -mt-1 text-sm sm:text-[15px] text-muted leading-relaxed">
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
