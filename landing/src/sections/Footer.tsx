import { Youtube, Send, MessageCircle } from 'lucide-react';

const COLUMNS = [
  { title: 'Продукт', links: ['Терминал', 'Индикаторы', 'Тарифы', 'Дорожная карта'] },
  { title: 'Ресурсы', links: ['Документация', 'Гайд по футпринту', 'FAQ', 'Статус'] },
  { title: 'Контакты', links: ['Telegram', 'Поддержка', 'Сотрудничество', 'Почта'] },
];

const SOCIALS = [
  { Icon: Youtube, href: 'https://www.youtube.com/@PRO_CLSTR', label: 'YouTube' },
  { Icon: Send, href: 'https://t.me/PROCLUSTER', label: 'Telegram-канал' },
  { Icon: MessageCircle, href: 'https://t.me/+kB5D3e1N9-RhMjZi', label: 'Telegram-чат' },
];

export function Footer() {
  return (
    <footer className="relative mx-auto max-w-6xl px-5 pt-16 pb-10">
      <div className="glass rounded-3xl p-8 sm:p-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* brand */}
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="font-display font-bold text-lg tracking-tight">ProCluster</span>
            </div>
            <p className="text-sm text-muted max-w-xs leading-relaxed">
              Кластерный терминал для крипто-трейдеров. Точные данные, проф-индикаторы, удобный футпринт.
            </p>
            <div className="flex items-center gap-2 mt-5">
              {SOCIALS.map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  title={label}
                  className="glass-btn w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-white"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* link columns */}
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="font-display font-semibold text-sm mb-4 text-white/90">{col.title}</h4>
              <ul className="flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-sm text-muted hover:text-white transition-colors">{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-white/8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="tnum text-xs text-muted/60">© 2026 ProCluster. Все права защищены.</p>
          <p className="tnum text-[11px] text-muted/40 max-w-md sm:text-right">
            Не является финансовой рекомендацией. Возможны расхождения с биржевыми данными.
          </p>
        </div>
      </div>
    </footer>
  );
}
