# DECISIONS.md — архитектурные решения (ADR)

> Сюда пишем решения, которые меняют или фиксируют архитектуру/правила.
> Новые — сверху. Если решение противоречит спеку — сначала обнови спек.

## Уже зафиксировано на старте
- Округление объёмов: TRUNCATE до 1 знака после запятой (см. DATA_MODEL.md).
- Авто-переключение режимов: <50 свечей — кластеры, 50–200 — футпринт, 200+ — японские свечи.
- Один Go-бинарник с горутинами (не микросервисы).
- ClickHouse — market data; Redis — горячая агрегация/кэш; SQLite — пользователи/настройки.
- JSON на старте; MessagePack только при доказанном bottleneck.
- Движок графика: PixiJS WebGL + Canvas2D, изолирован, без TradingView.

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
