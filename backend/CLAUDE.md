# backend/ — правила (Go)

## Агрегация данных (aggregator/, store/, ingest/, migrations/)
- От этого зависит ТОЧНОСТЬ футпринта (цель — близко к ATAS / Tiger Trade).
- ЕДИНЫЙ источник правды для округления/сжатия/маппинга — один модуль, везде (live, история, стакан).
- Округление объёма: TRUNCATE до 1 знака (5.1256→5.1; 0.0125→0.0).
- Внутренняя конвенция: pl.bid=BUY, pl.ask=SELL. На выходе (CH+WS) swap под ATAS:
  BidVolume=SELL, AskVolume=BUY. Точки swap: tfStateToRows, pushTFUpdates, readLevelsFromRedis.
  Путь FlushCandle→CompressTrades уже даёт ATAS — НЕ трогать.
  isBuyerMaker==true → SELL; ==false → BUY. Сортировка по tradeId. Время — trade time.
- Live higher-TF: из tfStates на закрытии бакета (НЕ per-1m rollup). Backfill: aggregation.Rollup.
- Guard от двойного flush 1m через lastFlushedCandleOpen. Timer флашит только завершённую минуту.
- priceTick: futures 0.1$, spot 0.01$. base-сжатие из конфигурации, НЕ хардкод. Уровни = base*k до 10.
- Формула сжатия: floor(price_level/priceStep)*priceStep — идентична фронту (см. docs/DECISIONS.md).
- Запросы к ClickHouse параметризованные. Историческая загрузка идемпотентна.

## Go-стиль
- gofmt/goimports. Один бинарник с горутинами. Логика в internal/ по пакетам.
- Доступ к БД через repository-интерфейсы (для миграции SQLite→PostgreSQL).
- Ошибки оборачивать (fmt.Errorf "...: %w"). Без panic в рантайме запросов.
- Останов воркеров через context.Context. Тесты с -race.
- Hot-path (ingest/aggregator/ws-hub): без лишних аллокаций; запись в ClickHouse батчить асинхронно.
- Секреты только через env. Логи без паролей/токенов.

## Безопасность (auth/, admin/, api/)
- Весь ввод валидируется на бэкенде. SQL только параметризованный.
- Приватные/админ-маршруты: authN+authZ на КАЖДОМ запросе.
- login/register/recovery: rate-limit (Redis) + lockout. Секретов в коде нет.
- При сомнении — docs/SECURITY.md.

## После правок
ОБЯЗАТЕЛЬНО пересобрать и перезапустить:
  go build -o procluster.exe ./cmd/procluster/
  убить старый procluster.exe, запустить новый, записать PID.
НЕ выставлять $env:CLICKHOUSE_ADDR/REDIS_ADDR — .env уже на localhost.
