# CLAUDE.md — PROCLUSTER (project memory)

> Главный файл памяти для Claude Code. Читается автоматически при старте сессии.
> Держать ёмким: правила и навигация, детали — в docs/.

## Что это за проект
PROCLUSTER — онлайн-сервис кластерных графиков крипто-активов (аналог mobchart.com, exocharts, ATAS).
Кастомный Canvas2D движок графика, футпринт/кластера/японские свечи, стакан DOM, индикаторы,
авторизация, тарифы, админка.
- Лендинг: procluster.online
- Приложение: chart.procluster.online

## Стек (не менять без записи в docs/DECISIONS.md)
- Backend: Go, один бинарник + горутины, WebSocket hub, REST API
- Market data: ClickHouse
- Hot aggregation: Redis
- Auth/settings: SQLite (старт) → план миграции на PostgreSQL
- Frontend: React + TypeScript (strict)
- Chart engine: Canvas2D (frontend/src/chart2d/). НЕ PixiJS (WebGL отложен), НЕ TradingView Lightweight Charts!
- Deploy: Docker Compose на VPS, CI/CD через GitHub Actions
- Данные: Binance WS (trades) + историческая загрузка с data.binance.vision

## Железо на старте
4 vCPU 3.3GHz / 8GB RAM / 150GB NVMe. Память дорогая — экономить RAM.

## Локальное окружение (dev)
- Работа в D:\PROCLUSTER2\procluster
- Redis и ClickHouse — в Docker (контейнеры procluster-redis, procluster-clickhouse), localhost.
- .env уже настроен на localhost. НЕ выставлять $env:CLICKHOUSE_ADDR / REDIS_ADDR вручную.
- Запуск backend: cd backend; go build -o procluster.exe ./cmd/procluster/; .\procluster.exe
- Frontend dev: cd frontend; npm run dev
- ClickHouse-запросы: docker exec procluster-clickhouse clickhouse-client --password clickhouse -q "..."

## Навигация по докам (читать нужное под задачу)
- docs/ARCHITECTURE.md — общая архитектура
- docs/DATA_MODEL.md — схемы ClickHouse, сжатие тиков, агрегация
- docs/CHART_ENGINE.md — движок графика (Canvas2D)
- docs/INDICATORS.md — индикаторы, cluster search
- docs/DOM_SPEC.md — стакан и снапшоты
- docs/AUTH_PLANS.md — пользователи, тарифы, лимиты
- docs/ADMIN.md — админка
- docs/SECURITY.md — безопасность (читать ОБЯЗАТЕЛЬНО перед сетью/вводом/авторизацией)
- docs/ROADMAP.md — мастер-план фаз
- docs/PROGRESS.md — лог сделанного
- docs/DECISIONS.md — журнал архитектурных решений
- CURRENT_TASK.md — текущий контекст: что в работе прямо сейчас

## Рабочий протокол
1. В начале задачи прочитать CLAUDE.md + CURRENT_TASK.md + относящийся спек в docs/ + хвост PROGRESS.md.
2. Не противоречить docs/DECISIONS.md. Хочешь изменить — спроси.
3. Противоречие или пробел в спецификации — СПРОСИ, не выдумывай.
4. В конце задачи дописать в docs/PROGRESS.md: дату, что сделано, файлы, TODO.
5. Атомарные коммиты с понятными сообщениями. Секреты не коммитить.
6. После правок backend ОБЯЗАТЕЛЬНО пересобрать и перезапустить procluster.exe (убить старый PID). Проверить что нет ошибок при запуска
7. На финише остановить procluster.exe (убить старый PID). Я буду в ручную запускать его со своей консоли.

## Стиль общения (важно для пользователя)
- Пользователь не программист. Объяснять простым языком, без жаргона, КОРОТКО. на русском языке!
- Команды для консоли и готовые куски кода — в блоках для копирования.
- Если нужны логи/ответ пользователя для решения — СНАЧАЛА спросить, потом действовать.

## Дизайн-источник
UI берётся из дизайн-репозитория https://github.com/Lynat1k/PROCLUSTER3 (эталон стиля/верстки).
репозиторий использовать как эталон дизайна, верстки и стиля объектов кнопок и других элементов, но логику работы перепроверять.
Палитра свечей: красный/зелёный и белый/тёмно-серый. Cтиль liquid glass. Языки RU/EN/KZ. Тема сайта темная/светлая

# ──────────────────────────────────────────────────────────────
# ВСТРОЕННЫЕ ПРАВИЛА (соблюдать при работе с соответствующим кодом)
# ──────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────
# ПРАВИЛА ПО КОДУ (path-scoped)
# ──────────────────────────────────────────────────────────────
- backend/CLAUDE.md — правила Go: агрегация, bid/ask, сжатие, безопасность, перезапуск.
- frontend/CLAUDE.md — правила React/Canvas2D: движок графика, сжатие live=REST, сборка.
Claude Code подхватывает их автоматически при работе с файлами в этих папках.

