# CURRENT_TASK.md — текущий контекст работы

> Что в работе прямо сейчас. Читать в начале сессии вместе с CLAUDE.md.
> Обновлять по ходу. Завершённое переносить в docs/PROGRESS.md.

## Статус на 2026-06-21

### ✅ ЗАКОММИЧЕНО

- fix(depth): два бага sync — книга была замёрзшей на snapshot (cd606fb):
  - Spot single-stream payload плоский, парсился в WSMessage{stream,data}
    → Symbol="" → 100% событий дропалось symbol-фильтром.
  - Futures first event после snapshot шёл в processEvent (требует pu==lastUpd,
    что для first невозможно) → mismatch → reconnect → бесконечный цикл.
  - Fix: parseDepthMessage пробует wrapper+flat; futures URL переведён на
    single-stream; needsFirstApply флаг направляет первое streaming event
    в ApplyFirstEvent если drain не нашёл first.
  - Логи [depth-debug] под env DEPTH_DEBUG=1 (off в проде).
  - Проверено: futures applied=485, spot applied=490 за 90с; обе книги растут.

- feat(depth): полная книга через diff-stream, реальная глубина ±5%:
  - sync.go — переписан connectAndSync по протоколу Binance (dial WS → buffer → snapshot
    → drain stale-drop → ApplyFirstEvent → streaming). Spot REST limit 1000→5000.
    Env DEPTH_WS_RATE_MS (дефолт 100) с клампом по правилам рынка.
  - orderbook.go — ApplyFirstEvent (без sequence-валидации для первого event), Prune
    (защита RAM ±10% от мида), Stats (диагностика).
  - livedom.go — pruneTicker 30s + logTicker 60s ([depth-stats]). Выходной 1-сек
    ticker НЕ тронут — это РАЗНЫЕ частоты с входной (Binance→backend = 100ms).
  - DOM_SPEC.md — раздел Local order book maintenance с правилами Binance раздельно
    futures/spot, частотами, prune ±10%.
  - Smoke (5 мин): spot bids/asks=5000 на старте, futures 1000, 0 mismatch, 0 ended.

- feat(dom): сжатие стакана — выбор уровня агрегации 1-2-5 сетка (8 уровней):
  - DOMSidebar/domCompression.ts — buildDOMCompressionLevels, getDomBaseStep, aggregateDOMLevels
  - DOMSidebar/index.tsx — dropdown между FearGreedPanel и OrderBookTable, amber-стиль
  - ChartControlsContext.tsx — futurePriceTick/spotPriceTick в TickerConfig
  - depth/sync.go — SetReadLimit 2MB (был 64KB)
  - backend: GET /api/v1/tickers (публичный), user settings API

- fix(settings): сохранение выбора сжатия стакана (3 коммита):
  1. apiPutSettings использовал raw fetch без Authorization Bearer → 401 молча проглатывался.
     Исправлено: теперь использует request() обёртку с accessTokenRef.
  2. writeLocal({}) в миграции теперь вызывается только после успешного PUT.
  3. setSetting переписан: immediate writeLocal (без дебаунса) для всех пользователей
     + debounced apiPutSettings для авторизованных. Убран setTimeout(..., 0) из
     React updater (side effect в updater — опасно в StrictMode/Concurrent Mode).

- Фикс админки (frontend/src/components/AdminPanel.tsx):
  устранён бесконечный цикл опроса history jobs (jobs убран из зависимостей useEffect,
  адаптивный polling через setTimeout+ref, cleanup clearTimeout). Вкладка "База данных".

- Фикс агрегатора (backend/internal/aggregator/aggregator.go):
  - guard от двойного flush 1m (timer vs trade-path) через lastFlushedCandleOpen
  - higher-TF пишутся из tfStates на закрытии бакета, per-1m rollup удалён
  - swap bid/ask под ATAS в tfStateToRows, pushTFUpdates, readLevelsFromRedis
  - Проверено на свежих свечах localhost: dist_open=1 (без дублей), bid/ask корректны, объёмы без ×2-3.

- feat(admin): вкладка «Настройки», ценообразование PRO/VIP, favicon (11159f6):
  - AdminPanel.tsx — вкладка «Настройки» (Settings) с TierPoliciesBlock (перенесён из Users)
  - AdminPanel.tsx — панель мониторинга (хосты/зарег./онлайн) + настройка цен PRO/VIP в USDT (localStorage)
  - AdminPanel.tsx — класс admin-panel-root для масштабирования шрифтов +20%
  - UserProfile.tsx — цены тарифов динамические из localStorage (вместо хардкода $19/$49)
  - index.css — CSS-правила admin-panel-root
  - Favicon: PNG 16x16/32x32 вместо SVG
  - i18n: ключ admin.tabs.settings (en/ru/kz), обновлены переводы ru

- feat(ui): полная поддержка светлой темы (59cacef):
  - UserDropdown.tsx — профиль-дропдаун, кнопка темы, кнопка профиля: полный light
  - App.tsx — кнопка сворачивания стакана (стрелка видна), мобильные настройки
  - ChartContainer2.tsx + ClusterChartAdapter.tsx — передача theme → ClusterChart (график light)
  - DOMSidebar/index.tsx — карточка и сворачивание light
  - UserProfile.tsx — все карточки секций, PlanCard, LimitRow
  - ChartHeader.tsx — дропдауны, кнопки, метки
  - IndicatorsModal.tsx, RoadmapModal.tsx, LoginModal.tsx, RegisterModal.tsx

### 🟡 НЕ ЗАКОММИЧЕНО (висит локально)
1. Фикс сжатия live-уровней (frontend):
   - frontend/src/chart2d/adapter.ts — функция aggregateLevels (формула floor как в REST)
   - frontend/src/chart2d/ClusterChartAdapter.tsx — применение aggregateLevels в onCandleUpdate
   - Проверено визуально: свежие свечи показывают нужное сжатие.
   - ВНИМАНИЕ: проверить лишний импорт computeValueArea в ClusterChartAdapter.tsx — убрать если не используется.

2. Фикс графика prepend/zoom (frontend) — С ОТЛАДОЧНЫМИ ЛОГАМИ [SCROLL-DEBUG]:
   - frontend/src/chart2d/ClusterChart.tsx, ClusterChartAdapter.tsx
   - ПЕРЕД КОММИТОМ удалить все [SCROLL-DEBUG] логи.

### 📋 ПЛАН КОММИТОВ (осталось 2 из 3, НЕ смешивать)
- Коммит 1: aggregator.go — ✅ СДЕЛАН.
- Коммит 1.5: admin settings + favicon — ✅ СДЕЛАН (11159f6).
- Коммит 2: adapter.ts + ClusterChartAdapter.tsx (сжатие live).
- Коммит 3: ClusterChart.tsx + ClusterChartAdapter.tsx (prepend/zoom, убрать SCROLL-DEBUG).
- ВНИМАНИЕ: ClusterChartAdapter.tsx пересекается в коммитах 2 и 3 → разделять через git add -p.

### 🔲 НАДО ПЕРЕПРОВЕРИТЬ ПОЗЖЕ
- Старшие ТФ (1h/4h) bid/ask и объёмы — проверить при появлении волатильности (сейчас рынок тихий, разницу не видно).
- Визуально проверить админку: вкладка «Настройки», панель цен PRO/VIP, масштаб шрифтов.

## Как проверять фиксы агрегатора
1. Перезапустить backend (убить старый procluster.exe, собрать, запустить, новый PID).
2. SQL на свежие 1m: dist_open должен быть 1 (нет дублей), vol без умножения:
   docker exec procluster-clickhouse clickhouse-client --password clickhouse -q "SELECT candle_open, count() rows, count(DISTINCT open_price) dist_open, sum(bid_volume+ask_volume) vol FROM procluster.clusters_futures WHERE symbol='BTCUSDT' AND timeframe='1m' AND candle_open >= now() - INTERVAL 10 MINUTE GROUP BY candle_open ORDER BY candle_open"
3. Визуально в браузере: растущая свеча → ask больше bid; объёмы близки к эталону (ATAS/Tiger).

## Известные грабли окружения
- НЕ выставлять $env:CLICKHOUSE_ADDR / REDIS_ADDR — .env уже на localhost. Иначе i/o timeout на 192.168.0.17 (несуществующий хост).
- Backend держит процесс в открытом окне PowerShell. Логи: .\procluster.exe *> procluster.log
