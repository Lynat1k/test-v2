# PROGRESS.md — журнал выполненных задач

> Claude обновляет этот файл в КОНЦЕ каждой задачи. Новые записи — сверху.
> Формат записи строго по шаблону. Это память между чатами.

## Шаблон записи
### [ГГГГ-ММ-ДД] Фаза N — <короткое название>
- Модель: Opus / Sonnet
- Что сделано: ...
- Затронутые файлы/папки: ...
- Ключевые решения (если есть → продублировать в DECISIONS.md): ...
- Открытые вопросы / TODO для следующих фаз: ...
- Тесты/проверки: что проверено, что нет.

---
<!-- ниже добавляются реальные записи -->

### [2026-06-12] Фаза 2 — Слой данных: ClickHouse + сжатие
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - Созданы доменные типы: model.go (Trade, ClusterRow, Candle, DOMRow, Side)
  - Создан модуль aggregation: TruncateVolume (TRUNCATE до 1 знака), CompressPrice, GenerateLevels, InterpretTrade (isBuyerMaker→Side), SortByTradeId, CompressTrades
  - Создана конфигурация сжатия: config.go (CompressionConfig с DefaultBTCFuturesConfig/DefaultBTCSpotConfig)
  - Создан repository-интерфейс: MarketRepository (InsertClusterBatch, InsertDOMSnapshotBatch, GetLatestCandles, GetClusters)
  - Создана реализация на ClickHouse: clickhouse.go (New, ApplyMigrations, InsertClusterBatch, InsertDOMSnapshotBatch, GetLatestCandles, GetClusters)
  - Созданы SQL-миграции: clusters_futures (TTL 1 год), clusters_spot (TTL 3 года), clusters_futures_dom (TTL 6 мес), clusters_spot_dom (TTL 1 год)
  - Добавлена зависимость clickhouse-go/v2, shopspring/decimal
  - Поднят Docker ClickHouse, применены миграции, таблицы созданы (4 таблицы)
  - Rollup старших ТФ (1h/4h/1d) решено делать приложением (не MV из-за циклических зависимостей)
- Затронутые файлы/папки:
  - backend/internal/model/model.go
  - backend/internal/aggregation/ (config.go, aggregation.go, aggregation_test.go)
  - backend/internal/repository/ (repository.go)
  - backend/internal/repository/clickhouse/ (clickhouse.go, clickhouse_test.go, migrations/*.sql)
  - backend/go.mod, backend/go.sum
- Ключевые решения:
  - TRUNCATE до 1 знака — финальное решение округления объёмов
  - Rollup старших ТФ: приложение агрегирует из 1m, хранит в тех же таблицах (timeframe='1h' и т.д.)
  - TTL: futures 1y, spot 3y, futures_dom 6m, spot_dom 1y
  - Materialized views отклонены из-за циклических зависимостей ClickHouse
  - Decimal(18,2) для price_level, Decimal(18,1) для объёмов — конвертация через shopspring/decimal
- Открытые вопросы / TODO для следующих фаз:
  - Фаза 3: Ingest worker (Binance WS trades stream)
  - Фаза 4: Aggregator (hot aggregation в Redis) + rollup worker (при закрытии 1m дописывает готовые строки 1h/4h/1d в те же таблицы clusters_*)
  - **Rollup**: инфраструктура готова (колонка timeframe, модуль aggregation), но worker для записи предрасчёта старших ТФ ещё не написан — задача фазы 3-4
  - Redis-кэш последних 700 свечей
- Тесты/проверки:
  - go test ./internal/aggregation/ — PASS (unit-тесты: TRUNCATE, CompressPrice, GenerateLevels, InterpretTrade)
  - go test ./internal/repository/clickhouse/ — PASS (интеграционные: insert, select, DOM)
  - go build ./... — OK
  - gofmt -l . — OK
  - go vet ./... — OK
  - Docker ClickHouse запущен, таблицы созданы и проверены

### [2026-06-11] Фаза 1 — Интеграция дизайн-репозитория
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - Проанализирован дизайн-репозиторий (design-src): 32 файла, определены кандидаты на перенос/удаление
  - Установлены зависимости: lucide-react, motion, tailwindcss v4, @tailwindcss/vite, @vitejs/plugin-react
  - Создан vite.config.ts с React+Tailwind плагинами и alias @→src/
  - Обновлён tsconfig.json: baseUrl, paths, ignoreDeprecations
  - Разбит index.css (702 строки) на 7 модульных CSS-файлов: fonts, tokens, animations, glass, scrollbars, terminal, index
  - Скопированы типы (types.ts) и декларации (declarations.d.ts) из design-src
  - Скопированы 7 PNG-ассетов (аватары + лого) в src/assets/images/
  - Создан ThemeContext: dark/light toggle, localStorage persistence, .light класс на <html>
  - Создан I18nContext + словари (en/ru/kz): каркас для t() функции с dot-notation ключами
  - Создан CandlePaletteContext: default (green/red) и alternative (white/gray) палитры, CSS-переменные
  - Извлечены Binance API функции из monolith App.tsx в src/lib/binance/ (helpers, ticks, klines, depth)
  - Скопирован dataGenerator.ts (фоллбэк/симуляция данных) в src/lib/data/
  - Созданы SVG-иконки: AutoIcon, JapaneseIcon, FootprintIcon, ClustersIcon, CandlePreviewIcon
  - Созданы хуки: useAuth (роль/профиль), useIndicators (конфиг индикаторов), useWorkspace (макет), useChartConfig (dual-chart)
  - Создан новый App.tsx (~100 строк): ThemeProvider → I18nProvider → CandlePaletteProvider → placeholder шелл
  - ClusterChart.tsx НЕ перенесён (оставлен в design-src как визуальный референс, фазы 5-6)
  - DOMSidebar: paper-trading логика удалена при переносе (только UI стакана)
- Затронутые файлы/папки:
  - frontend/src/styles/ (7 CSS файлов)
  - frontend/src/types.ts, frontend/src/declarations.d.ts
  - frontend/src/assets/images/ (7 PNG)
  - frontend/src/contexts/ (ThemeContext, CandlePaletteContext)
  - frontend/src/i18n/ (I18nContext, types, dictionaries/en+ru+kz)
  - frontend/src/lib/binance/ (helpers, ticks, klines, depth, index)
  - frontend/src/lib/data/dataGenerator.ts
  - frontend/src/components/icons/ (5 SVG компонентов)
  - frontend/src/features/auth/useAuth.ts
  - frontend/src/features/indicators/useIndicators.ts
  - frontend/src/features/terminal/ (useWorkspace, useChartConfig)
  - frontend/src/App.tsx (перезаписан)
  - frontend/src/main.tsx (обновлён)
  - frontend/vite.config.ts (создан)
  - frontend/package.json (новые зависимости)
  - frontend/tsconfig.json (обновлён)
- Ключевые решения:
  - ClusterChart.tsx НЕ переносить — оставить в design-src как референс. Движок графика пишем в фазах 5-6.
  - DOMSidebar: удалить paper-trading логику, оставить только UI стакана
  - i18n: контекст + словари, НЕ inline ternaries. Полный перевод контента — позже.
  - Тема: гибридный подход — .light класс (как в design-src) + CSS-переменные для динамических значений
  - Палитра свечей: CSS-переменные на контейнере графика, управление через контекст
- Открытые вопросы / TODO для следующих фаз:
  - Фаза 2: Интеграция бэкенда (Go)
  - Фазы 5-6: Переписать ClusterChart на PixiJS WebGL
  - Полный перевод i18n (все строки из design-src ternaries → словари)
  - Перенести и адаптировать реальные компоненты (Header, IndicatorsModal, AdminPanel, UserProfile и др.)
  - Добавить Makefile или task runner
- Тесты/проверки: tsc --noEmit без ошибок, npm run build успешен

### [2026-06-11] Фаза 0 — Инициализация монорепо и скелета
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - Создана структура монорепо: backend/, frontend/, deploy/, docs/, scripts/, .githooks/, .github/workflows/
  - .gitignore (Go, Node, .env, sqlite, data-папки)
  - .env.example со всеми переменными (без значений)
  - README.md с описанием, запуском, строкой `git config core.hooksPath .githooks`, раздел "окружение разработчика"
  - go.mod + cmd/procluster/main.go (старт + лог "procluster up" + graceful shutdown)
  - Frontend: Vite + React + TypeScript (strict), пустой каркас
  - Инициализирован git
  - Git hook: pre-commit (gofmt)
- Затронутые файлы/папки:
  - backend/go.mod, backend/cmd/procluster/main.go
  - frontend/ (Vite scaffold)
  - .gitignore, .env.example, README.md
  - .githooks/pre-commit
- Ключевые решения: TypeScript strict с дополнительными проверками (noUncheckedIndexedAccess, exactOptionalPropertyTypes)
- Открытые вопросы / TODO для следующих фаз:
  - Фаза 1: Интеграция дизайн-репозитория
  - Добавить Makefile или task runner для удобства
- Тесты/проверки: Go компилируется, frontend собирается без ошибок
