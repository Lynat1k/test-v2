# Technical Decisions & TODOs

## TODO history-on-scroll polish
При очень быстром скролле 1m возможны микро-дёргания priceRange. Сейчас: priceBounds по visible window + freeze во время prepend + timestamp-anchor + force-retrigger у левого края. Допилить плавность (lerp priceRange / троттлинг) позже. Файлы: ClusterChart.tsx (priceBounds, useLayoutEffect anti-jump), ClusterChartAdapter.tsx (handleNeedHistory).

## Движок графика: Canvas2D (не PixiJS)
Дата: 2026-06. Движок реализован на Canvas2D (frontend/src/chart2d/), а не на PixiJS/WebGL.
Причина: проще отладка футпринта/кластеров, достаточная производительность на текущем датасете.
WebGL/PixiJS — отложено на будущее (оптимизация). Все доки, упоминающие chart-engine/PixiJS,
читать как chart2d/Canvas2D до отдельного решения о миграции.
Ключевые файлы: frontend/src/chart2d/ClusterChart.tsx, adapter.ts, ClusterChartAdapter.tsx.

## Единая формула сжатия кластеров (live = REST, бит-в-бит)
Сжатие уровней (объединение в base*k) считается формулой floor(price_level / priceStep) * priceStep.
ДВА места обязаны давать идентичный результат:
- Frontend live: aggregateLevels() в frontend/src/chart2d/adapter.ts
- REST SQL: floor(price_level / priceStep) * priceStep в backend (clickhouse.go)
Менять формулу — только синхронно в обоих местах.

## Live-агрегация higher-TF: из tfStates на закрытии бакета
Старший ТФ (5m/15m/30m/1h/4h/1d) пишется в ClickHouse ОДНОЙ записью на закрытии бакета,
из in-memory tfStates (полный агрегат за период). Per-1m rollup внутри FlushCandle УДАЛЁН
(он создавал 15 частичных версий свечи → дубли). Закрытие бакета детектируется по смене
AlignToTimeframe. aggregation.Rollup остаётся ТОЛЬКО для backfill (history/loader.go, admin).

## Guard от двойного flush 1m (timer vs trade-path)
Таймер и приход трейда могли флашить одну 1m свечу дважды (дубли, dup_factor ~1.6).
Решение: lastFlushedCandleOpen в candleState. Timer флашит только завершённую минуту
(currentCandleOpen == prevMinute). Trade-path флашит старую минуту только если
currentCandleOpen.After(lastFlushedCandleOpen); поздние трейды закрытой минуты — discard.
Файл: backend/internal/aggregator/aggregator.go.

## DOM-глубина спота: diff-стрим vs бэкфилл
Дата: 2026-06-21. Live diff-стрим даёт только ±~2% для спота (Binance шлёт лишь изменения,
дальние спот-уровни приходят редко). Для исторической тепловой карты плотностей спота потребуется
бэкфилл depth-архивов из data.binance.vision (вариант B), по аналогии с загрузчиком трейдов.
Re-snapshot (вариант A) отвергнут — ломает diff-sync через свой lastUpdateId.
Futures углубляется сам до ±10% через diff-стрим за ~5-10 минут.

## bid/ask конвенция (ATAS)
Внутренняя конвенция в памяти: pl.bid = BUY (агрессор покупатель), pl.ask = SELL.
На ВЫХОДЕ (запись в CH и WS) переворачивается под ATAS: BidVolume = SELL, AskVolume = BUY.
Точки swap: tfStateToRows, pushTFUpdates, readLevelsFromRedis.
Исторический путь FlushCandle→CompressTrades уже даёт ATAS — его НЕ трогать.
Эталон правила: isBuyerMaker==true → SELL → BidVolume(колонка); ==false → BUY → AskVolume.
