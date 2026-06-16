import { useState } from 'react'
import { motion } from 'motion/react'
import {
  X, CheckCircle2, PlayCircle, Clock,
  Rocket, Star,
} from 'lucide-react'

interface RoadmapModalProps {
  isOpen: boolean
  onClose: () => void
  language: 'RU' | 'EN' | 'KZ'
}

interface Milestone {
  id: string
  version: string
  quarter: string
  status: 'done' | 'in-progress' | 'planned'
  title: { RU: string; EN: string; KZ: string }
  desc: { RU: string; EN: string; KZ: string }
  features: { RU: string[]; EN: string[]; KZ: string[] }
}

const MILESTONES: Milestone[] = [
  {
    id: 'done-1',
    version: 'v1.0.0',
    quarter: 'Q1 2026',
    status: 'done',
    title: {
      RU: 'Ядро парсера и реал-тайм потока',
      EN: 'Parser Engine & Real-time Stream',
      KZ: 'Талдаушы ядросы және нақты уақыт желісі'
    },
    desc: {
      RU: 'Разработка высокоскоростного парсера тиков и интеграция WebSocketBinance.',
      EN: 'Implementation of high-speed tick aggregator with Binance WebSocket client.',
      KZ: 'Жоғары жылдамдықты тик қозғалтқышын әзірлеу және WebSocketBinance кіріктіру.'
    },
    features: {
      RU: [
        'Агрегация сделок в кластерный футпринт',
        'Интервалы графиков от 5 тиков до 50 тиков',
        'Режимы Японские свечи / Автоматические кластеры'
      ],
      EN: [
        'Aggregate ticks into cluster footprints',
        'Chart intervals ranging from 5T to 50T',
        'Japanese Candlesticks & Auto Cluster visualization modes'
      ],
      KZ: [
        'Мәмілелерді кластерлік футпринтке біріктіру',
        'График аралығы 5 тикпен 50 тик арасында',
        'Жапондық шамдар / Автоматты кластерлер режимдері'
      ]
    }
  },
  {
    id: 'done-2',
    version: 'v1.1.0',
    quarter: 'Q1 2026',
    status: 'done',
    title: {
      RU: 'Уровни сжатия и кастомизация',
      EN: 'Compression levels & custom profiles',
      KZ: 'Қысу деңгейлері және профильді баптау'
    },
    desc: {
      RU: 'Гибкий интерфейс для настройки шага цены, водяных знаков и настроек индикаторов.',
      EN: 'Flexible controls for defining tick pricing step size, custom logo watermarks, and indicator states.',
      KZ: 'Баға қадамдарын, су белгілерін және көрсеткіштерді баптайтын икемді интерфейс.'
    },
    features: {
      RU: [
        'Система сохранения настроек сжатия по умолчанию по тикерам и таймфреймам',
        'Инструмент выбора аватаров и изменения профилей пользователей',
        'Очистка утилиты PROCLUSTER в префиксе дефолтных названий'
      ],
      EN: [
        'Tick and timeframe default compression memory presets',
        'User profile avatar presets and credentials save',
        'Cleaner indicator labeling with prefix adjustments'
      ],
      KZ: [
        'Тикерлер мен таймфреймдер бойынша қысу деңгейін сақтау жүйесі',
        'Аватар таңдау және пайдаланушы профильдерін өзгерту құралы',
        'Негізгі атаулардағы PROCLUSTER префикстерін тазалау'
      ]
    }
  },
  {
    id: 'ip-1',
    version: 'v1.5.0',
    quarter: 'Q2 2026',
    status: 'in-progress',
    title: {
      RU: 'Телеграм уведомления и абсорбция',
      EN: 'Telegram alerts bridge & Orderbook Absorption',
      KZ: 'Телеграм хабарландыру және абсорбция'
    },
    desc: {
      RU: 'Интеграция с ботом @PROCLUSTER_BOT для отправки крупных сделок в реальном времени.',
      EN: 'Integration with @PROCLUSTER_BOT telegram connector to dispatch large real-time transactional anomalies.',
      KZ: 'Нақты уақыттағы ірі келісімдерді жіберу үшін @PROCLUSTER_BOT ботымен кіріктіру.'
    },
    features: {
      RU: [
        'Умный фильтр абсорбции и обнаружения стековых дисбалансов',
        'Подписка на детекторы экстремальных дельт',
        'Автоматический трекинг объемов и пинга сети'
      ],
      EN: [
        'Smart absorption analytics and stacked imbalances trigger',
        'Subscribe to extreme delta cluster detections',
        'Automated tracker for volumes and network WebSocket delay'
      ],
      KZ: [
        'Абсорбция және тепе-теңдік бұзылуын интеллектуалды бақылау',
        'Экстремальды дельта кластерлерінің детекторларына жазылу',
        'Көлемдер мен желі пингін автоматты түрде бақылау'
      ]
    }
  },
  {
    id: 'pl-1',
    version: 'v2.0.0',
    quarter: 'Q3 2026',
    status: 'planned',
    title: {
      RU: 'ИИ Кластерный Поиск и Нейро-Паттерны',
      EN: 'AI Cluster Search & Neuro-Patterns Neural Engine',
      KZ: 'ЖИ кластерлік іздеу және Нейро-Паттерндер'
    },
    desc: {
      RU: 'Внедрение нейронных моделей оценки исторических зон проторговки и детекции крупных разворотных зон.',
      EN: 'Neural network pattern recognition models trained on tick footprint zones to isolate turning points.',
      KZ: 'Тарихи проторговка және ірі бұрылыс аймақтарын анықтау жүйесін ЖИ арқылы жасау.'
    },
    features: {
      RU: [
        'Прогнозирование прорывов уровней по паттернам плотностей',
        'Интерфейс визуального ИИ-Анализа кластеров',
        'Автоматический менеджмент рисков на основе аномалий книги ордеров'
      ],
      EN: [
        'Predict breakthrough levels training on orderbook densities',
        'Visual interface for real-time AI-guided analytical prompts',
        'Automation of personal risk thresholds based on orderbook walls'
      ],
      KZ: [
        'Тығыздықтардың паттерндері бойынша деңгейлік бұзылуын болжау',
        'Нақты кластерлік ЖИ-Талдау интерфейсі',
        'Тапсырыс кітабындағы аномалиялар негізінде тәуекелді басқару'
      ]
    }
  },
  {
    id: 'pl-2',
    version: 'v2.5.0',
    quarter: 'Q4 2026',
    status: 'planned',
    title: {
      RU: 'Мультибиржевой кросс-поток и DeFi Пулы',
      EN: 'Multi-exchange Aggregator & DeFi Pools Visual Footprint',
      KZ: 'Мультибаржалық кросс-ағын және DeFi пулы'
    },
    desc: {
      RU: 'Слияние потоков ликвидности DEX/CEX и расширение покрытия на Ethereum L2, Uniswap и Solana.',
      EN: 'Aggregating Uniswap DEX volumes together with CEX liquidities to render cross-chain order flow matrices.',
      KZ: 'DEX/CEX өтімділігін біріктіру және Ethereum L2, Uniswap, Solana қолдауын кеңейту.'
    },
    features: {
      RU: [
        'Кросс-коэффициенты корреляции и арбитражные сессии на графике',
        'Отображение пулов концентрации Uniswap V3 прямо в стакане',
        'Мульти-ордер терминал для торговли через API в едином окне'
      ],
      EN: [
        'Incorporate correlation ratios and live arbitrage patterns',
        'Uniswap V3 pool liquidities integrated directly in DOM sidebar',
        'Unified multi-exchange trading via API direct feeds'
      ],
      KZ: [
        'Арбитраждық сессиялар және корреляциялық қатынастар',
        'Uniswap V3 өтімділігін тікелей DOM бағанында көрсету',
        'Бірегей интерфейс арқылы API-мен мульти-қор биржалық сауда жасау'
      ]
    }
  }
]

export default function RoadmapModal({ isOpen, onClose, language }: RoadmapModalProps) {
  const [filter, setFilter] = useState<'all' | 'done' | 'in-progress' | 'planned'>('all')

  const filteredMilestones = MILESTONES.filter(
    (item) => filter === 'all' || item.status === filter
  )

  const t = {
    title: { RU: 'Дорожная Карта Проекта', EN: 'Project Roadmap', KZ: 'Жобаның Жол Картасы' }[language],
    subtitle: {
      RU: 'Развитие аналитической платформы и график выпуска инновационных модулей',
      EN: 'Analytical platform horizons and core release schedule of innovation modules',
      KZ: 'Талдау платформасының болашағы және жаңа модульдерді шығару кестесі'
    }[language],
    filterAll: { RU: 'Все', EN: 'All', KZ: 'Барлығы' }[language],
    filterDone: { RU: 'Выполнено', EN: 'Completed', KZ: 'Орындалды' }[language],
    filterIp: { RU: 'В разработке', EN: 'In Progress', KZ: 'Әзірленуде' }[language],
    filterPl: { RU: 'В планах', EN: 'Planned', KZ: 'Жоспарда' }[language],
    close: { RU: 'Закрыть', EN: 'Close', KZ: 'Жабу' }[language],
    currentVer: { RU: 'Текущая версия: v1.1.0 (Стабильная)', EN: 'Current Stable version: v1.1.0', KZ: 'Ағымдағы нұсқа: v1.1.0' }[language]
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-md z-[9998] transition-all"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: 'spring', duration: 0.4 }}
        className="w-full max-w-4xl h-[85vh] max-h-[750px] rounded-[32px] border relative z-[9999] flex flex-col justify-between overflow-hidden shadow-2xl bg-slate-950 border-white/10 text-white shadow-black/80"
      >
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-amber-500/5 blur-[90px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-blue-500/5 blur-[90px] pointer-events-none" />

        <div className="px-6 sm:px-8 py-5.5 border-b relative z-10 flex items-center justify-between bg-white/[0.01] border-white/5">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Rocket className="w-5.5 h-5.5 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight font-sans text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-600">
                  {t.title}
                </h2>
                <span className="text-[9px] font-black uppercase tracking-widest bg-amber-500/20 border border-amber-500/30 text-amber-500 px-2 py-0.5 rounded-full leading-none animate-pulse">
                  BETA ROADMAP
                </span>
              </div>
              <p className="text-[11px] font-medium leading-snug mt-0.5 text-slate-400">
                {t.subtitle}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl transition duration-200 cursor-pointer border bg-white/5 hover:bg-white/10 border-white/5 text-slate-400 hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 sm:px-8 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 relative z-10 bg-black/10 border-white/5">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <div className="p-1 rounded-xl bg-slate-500/5 border border-white/5 flex items-center gap-1">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-[10.5px] font-bold tracking-wide transition cursor-pointer ${
                  filter === 'all'
                    ? 'bg-white/10 text-white border border-white/10 font-extrabold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {t.filterAll}
              </button>
              <button
                onClick={() => setFilter('done')}
                className={`px-3 py-1.5 rounded-lg text-[10.5px] font-bold tracking-wide transition cursor-pointer flex items-center gap-1 ${
                  filter === 'done'
                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-extrabold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t.filterDone}
              </button>
              <button
                onClick={() => setFilter('in-progress')}
                className={`px-3 py-1.5 rounded-lg text-[10.5px] font-bold tracking-wide transition cursor-pointer flex items-center gap-1 ${
                  filter === 'in-progress'
                    ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20 font-extrabold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <PlayCircle className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '3s' }} />
                {t.filterIp}
              </button>
              <button
                onClick={() => setFilter('planned')}
                className={`px-3 py-1.5 rounded-lg text-[10.5px] font-bold tracking-wide transition cursor-pointer flex items-center gap-1 ${
                  filter === 'planned'
                    ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20 font-extrabold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                {t.filterPl}
              </button>
            </div>
          </div>

          <span className="text-[10px] font-mono font-bold text-slate-400">
            {t.currentVer}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 relative z-10 space-y-6 scrollbar-thin-dark">
          <div className="absolute left-[33px] sm:left-[41px] top-6 bottom-6 w-0.5 bg-gradient-to-b from-emerald-500 via-amber-500 to-blue-500 opacity-20 pointer-events-none" />

          {filteredMilestones.map((item, idx) => {
            const isDone = item.status === 'done'
            const isIp = item.status === 'in-progress'

            let statusBadge = ''
            let dotColor = ''
            let ringColor = ''
            let cardAccent = ''

            if (isDone) {
              statusBadge = language === 'RU' ? 'Выпущено' : language === 'KZ' ? 'Дайын' : 'Released'
              dotColor = 'bg-emerald-500'
              ringColor = 'ring-emerald-500/20'
              cardAccent = 'border-emerald-500/15 bg-emerald-500/[0.01]'
            } else if (isIp) {
              statusBadge = language === 'RU' ? 'Интеграция' : language === 'KZ' ? 'Әзірленуде' : 'Developing'
              dotColor = 'bg-amber-500'
              ringColor = 'ring-amber-500/20 ring-4'
              cardAccent = 'border-amber-500/20 bg-amber-500/[0.02] shadow-lg shadow-amber-500/[0.02]'
            } else {
              statusBadge = language === 'RU' ? 'В планах' : language === 'KZ' ? 'Жоспарда' : 'Planned'
              dotColor = 'bg-blue-500'
              ringColor = 'ring-blue-500/10'
              cardAccent = 'border-white/5 bg-white/[0.005]'
            }

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex gap-4 relative"
              >
                <div className="relative z-10 flex flex-col items-center shrink-0 w-8 sm:w-12 pt-1.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ring-4 ${ringColor} bg-slate-950`}>
                    <div className={`w-2 h-2 rounded-full ${dotColor} ${isIp ? 'animate-ping' : ''}`} />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-slate-400 mt-2 block tracking-wider leading-none">
                    {item.quarter}
                  </span>
                </div>

                <div className={`flex-1 p-5 rounded-2xl border transition-all duration-300 flex flex-col gap-3 ${cardAccent}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                        isDone
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : isIp
                            ? 'bg-amber-500/10 text-amber-500'
                            : 'bg-blue-500/10 text-blue-500'
                      }`}>
                        {item.version}
                      </span>
                      <h3 className="text-sm font-black font-sans tracking-tight text-white">
                        {item.title[language]}
                      </h3>
                    </div>

                    <span className={`text-[8.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      isDone
                        ? 'bg-emerald-500/10 border-emerald-500/15 text-emerald-500 animate-pulse'
                        : isIp
                          ? 'bg-amber-500/15 border-amber-500/20 text-amber-500'
                          : 'bg-blue-500/5 border-blue-500/10 text-blue-450'
                    }`}>
                      {statusBadge}
                    </span>
                  </div>

                  <p className="text-[11.5px] font-medium leading-relaxed text-slate-400">
                    {item.desc[language]}
                  </p>

                  <div className="pt-2 border-t border-white/[0.03] flex flex-col gap-1.5">
                    {item.features[language].map((feat, fIdx) => (
                      <div key={fIdx} className="flex items-start gap-2.5 text-[11px] font-sans">
                        <Star className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                          isDone ? 'text-emerald-500' : isIp ? 'text-amber-500' : 'text-blue-500'
                        }`} />
                        <span className="text-slate-300">{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>

        <div className="px-6 sm:px-8 py-4.5 border-t relative z-10 flex items-center justify-between border-white/5 bg-slate-950/20">
          <span className="text-[10px] font-mono text-slate-500 select-none">
            PROCLUSTER ALPHA LABS &copy; 2026
          </span>
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition flex items-center gap-1.5 hover:scale-102 active:scale-98 cursor-pointer border bg-white/10 hover:bg-white/15 border-white/10 text-white"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>{t.close}</span>
          </button>
        </div>
      </motion.div>
    </div>
  )
}
