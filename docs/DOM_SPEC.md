# DOM_SPEC.md — PROCLUSTER

## Цель
Стакан (DOM) в реальном времени + хранение снапшотов плотностей для будущей
тепловой карты и индикаторов (bid/ask ratio и т.п.).

## Панель справа от графика (сверху вниз)
1. Индекс страха и жадности (Fear & Greed) — бесплатный источник, обновление раз в день, кэш.
2. Стакан DOM под индексом.

## Live-стакан
- Real-time объёмы + горизонтальная гистограмма объёмов.
- Агрегация уровней стакана = ТАКАЯ ЖЕ, как в БД:
  шаг = base-сжатие символа (futures 25 → 2.5$, spot 500 → 5$).
- Диапазон: ±5% от текущей цены.
- Обновление отображения: 1 раз в секунду.
- Прокрутка ленты вверх/вниз от текущей цены.
- Если нет активности прокрутки > 1 сек → авто-центрирование на текущей цене.
- Кнопка свернуть/развернуть стакан в край экрана
  (при сворачивании график растягивается — см. CHART_ENGINE.md).
- На старте: только live, без истории DOM на фронте.

## Источник
Binance depth stream (futures/spot). Поддерживать корректную синхронизацию
снапшот + diff-обновления (lastUpdateId), иначе стакан "поедет".

## Local order book maintenance (правила Binance)

Реализовано в `backend/internal/depth/sync.go`. **Порядок ТОЧНО по протоколу Binance** —
сначала subscribe, потом snapshot, иначе теряем апдейты между ними → постоянные ресинки
→ теряем накопленную далёкую глубину.

### Порядок шагов (общий для futures и spot)
1. **Dial WebSocket** (`<symbol>@depth` или `@depth@100ms`).
2. Запустить горутину чтения, **буферизовать** все events в `pending` slice.
3. **Параллельно** запросить REST snapshot.
4. По приходу snapshot — применить `SnapshotFromREST(lastUpdateId, bids, asks)`.
5. **Drain pending**: drop stale → найти first event → `ApplyFirstEvent` (без валидации
   sequence) → применить остаток с обычной валидацией.
6. Перейти в streaming фазу.

### Различия futures vs spot

| | Futures (USD-M) | Spot |
|---|---|---|
| WS endpoint | `wss://fstream.binance.com/stream?streams=<sym>@depth[@rate]` | `wss://stream.binance.com:9443/ws/<sym>@depth[@rate]` |
| Update rate (default) | 250ms | 1000ms |
| Available rates | 100ms, 250ms, 500ms | 100ms, 1000ms |
| REST endpoint | `/fapi/v1/depth?limit=1000` (max=1000) | `/api/v3/depth?limit=5000` (max=5000) |
| Stale drop (drain) | `evt.u < lastUpdateId` | `evt.u < lastUpdateId+1` |
| First event check | `U <= lastUpd && u >= lastUpd` | `U <= lastUpd+1 && u >= lastUpd+1` |
| Streaming validate | `pu == prev.u` (`ApplyFuturesUpdate`) | `U == prev.u+1` (`ApplySpotUpdate`) |

### Конфигурация частоты diff-stream

Env `DEPTH_WS_RATE_MS` (валидные значения: `100`, `250`, `500`, `1000`; **дефолт `100`**).
При несовместимости с рынком — клампим к ближайшему допустимому и пишем warning.

### Memory bound (Prune)

В `LiveDOMBroadcaster.Run` запущен таймер 30s, вызывающий `OrderBook.Prune(centerPrice, 0.10)`
для каждой книги. Это отсекает уровни вне `±10%` от текущей цены — запас сверх отображаемого
`±5%` фильтра на случай быстрого движения цены. Защищает RAM на длинных сессиях.

### Диагностика

В `LiveDOMBroadcaster.Run` таймер 60s пишет `[depth-stats] <key> bids=N asks=M range=[X..Y]
center=C coverage=±Z%`. По coverage можно отслеживать "прогрев" книги через diff stream.

## Хранение снапшотов (ClickHouse) — для будущей тепловой карты
Две раздельные таблицы со своим TTL:
- clusters_futures_dom
- clusters_spot_dom

### Частота снапшотов
- Futures: раз в 1 минуту (по минимальному ТФ).
- Spot: раз в 15 минут.

### Какой момент фиксируем
- Point-in-time: момент ЗАКРЫТИЯ интервала (привязка к закрытию предыдущей свечи).
- Берём мгновенное состояние стакана на этот момент.

### Агрегация снапшота
- По ценовым рядам с шагом base-сжатия символа
  (futures 2.5$ при сжатии 25; spot 5$ при сжатии 500;
   для новых тикеров — шаг из админки).

### Структура (адаптировать под ClickHouse)
clusters_futures_dom (
  symbol       LowCardinality(String),
  snapshot_ts  DateTime64(3),     -- момент закрытия интервала
  price_level  Decimal(...),
  bid_size     Decimal(.,1),      -- лимитный объём bid на уровне
  ask_size     Decimal(.,1),      -- лимитный объём ask на уровне
  compression  UInt16
) ENGINE = MergeTree
PARTITION BY toYYYYMM(snapshot_ts)
ORDER BY (symbol, snapshot_ts, price_level)
TTL ...   -- задать отдельно

Округление размеров — то же правило truncate до 1 знака (см. DATA_MODEL.md).

## На будущее (заложить, не реализовывать сейчас)
- Тепловая карта лимитных плотностей по истории снапшотов.
- Индикаторы на основе DOM-истории (bid/ask ratio, изменения плотностей).
