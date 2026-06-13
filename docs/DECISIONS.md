# DECISIONS.md — архитектурные решения (ADR)

> Сюда пишем решения, которые меняют или фиксируют архитектуру/правила.
> Новые — сверху. Если решение противоречит спеке — сначала обнови спеку.

### [2026-06-13] React.StrictMode отключён из-за конфликта с canvas-движком
- Контекст: React StrictMode в dev mode монтирует useEffect дважды (mount → cleanup → mount). Canvas-движок создаёт PixiJS Application с WebGL canvas. Double-mount плодил два Engine (6 canvas вместо 3). Первый Engine с japanese-свечами висел под вторым → тела свечей всегда видны, бары не работают, setVisible/removeChild не работали.
- Решение: `<StrictMode>` убран из `main.tsx`. Для canvas/WebGL-движков это легитимно — StrictMode полезен для данных и副作用, но вредит для imperative canvas-кода.
- Альтернативы (отвергнуты):
  - ref-guard (`initializedRef`): cleanup сбрасывал `initializedRef.current = false`, поэтому второй mount проходил guard. Не надёжно.
  - Cleanup с `container.querySelectorAll('canvas').forEach(c => c.remove())`: удалял canvas нового engine тоже. Race condition.
  - `app.destroy({removeView: true})`: PixiJS v8 `_cancelResize is not a function`.
- Последствия:
  - Один Engine, 3 canvas — всё работает корректно.
  - Теряем StrictMode-проверки в dev (дублирование эффектов, утечки памяти). Для production это не влияет. В dev нужно следить за cleanup вручную.
  - Записать в README/engine docs: "StrictMode отключён для canvas-движка".

### [2026-06-13] Zoom-якорь: формула без screenToDataX
- Контекст: `Viewport.screenToDataX()` = `screenX/scaleX + offsetX` не совпадает с обратной функцией `Scales.timeToScreen()` = `dataIndex*candleWidth*scaleX - offsetX`. Формула коррекции offsetX после зума давала смещение.
- Решение: `newOffsetX = (screenX + oldOffsetX) * effectiveFactor - screenX`, где `effectiveFactor = newScaleX / oldScaleX` (после clamp). `screenToDataX()` удалён как неиспользуемый.
- Альтернативы: переписать coordinate system Viewport → отвергнуто (меньше изменений, формула проверена математически).
- Последствия: zoom anchor работает корректно для всех режимов.

### [2026-06-12] setVisible для контейнеров рендереров
- Контекст: при переключении режимов pool releaseAll() скрывал pool-объекты, но контейнер рендерера оставался на stage. CandleRenderer объекты оставались видимыми под кластерами.
- Решение: `setVisible(boolean)` метод на каждом рендерере. `Renderer.renderCandles()` вызывает setVisible для всех 4 рендереров перед отрисовкой.
- Альтернативы: destroy/recreate контейнеры — отвергнуто (дорого, pool теряется).
- Последствия: каждый рендерер видим ТОЛЬКО в своём режиме.

### [2026-06-12] Имбаланс: строго диагональный
- Контекст: DATA_MODEL.md требует "ask[price] vs bid[price - 1 ряд]" — это диагональное сравнение, НЕ вертикальное (ask vs bid на одном уровне).
- Решение: для каждого level[j] проверяем `ask[j] / bid[j-1] > 3.0` (ask imbalance) и `bid[j] / ask[j-1] > 3.0` (bid imbalance). При имбалансе — текст подсвечивается: ask → #00e5a0 (ярко-зелёный), bid → #ff6090 (ярко-розовый).
- Альтернативы: вертикальное сравнение (ask vs bid на одном уровне) — отвергнуто (нарушает спеку ATAS).
- Последствия: порог 300% из `ENGINE_CONFIG.imbalanceThreshold`, применяется в ClusterRenderer и FootprintRenderer.

### [2026-06-12] Canvas2D ClusterTextOverlay — оставлен с оптимизациями
- Контекст: DECISIONS.md от 6a помечал Canvas2D как временное, требующее пересмотра на полном датасете.
- Решение: оставить Canvas2D, оптимизировать: DPI scaling (devicePixelRatio), кэш шрифта (set font once после clear, не в каждом drawText). Если FPS < 50 на полном датасете (700×20=14000 блоков) — вернуть BitmapText.
- Альтернативы: BitmapText — запасной вариант (требует исправления z-ordering).
- Последствия: требуется FPS-тест в браузере.

### [2026-06-12] BitmapText → Canvas2D ClusterTextOverlay (временное решение)
- Контекст: PixiJS BitmapText не рендерится видимо на экране (корректные bounds/text/position, но невидим). Вероятная причина — z-ordering между PixiJS canvas и axis canvas (React strict mode дублирует engine → 4 canvas). Исправление z-index не помогло.
- Решение:
  - **Canvas2D ClusterTextOverlay** — отдельный canvas (position: absolute, pointer-events: none) между PixiJS и axis canvas.
  - ClusterRenderer/FootprintRenderer рисуют geometry (body/wick) через PixiJS, текст — через overlay.drawText().
  - Текст: monospace 11px, bid зелёный (#10b981), ask красный (#f43f5e).
- Альтернативы:
  - Исправить z-ordering PixiJS canvas — отвергнуто (причина не найдена, React strict mode усложняет).
  - BitmapText с другим шрифтом — отвергнуто (тот же результат).
- Последствия:
  - **ПРОТИВОРЕЧИТ CHART_ENGINE.md** ("Текст — Canvas2D слой" — но для осей, не для ~14000 кластерных блоков).
  - **ПРОТИВОРЕЧИТ исходному плану** (BitmapText для 60fps на 700 свечей × 20 уровней).
  - **Требует пересмотра в 6b** на полном датасете: если Canvas2D не держит 60fps при ~14000 текстовых блоках → вернуться к BitmapText с исправлением z-ordering.
  - Решение помечено как **временное** до проверки на полном датасете.

### [2026-06-12] ClickHouse IN (?) с time.Time[] не работает — OR-условия
- Контекст: `candle_open IN ?` с `[]time.Time` slice не конвертируется в Array(DateTime64) в clickhouse-go v2.
- Решение: explicit OR-условия `candle_open = ? OR candle_open = ? OR ...` с individual time.Time args.
- Альтернативы: `has()` function, array literal — отвергнуты (проще OR).
- Последствия: N-1 OR-условий для N timestamps (при N≤100 — приемлемо).

### [2026-06-12] ClickHouse Decimal scan: float64 не работает
- Контекст: `rows.Scan(&float64)` для Decimal(18,2) колонок падает с "converting Decimal to *float64 is unsupported".
- Решение: не селектить open_price/close_price в clusters-batch (фронт их не использует). Для price_level/bid/ask — сканировать в decimal.Decimal, конвертировать через .Float64().
- Альтернативы: scan в string, ручная конвертация — отвергнуты (decimal.Decimal уже в проекте).

### [2026-06-12] OHLC свечей: хранение Open/Close в clusters_*
- Контекст: `c.Open = c.Low; c.Close = c.High` — костыль, фитили совпадают с телом.
- Причина: таблица clusters_* не хранила first/last trade price, только price_level buckets.
- Решение:
  - **Колонки `open_price`/`close_price`** в clusters_futures/spot (Decimal(18,2), DEFAULT 0).
  - **Агрегатор** отслеживает first/last trade price в Redis (`cluster:hot:*` meta hash).
  - **First/last определяется по trade time** (primary), tradeId как tie-breaker.
  - **Оригинальная цена трейда** (`trade.Price`), НЕ синтетическая `priceLevel + half_bucket`.
  - **Rollup старших ТФ**: open = open первой 1m свечи, close = close последней.
  - **Legacy fallback**: `open_price = 0` → `open = low, close = high` (только для старых свечей).
  - **Запрос**: `any(open_price) AS open, any(close_price) AS close` в GROUP BY.
- Альтернативы:
  - Отдельная таблица `candles_ohlc` — отвергнута (лишний JOIN, доп. TTL).
  - Хранить first/last trade price в отдельном Redis key — отвергнута (нет персистентности).
- Последствия:
  - Migration 005: `ALTER TABLE clusters_futures/spot ADD COLUMN open_price/close_price`.
  - Старые данные удалены (legacy свечи с open=low, close=high не нужны).
  - Ingest должен быть запущен для накопления новых свечей с реальными OHLC.

### [2026-06-12] Race-тесты выполняются в CI (Linux), не локально на Windows
- Контекст: `go test -race` требует CGO (gcc), которого нет на Windows-машине разработчика.
- Решение: race-тесты прогоняются в CI на Linux (GitHub Actions, фаза 14). Локально на Windows `go test -race` не запускается. До запуска в CI -race не считать пройденным.
- Альтернативы: установить MinGW/MSYS2 на Windows — отвергнута (лишняя зависимость, CI всё равно нужен).
- Последствия: в CI обязательно добавить `go test -race ./...` в пайплайн.

### [2026-06-12] Фаза 4: REST API + WebSocket hub + лимит сессий
- Контекст: нужен HTTP-сервер для фронта, live-данные по WS, защита от open-acct sharing.
- Решение:
  - **HTTP без фреймворков**: стандартный `net/http` + `ServeMux` (Go 1.22+ с pattern matching). Минимум зависимостей, проект без лишних lib.
  - **Кэш → ClickHouse fallback**: REST candles сначала из Redis (последние ~700), глубже — из ClickHouse. Пагинация `before` (unix毫秒) идёт только в ClickHouse.
  - **Единый JSON-контракт**: `{ok: bool, data: ..., error: {code, message}}`. Коды ошибок: INVALID_PARAMS, DB_ERROR, RATE_LIMITED.
  - **Session limit**: Redis Sorted Set `chart_sessions:{userId}`, score = heartbeat timestamp. Lua-скрипт атомарно: удаление протухших → проверка лимита → регистрация/вытеснение. Никаких гонок при N одновременных подключениях.
  - **Политика last-wins**: новая сессия вытесняет самую старую. Вытесненная получает `session_evicted` и уходит в пассив. Выбор политики (last-wins/reject) хранится в конфиге тарифа.
  - **Heartbeat**: клиент каждые ~10с шлёт `{type:"heartbeat"}`, сервер обновляет score в Redis. Сессия без heartbeat >30с считается мёртвой и удаляется при следующей проверке.
  - **Лимиты per тариф**: Free=1, Pro=2, VIP=2, Admin=-1 (без лимита). Числа из конфигурации/админки, не хардкод.
  - **userId-заглушка**: `extractUserID` из query param или IP-based guest ID. Реальная JWT-авторизация в фазе 9 через `UserIDExtractor` interface.
  - **Rate limiting**: per-IP через Redis sorted set, sliding window. REST: 60 req/min, WS: 5 connections/min.
- Альтернативы:
  - HTTP-фреймворк (chi, gin, echo) — отвергнут (избыточно для REST API с 2-3 эндпоинтами, проект без лишних зависимостей).
  - MULTI/EXEC вместо Lua — отвергнут (Lua гарантированно атомарен, MULTI/EXEC может сломаться при ошибках).
  - Trust client для подсчёта сессий — отвергнут (клиент может врать, лимит только на бэкенде).
- Последствия:
  - Фаза 9: реальная auth подключается через `UserIDExtractor` interface (смена одной implementation).
  - Multi-symbol: aggregator нужно расширять (сейчас хардкод BTCUSDT).

### [2026-06-12] Контракт WS-сообщений
- Сервер → клиент:
  - `{type:"candle_update", symbol, data}` — обновление свечи
  - `{type:"session_active", sessionId}` — сессия активна, рендер разрешён
  - `{type:"session_evicted", reason:"limit", message}` — вытеснена, уйти в пассив
  - `{type:"session_rejected", reason:"limit", message}` — отказ по лимиту тарифа
  - `{type:"error", message}` — ошибка
- Клиент → сервер:
  - `{type:"chart_subscribe", symbol, market, timeframe}` — подписка на канал
  - `{type:"heartbeat"}` — каждые ~10с, обновляет score сессии
  - `{type:"chart_unsubscribe"}` — отписка, освобождает слот

## Уже зафиксировано на старте
- Округление объёмов: TRUNCATE до 1 знака после запятой (см. DATA_MODEL.md).
- Авто-переключение режимов: <50 свечей — кластеры, 50–200 — футпринт, 200+ — японские свечи.
- Один Go-бинарник с горутинами (не микросервисы).
- ClickHouse — market data; Redis — горячая агрегация/кэш; SQLite — пользователи/настройки.
- JSON на старте; MessagePack только при доказанном bottleneck.
- Движок графика: PixiJS WebGL + Canvas2D, изолирован, без TradingView.

### [2026-06-12] Фаза 5: Движок графика — архитектура и точка расширения
- Контекст: нужен изолированный движок графика с WebGL рендерингом и точкой расширения для инструментов рисования.
- Решение:
  - **Архитектура движка**: изолирован в `frontend/src/chart-engine/`, наружу — только `Engine` API. Модули: Renderer (PixiJS WebGL + Canvas2D), Viewport (камера/пан/зум), DataStore (данные), Scales (координаты), InteractionManager (события).
  - **Object pooling**: предвыделенные Graphics объекты (1000 штук), zero allocations в render loop.
  - **Only visible rendering**: DataStore хранит тысячи свечей, Renderer рисует только видимые 300-500.
  - **Гибридный рендеринг**: WebGL для свечей (Graphics + GraphicsContext), Canvas2D для осей/текста.
  - **Точка расширения — панель рисования**: в `App.tsx` добавлен placeholder для левой панели инструментов рисования (w-12, bg-gray-900). Реализация инструментов — Фаза 7. Пока только разметка.
- Альтернативы:
  - TradingView Lightweight Charts — отвергнут (не поддерживает кластеры/футпринт).
  - D3.js — отвергнут (избыточно для WebGL рендеринга).
- Последствия:
  - Фаза 6: добавить футпринт/кластеры/имбаланс в CandleRenderer.
  - Фаза 7: реализовать инструменты рисования в левой панели.
  - Движок НЕ импортирует UI напрямую — только через engine.* API/события.

### [2026-06-12] Фаза 2: Слой данных — ClickHouse, сжатие, rollup
- Контекст: нужна схема ClickHouse для хранения кластеров/футпринта, единый модуль агрегации, repository-интерфейс.
- Решение:
  - **TRUNCATE** — финальное правило округления объёмов: `math.Trunc(v*10)/10`. Подтверждено пользователем, зафиксировано в DECISIONS.md.
  - **Rollup старших ТФ (1h/4h/1d)**: приложение агрегирует из 1m данных и хранит в тех же таблицах clusters_* с timeframe='1h' и т.д. При запросе — отдача готовых данных без on-the-fly агрегации.
  - **TTL**: clusters_futures 1 год, clusters_spot 3 года, clusters_futures_dom 6 месяцев, clusters_spot_dom 1 год.
  - **Materialized views отклонены**: ClickHouse не позволяет MV читать и писать в одну таблицу (циклическая зависимость). Rollup делается в приложении.
  - **Decimal типы**: price_level Decimal(18,2), объёмы Decimal(18,1). Конвертация float64↔Decimal через shopspring/decimal.
- Альтернативы:
  - Materialized views для rollup — отвергнуты из-за циклических зависимостей ClickHouse.
  - Хранение отдельных таблиц для старших ТФ — отвергнуто (избыточно, проще хранить в одной таблице с разными timeframe).
  - Round half вместо TRUNCATE — отвергнуто (точность футпринта критична, TRUNCATE проще и предсказуемее).
- Последствия:
  - Rollup worker нужен для пересчёта старших ТФ при закрытии интервала.
  - Единый модуль aggregation используется для live, истории и rollup.
  - clickhouse-go/v2 + shopspring/decimal добавлены в зависимости.

### [2026-06-12] Источник трейдов: @trade vs @aggTrade (futures/spot)
- Контекст: DATA_MODEL.md требует "НЕ aggTrades для футпринта-точности", но Binance futures WS не имеет individual `@trade` stream — только `@aggTrade`.
- Решение:
  - **Spot**: stream `@trade` (индивидуальные трейды), поле `t` = tradeId, REST `/api/v3/historicalTrades` для дозапроса. Gap detection по непрерывности `t`.
  - **Futures (USDT-M)**: stream `@aggTrade` (агрегированные за ~100ms), поле `a` = aggregate trade ID, `f`/`l` = first/last trade ID, REST `/fapi/v1/aggTrades` для дозапроса (24h). Gap detection по `a` (или `f`/`l`).
  - Оба парсера маппятся в единый `model.Trade`: `TradeID = t` (spot) или `TradeID = a` (futures).
  - **isBuyerMaker (`m`)**: `true` → SELL/ASK (красный), `false` → BUY/BID (зелёный) — одинаково для обоих. Это единственно верная интерпретация (подтверждено в DATA_MODEL.md). Код design-src (ticks.ts:74) маппит `m=true → bid` — это ошибка старого кода, наш aggregation-модуль из фазы 2 правильно следует спеке.
  - Это НЕ нарушение правила "не aggTrades": на фьючерсах raw-трейдов нет физически, aggTrade сохраняет цену, сторону и объём — достаточно для футпринта (сделки склеиваются по цене+стороне, т.е. как кластер по уровню).
- Альтернативы:
  - Везде @aggTrade — отвергнуто (теряем точность на spot, где @trade доступен).
  - Игнорировать futures — отвергнуто (основной рынок).
- Последствия:
  - ingest/parser.go содержит два парсера (futures/spot) с разной логикой парсинга WS, но единым выходом `chan model.Trade`.
  - Gap fill для futures ограничен 24h (REST aggTrades). Для старых gap — historicalTrades (другой ID space, аккуратность).

### [2026-06-12] Момент записи в ClickHouse и rollup
- Контекст: когда именно писать кластеры в ClickHouse и как делать rollup старших ТФ.
- Решение:
  - **Запись в ClickHouse**: только при закрытии 1m интервала (по boundaries минуты). Текущая незакрытая свеча хранится в Redis.
  - **Rollup**: при записи 1m свечи в ClickHouse, aggregator автоматически дописывает строки 1h/4h/1d в те же таблицы. Суммирование по priceLevel, TRUNCATE один раз на финальном агрегате.
  - **Redis hot cache**: hash `cluster:levels:{symbol}:{market}:{tf}:{candle_open_ts}` с полями priceLevel → "bid,ask". При закрытии — чтение, CompressTrades, запись в CH, удаление из Redis.
- Альтернативы:
  - Писать в CH на каждый трейд — отвергнуто (слишком много записей, нагрузка на CH).
  - Rollup через materialized views — отвергнуто (циклические зависимости, см. фазу 2).
- Последствия:
  - Aggregator отвечает за hot aggregation + flush + rollup.
  - Задержка данных в CH = до 1 минуты (от закрытия интервала).

### [2026-06-11] Интеграция дизайн-репозитория: что перенесено, что удалено
- Контекст: design-src содержит полный UI крипто-терминала (React+TS+Tailwind). Нужно выделить дизайн-ассеты и перенести в наш frontend.
- Решение:
  - **ОСТАВИТЬ**: index.css (liquid glass дизайн-система, разбит на 7 файлов), types.ts, declarations.d.ts, dataGenerator.ts, все компоненты (Header, SidebarPairs, OrderBook, TimeAndSales, DOMSidebar, IndicatorsModal, AdminPanel, UserProfile, RoadmapModal), 7 PNG-ассетов (аватары+лого), SVG-иконки (AutoIcon, JapaneseIcon, FootprintIcon, ClustersIcon, CandlePreviewIcon).
  - **УДАЛИТЬ/НЕ ПЕРЕНОСИТЬ**: server.ts (Express бэкенд), vite.config.ts, tsconfig.json, metadata.json, index.html, .env.example, update_dom.ts, package.json (берём только npm-пакеты), package-lock.json, README.md, .gitignore.
  - **НЕ КОПИРОВАТЬ В КОД**: ClusterChart.tsx (3879 строк канвас-рендеринга) — оставлен в design-src как визуальный референс. Движок графика пишем в фазах 5-6.
  - **УДАЛИТЬ ПРИ ПЕНОСЕ**: paper-trading логика из DOMSidebar (~200 строк) — бизнес-логика, вернём позже.
- Альтернативы: перенести всё как есть (отвергнуто — слишком много бизнес-логики и старого движка) или писать UI с нуля (отвергнуто — design-src уже содержит готовый дизайн).
- Последствия: компоненты переносятся как заглушки/референсы. Полная интеграция (подключение к движку, WebSocket, данные) — в следующих фазах.

## Шаблон записи
### [ГГГГ-ММ-ДД] <решение>
- Контекст: почему встал вопрос.
- Решение: что выбрали.
- Альтернативы: что отвергли и почему.
- Последствия: на что влияет.
