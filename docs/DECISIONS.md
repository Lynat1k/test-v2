# DECISIONS.md — архитектурные решения (ADR)

> Сюда пишем решения, которые меняют или фиксируют архитектуру/правила.
> Новые — сверху. Если решение противоречит спеке — сначала обнови спеку.

### [2026-06-16] Spot CSV timestamp: µs→ms в обоих парсерах
- Контекст: Binance Vision хранит spot aggTrade timestamp в микросекундах, futures — в миллисекундах. Парсер CLI (`history/csvparser.go:133`) учитывал это (`/1000`), но парсер админки (`admin/historyloader.go:691-713`) — нет, что привело к записи 3.5M строк с битым `candle_open = 1900-01-01` в `clusters_spot`.
- Решение:
  - Добавлено `timestampMs /= 1000` для spot в `admin/historyloader.go:698-700`.
  - Добавлена валидация `CandleOpen` перед INSERT в `clickhouse.go:136-139` (отсекает Year < 2009 || Year > 2100).
  - Cross-reference комментарии: `history/csvparser.go:133` → `admin/historyloader.go` и обратно.
- Правило на будущее: **Оба парсера должны синхронно обрабатывать µs→ms конвертацию для spot.** При изменении одного — менять другой.

### [2026-06-15] Фаза 12 Этап 2.1: tier_policies в БД + рефактор лимитов с трёхуровневым fallback
- Контекст: Session limits (guest=1/free=1/pro=2/vip=2/admin=-1) и history gating (guest=7d/free=180d/pro+=unlimited) были захардкожены в AuthConfig и switch. Нужна БД для динамического управления через админку.
- Решение:
  - **tier_policies таблица** в SQLite: tier, session_limit, history_max_days, created_at, updated_at. Создаётся в auth.Migrate().
  - **Seed**: 5 строк с текущими значениями, идемпотентен (COUNT>0 → skip).
  - **LoadTierPolicies** в admin пакете: читает из БД, возвращает мапы.
  - **Session limits**: main.go загружает из БД, передаёт в NewSessionManager. Если БД пуста/ошибка → AuthConfig.SessionLimits. session.go:75-81 остаётся последним рубежом (limits==nil).
  - **History gating**: Т.к. api не может импортировать admin, решение — `Server.tierHistoryLimits map[string]time.Duration` + `SetTierHistoryLimits()`. main.go вызывает после LoadTierPolicies. `resolveHistoryDepth(role)` — сначала проверяет мапу сервера, затем fallback на `maxDepthForRole(role, cfg)`.
  - **Трёхуровневый fallback**: (1) БД (tier_policies), (2) AuthConfig/env, (3) хардкод в session.go/maxDepthForRole switch.
  - AuthConfig.SessionLimits/HistoryMaxGuest/HistoryMaxFree ОСТАВЛЕНЫ — не удалять.
  - **Энфорсмент**: только для существующих лимитов (session, history). Chart_compression_locked и прочие поля — задел на будущее.
- Альтернативы:
  - Загружать лимиты в рантайме на каждый запрос — отвергнуто (лишние SQL-запросы, лимиты меняются только через админку → загрузка при старте достаточна).
  - Читать tier_policies из api пакета напрямую — отвергнуто (циклический импорт admin↔api).
  - Удалить AuthConfig.SessionLimits после ввода БД — отвергнуто (нетативная обратная совместимость, если БД пуста/ошибка при старте).
- Последствия:
  - SessionManager всё ещё может работать с nil limits (hardcoded fallback в NewSessionManager).
  - maxDepthForRole как standalone функция сохранена для юнит-тестов.
  - При пустой таблице или ошибке чтения — поведение идентично старому (fallback на AuthConfig/env/хардкод).

### [2026-06-15] .env автозагрузка: godotenv.Load() во всех cmd
- Контекст: При запуске `.\procluster.exe` из PowerShell без ручного `$env:` экспорта Go сам .env не читает → все getEnv() срабатывают с фолбэками. CLICKHOUSE_DB=default вместо procluster → live-данные утекали в базу "default" вместо "procluster".
- Решение:
  - **godotenv.Load() (не Overload)**: Вызывается в самом начале main() во всех трёх cmd (procluster, loader, e2etest). `Load()` НЕ перезаписывает уже установленные системные ENV — это позволяет Docker/прод-окружению переопределять переменные. Вручную заданные `$env:HISTORY_LOADER_PROXY` не затираются.
  - **Логирование конфига**: При старте `[config] effective settings: CLICKHOUSE_ADDR=... CLICKHOUSE_DB=... REDIS_ADDR=... SQLITE_PATH=... APP_PORT=...` — сразу видно, к какой базе реально подключились. Пароли/секреты не логируются.
  - **e2etest**: Добавлен `godotenv.Load()` + единая `getEnv()` (были разрозненные `os.Getenv` с фолбэками). REDIS_ADDR читается из env.
- Подтверждение: `godotenv v1.5.1` уже в go.mod/go.sum от joho. `Load()` не перезаписывает существующие ENV (godotenv документация). `Overload` не используется.
- Последствия:
  - Все три бинарника при старте загружают .env из рабочей директории.
  - Строка лога `[config] effective settings:` показывает CLICKHOUSE_DB=procluster (из .env) при запуске без ручного экспорта.
  - Старые данные в `default.clusters_*` (34 строки live) — мусор от запусков до фикса. Не удаляем из кода, можно очистить вручную.
- Файлы: `cmd/procluster/main.go`, `cmd/loader/main.go`, `cmd/e2etest/main.go`

### [2026-06-14] Фаза 12 Этап 1 Fix v2: ClickHouse size uint64 + layout + charts
- Контекст: ClickHouse size query падал с ошибкой "converting UInt64 to *int64 is unsupported, try using *uint64". toInt64() в SQL не помогает — драйвер проверяет тип на уровне протокола. Суточные графики показывали "Collecting data..." при 1 точке. Пустоты по высоте в раскладке.
- Решения:
  - **ClickHouse size**: Сканирование в `var size uint64` + `Scan(&size)`, затем `int64(size)` для JSON. SQL: `SELECT COALESCE(sum(bytes_on_disk), 0) FROM system.parts WHERE database = ?` (без toInt64). Драйвер clickhouse-go v2 не поддерживает каст UInt64→int64 напрямую — `*uint64` единственный рабочий вариант.
  - **Sampler disk path**: `sampleOnce()` использует `disk.Usage(filepath.Dir(SQLITE_PATH))` вместо `disk.Usage(".")`.
  - **Throttle ошибок ClickHouse**: `sync.Mutex` + `chSizeLastErr` + `chSizeLastTime` — ошибка логируется НЕ чаще раза в минуту.
  - **DailyChart**: Порог `data.length === 0` вместо `< 2`. При 1 точке — рисуется dot по центру. При 0 — "Collecting data...".
  - **Layout**: `items-stretch` на grid, `h-full` на левой колонке, карточки `flex-1 min-h-0`, chart container `flex-1 min-h-[40px]`. Обе колонки одной высоты.
- Альтернативы:
  - `toInt64()` в SQL — отвергнуто: драйвер игнорирует SQL-функцию, проверяет тип на уровне протокола.
  - `*int64` с ручным кастом — отвергнуто: clickhouse-go v2 не поддерживает UInt64→int64.
  - Порог `< 2` для графика — отвергнуто: при 1 точке (сразу после старта) UX показывает "Collecting data..." 60с вместо dot.
- Последствия:
  - `metrics.go`: `getClickHouseSize` использует `uint64` scan, `int64()` конвертация.
  - `metrics_history.go`: sampler читает disk из正确目录, первая точка сразу.
  - `AdminPanel.tsx`: DailyChart рисует dot при 1 точке, flex-1 cards, items-stretch grid.

### [2026-06-14] Фаза 12 Этап 1: Server Metrics + Ring Buffer Logs
- Контекст: Этап 0 дал каркас админки с заглушками. Нужны реальные метрики сервера + логи для вкладки Server.
- Решения:
  - **gopsutil/v3** (pure Go) для CPU/RAM/Disk — кроссплатформенно, без CGO. CPU: `cpu.Percent(500ms)`, RAM: `mem.VirtualMemory()`, Disk: `disk.Usage(dataDir)`.dirname от SQLITE_PATH.
  - **Online count через SCAN** по `chart_sessions:*` — каждый ключ = один уникальный пользователь. Ключ `chart_sessions:<userId>` (Sorted Set с session IDs). Stale keys 少 (cleanup on register/heartbeat), для метрик достаточно точно. NOT ZCard с wildcard (не работает).
  - **ClickHouse size**: Метод `QueryRow(ctx, query, args...)` добавлен в `ClickhouseRepository` — обёртка над `conn.QueryRow()`. Если NULL/пусто → 0, не падаем. Используется `SELECT COALESCE(sum(bytes_on_disk), 0) FROM system.parts WHERE database = ?`. Сканирование в `uint64` (ClickHouse UInt64).
  - **Ring buffer логов**: 200 строк, `io.Writer` для перехвата `log.SetOutput(io.MultiWriter(os.Stderr, ringBuffer))`. Терминальный вывод сохраняется + копия в буфер. Буфер хранит уже готовые строки log.Printf — безопасно (пароли/токены не логируются в фазах 9-10).
  - **Frontend polling**: `useEffect + setInterval(3000)` с cleanup при unmount/закрытии вкладки. Sparkline — SVG polyline из последних 25 замеров (без Math.random).
- Альтернативы:
  - `math/big` для метрик — отвергнуто: gopsutil стандарт для Go, чистый Go.
  - ZCard с wildcard для online — отвергнуто: Redis не поддерживает wildcard в ZCard. SCAN — правильный подход.
  - Отдельный `online_users` SET в Redis — отвергнуто: дополнительная синхронизация, можно рассинхронизироваться с session manager.
  - Log buffer в файле — отвергнуто: memory buffer проще, быстрее, достаточно для admin метрик.
- Последствия:
  - `admin.metrics.go` содержит всю логику сбора метрик + nil-check для chRepo/rdb в тестах.
  - `admin.logbuffer.go` — переиспользуемый компонент, может быть расширен (фильтрация, уровни логирования).
  - `clickhouse.go` расширен методом `QueryRow` — теперь доступны произвольные SELECT запросы.

### [2026-06-14] Фаза 12 Этап 0: Admin Panel Shell + Security
- Контекст: Нужна админ-панель для управления сервером, БД, пользователями и биллингом. Security-critical — только для admin.
- Решения:
  - **ADR-12-01**: Tier policies хранятся в DB (`tier_policies` таблица) — не создана (Этап 2). Тарифы: Free/Pro/VIP/Admin — через колонку `role` в `users`.
  - **ADR-12-02**: History-loader через Binance Vision — реальная goroutine + job registry (Этап 3).
  - **ADR-12-03**: Billing таблицы `subscriptions` + `payments` в SQLite (Этап 4).
  - **ADR-12-04**: Server metrics через `gopsutil/v3` + `os.Stat` + ClickHouse `system.parts`, frontend polling 2-3s (Этап 1).
  - **ADR-12-05**: Design `AdminPanel.tsx` — UI/styles only, NO Math.random/localStorage/fake data.
  - **Admin rate-limit**: Redis sorted set, 30 req/min default, env-configurable `ADMIN_RATE_LIMIT_MAX`. Separate from REST rate-limit.
  - **ClickHouse client**: Passed as `*clickhouse.ClickhouseRepository` concrete type (not interface) — needs `system.parts` queries not in MarketRepository interface.
  - **Execution order**: 0→1→3→4→2 — security shell first, riskiest refactoring (session/history limits) last.
- Альтернативы:
  - Tier policies в config — отвергнуто: нужна динамическая смена через админку.
  - ClickHouse через интерфейс — отвергнуто: нет методов для `system.parts` в MarketRepository.
  - Единый rate-limit для admin — отвергнуто: admin rate-limit выше (30), чем общий REST.
- Последствия:
  - 19 admin endpoints registered behind RequireAuth + RequireRole("admin") + AdminRateLimitMiddleware.
  - `admin_actions` table + 2 indexes для audit log.
  - Frontend admin panel visible only when `role === 'admin'`; double-check inside AdminPanel component.

### [2026-06-14] Фаза 10: Профиль + тарифы
- Контекст: Фаза 9 дала auth/user/settings. Нет экрана профиля, нет REST для профиля/пароля, нет subscription данных в user.
- Решение:
  - **Subscription данные в users**: колонки `subscription_status`, `subscription_paid_at`, `subscription_expires_at` хранятся в `users`. Тариф = колонка `role` (Free/Pro/VIP/Admin). Отдельная `subscription_plan` НЕ заводится — один источник правды.
  - **Аватары**: 5 нейтральных gradient presets (`avatar-1..avatar-5`), без реальных персон. Whitelist на бэкенде. Допустим также http/https URL (≤500 символов). Храним ключ или URL — фронт маппит ключ в gradient.
  - **Смена пароля → инвалидация ВСЕХ сессий**: при смене пароля `DeleteAllUserSessions` + `clearRefreshCookie`. Причина: пароль скомпрометирован → все устройства должны перелогиниться. Технически невозможно оставить «одну» сессию (refresh определяется по cookie, не по session-id).
  - **Профиль как view, не модалка**: `currentView === 'profile'` в App.tsx. Кнопка в хедере (никнейм) → `setCurrentView('profile')`. Кнопка «Вернуться в терминал» → `setCurrentView('terminal')`.
  - **Биллинг НЕ в фазе 10**: кнопка «Активировать» → заглушка `alert()`. Реальная оплата/смена тарифа — фаза 12 (админка).
- Альтернативы:
  - Subscription как отдельная таблица — отвергнуто: на старте достаточно колонок в users, при росте — миграция.
  - Аватар-загрузка на сервер (multipart) — отвергнуто: нет storage, URL/пRESETы проще, безопаснее.
  - Смена пароля без инвалидации сессий — отвергнуто: оставляет скомпрометированные сессии активными.
- Последствия:
  - `AuthUser` на фронте расширен: avatar, createdAt, subscription* поля. Автоматически обновляется при login/refresh.
  - UserProfile — отдельный компонент, не модалка. Занимает всю область terminal view.

### [2026-06-14] Фаза 9 Этап 3: Frontend auth + user settings sync
- Контекст: Этапы 1-2 дали JWT auth + rate-limit/lockout на бэке. Нет frontend auth flow, нет user settings persistence.
- Решение:
  - **Silent-login**: при старте приложения `AuthProvider` вызывает `POST /auth/refresh`. Если refresh cookie валиден → получаем access token + user data. Не требует interaction от пользователя. Если refresh невалиден → guest mode.
  - **Auto-refresh**: таймер обновляет access token за 2 минуты до истечения (13 минут из 15). При ошибке — очистка state (logout).
  - **accessToken в памяти**: хранится в `useState` внутри `AuthProvider`, не в localStorage/cookie. При закрытии вкладки — теряется, восстанавливается через refresh.
  - **AuthUser lowercase roles**: `guest`, `free`, `pro`, `vip`, `admin` — консистентно с JWT на бэке. Старые `Guest`/`Free`/`Pro`/`VIP`/`Admin` (PascalCase) из `useAuth.ts` удалены.
  - **UserSettings sync**: для залогиненных — API (`GET/PUT /api/v1/user/settings`), debounce 500ms. Для гостя — localStorage. При логине — мерж localStorage → API (одноразово). При logout — localStorage сохраняется для следующего гостя.
  - **Modal z-index**: модалки auth на z-index 99999 (как Portal.tsx), VerifyEmailBanner на 99998 (под модалками).
  - **Google OAuth**: disabled кнопка в обеих модалках + tooltip "Скоро". Не ломает UI, показывает roadmap.
- Альтернативы:
  - Access token в localStorage — отвергнуто: XSS vulnerability, автоматически отправляется с каждым запросом.
  - Access token в cookie — отвергнуто: CSRF vulnerability, SameSite не 100% защита.
  - Refresh каждые N минут по таймеру без привязки к TTL — отвергнуто:浪费 токенов, если пользователь неактивен.
  - Settings в localStorage для всех — отвергнуто: нет синхронизации между устройствами для залогиненных.
- Последствия:
  - `features/auth/useAuth.ts` (старый localStorage-based хук) — deprecated, заменён на `AuthContext`.
  - `App.tsx` provider tree расширен: AuthProvider > UserSettingsProvider.
  - ChartHeader использует `useAuthContext()` вместо `useAuth()`.
  - Roles: все lowercase, без PascalCase.

### [2026-06-14] Фаза 9 Этап 2: Auth rate-limit/lockout + history gating + session limits из config
- Контекст: Этап 1 дал JWT auth, но нет защиты от brute-force, нет server-side history gating по тарифу, session limits были hardcoded.
- Решение:
  - **Rate-limit**: Redis sorted set sliding window. Ключи: `rl:login:{ip}:{email}`, `rl:register:{ip}`, `rl:recovery:{email}`. Лимиты из `AuthConfig`/env (10 login/5min, 5 register/hour, 3 recovery/hour). При превышении — HTTP 429 + Retry-After.
  - **Lockout**: 5 неудачных логинов → 15мин блокировка (`lockout:{user_id}`). Progressive delay перед lockout: 1→0s, 2→1s, 3→2s, 4→4s. При успехе — полный сброс (`ClearFailures`).
  - **History gating**: `maxDepthForRole()` — guest: 7d, free: 180d, pro/vip/admin: unlimited. `before` параметр (unix ms) сервер-сайд clamp к cutoff. Роль из JWT через `auth.ExtractUserFromRequest`.
  - **Session limits**: `NewSessionManager(rdb, limits)` — limits передаются из `AuthConfig.SessionLimits` (из env: `SESSION_LIMIT_GUEST/FREE/PRO/VIP`). Guest=1, Free=1, Pro=2, VIP=2, Admin=-1.
  - **Recovery**: `POST /api/v1/auth/recovery` — rate-limit, всегда OK (email enumeration protection).
  - **User role**: `"free"` (lowercase) при register — консистентность с JWT roles.
- Альтернативы:
  - In-memory rate-limit (sync.Map) — отвергнуто: не работает при нескольких инстансах, нет TTL.
  - Trust client для history gating — отвергнуто: клиент может врать, сервер доверяет только JWT.
  - Hardcoded session limits — отвергнуто: настройка без перекомпиляции через env.
- Последствия:
  - `AuthConfig` расширена (9 новых полей). `NewHandler` принимает `*AuthRateLimiter`.
  - `handleCandles` извлекает role из JWT, clamp `before` по cutoff.
  - Тесты: 43+ auth + 5 api — все PASS.

### [2026-06-14] Фаза 9: Авторизация — серверные сессии, access JWT, refresh в SQLite
- Контекст: нужна полноценная авторизация (регистрация/вход/email-верификация/роли) с безопасным хранением сессий. Фаза 4 имела заглушку `extractUserID` из query param / IP. Redis-лимиты графических сессий работали по фейковому userId.
- Решение:
  - **Серверные сессии**: refresh-токен хранится в SQLite (таблица `sessions` с хешем SHA-256), отдаётся в httpOnly + Secure + SameSite=Lax cookie. Access — короткий JWT (HS256, 15 минут) в `Authorization: Bearer` header. Access НЕ хранится в cookie/SQLite — только в памяти фронта.
  - **Ротация refresh**: при каждом использовании `POST /auth/refresh` старый refresh помечается `rotated=1`, выдаётся новый. Refresh reuse detection: если приходит уже использованный refresh (помечен rotated) — инвалидировать ВСЕ сессии пользователя, вернуть 401.
  - **modernc.org/sqlite**: чистый Go-драйвер без CGO (в отличие от mattn/go-sqlite3). Кросс-платформенная сборка (Windows/Linux/Docker). `database/sql` интерфейс тот же.
  - **Правило access-vs-refresh**: Авторизация любых запросов и WS определяется ТОЛЬКО по ACCESS-токену (JWT из `Authorization: Bearer` header; для WS — query `?token=<access>`). Refresh-cookie (pc_refresh_token) используется ИСКЛЮЧИТЕЛЬНО эндпоинтом `POST /auth/refresh`. Никакой другой эндпоинт и WS НЕ читают refresh-cookie для авторизации.
  - **Email-verification**: в dev-режиме (`EMAIL_MODE=log`) ссылка подтверждения печатается в лог, SMTP не используется. Интерфейс `EmailSender` с будущей SMTP-реализацией.
  - **Google OAuth**: за фиче-флагом `GOOGLE_OAUTH_ENABLED=false`. Только интерфейс + заглушка, эндпоинт возвращает 501 NOT_IMPLEMENTED.
  - **Валидация ввода**: email regex, password ≥ 8, nickname 2-30. Одинаковое сообщение при неверном email/пароле (не раскрывать существование аккаунта). `http.MaxBytesReader` на теле auth-запросов (4KB).
- Альтернативы:
  - mattn/go-sqlite3 — отвергнут: требует CGO (gcc), ломает сборку на Windows без MinGW.
  - JWT в cookie (access+refresh) — отвергнут: access в cookie уязвим к CSRF, SameSite не 100% защита. Access в памяти фронта + refresh в httpOnly cookie — безопаснее.
  - Полное удаление старого refresh при ротации — отвергнут: невозможно обнаружить reuse (старый токен удалён, пользователь неidentифицируем). Soft-delete (rotated=1) позволяет обнаружить reuse и инвалидировать все сессии.
- Последствия:
  - `extractUserID()` в hub.go заменён на `JWTUserIDExtractor` (парсинг JWT из Authorization header). WS подключения теперь авторизуются по access-токену.
  - `handleChartSubscribe` использует реальную роль из JWT вместо хардкода `"free"`.
  - `api.NewServer()` принимает `auth.AuthConfig` + имеет `Mux()` метод для регистрации auth-маршрутов.
  - Тесты: 33 теста (password, jwt, sqlite, handlers) — все PASS.

### [2026-06-14] Vite dev-proxy для кросс-_ORIGIN cookie

### [2026-06-14] Vite dev-proxy для кросс-ORIGIN cookie
- Контекст: фронт на `:5173`, бэкенд на `:8080` — разные origin. httpOnly cookie не работают при cross-origin (SameSite=Lax блокирует). Нужен dev-proxy для same-origin.
- Решение: Vite dev server проксирует `/api/*` и `/ws` на `http://localhost:8080` с `changeOrigin: true`. Клиент обращается к `/api/v1/auth/refresh`, Vite проксирует на бэкенд → cookie устанавливается на `localhost:5173` (same-origin). `COOKIE_SECURE=false` в dev. В продакшене оба сервиса за Caddy на одном домене — proxy не нужен.
- Альтернативы: CORS + `SameSite=None; Secure` — отвергнуто (требует HTTPS даже в dev, сложнее отладка). Отдельный домен для API — отвергнуто (избыточно для VPS).
- Последствия: frontend/vite.config.ts обновлён с `changeOrigin: true` для обоих прокси.

### [2026-06-14] Ingest @aggTrade для обоих рынков
- Контекст: live-ingest был поднят только для futures. Spot-трейды не попадали в aggregator → spot OrderBook.lastPrice = 0 → стакан пуст.
- Решение: оба рынка используют `@aggTrade`. Futures: `fstream.binance.com/market/ws/...@aggTrade`. Spot: `stream.binance.com:9443/ws/...@aggTrade`. Парсер: `tradeID = msg.AggregateTradeID` для обоих. Spot-ingest worker запущен в main.go, тот же tradesCh.
- **КРИТИЧЕСКИ ВАЖНО**: Futures WS URL требует префикс `/market/ws/` (`wss://fstream.binance.com/market/ws/{symbol}@aggTrade`). Spot URL использует `/ws/` без префикса (`wss://stream.binance.com:9443/ws/{symbol}@aggTrade`). Причина: Binance futures и спот WS эндпоинты имеют разную структуру URI. Удаление `/market/` из futures URL приводит к silently reconnect loop без данных. Не менять эти URL.
- Альтернативы:
  - Spot на `@trade` (индивидуальные трейды) — отвергнуто: единый формат @aggTrade проще, тесты/парсер едины.
  - Два tradesCh (futures/spot) — отвергнуто: aggregator мультирыночный по trade.Market, один канал достаточно.
- Последствия: model.Trade получил `Market`/`Symbol` поля. Aggregator ведёт per-symbol:market candle buffers.

### [2026-06-14] Aggregator мультирыночный: candleState per symbol:market
- Контекст: aggregator хардкодил "BTCUSDT"/"futures" в Run/processTrade/FlushCandle. Spot-трейды попадали бы в futures-буферы.
- Решение: `Run()` хранит `map[string]*candleState` по ключу `BookKey(symbol, market)`. Каждый symbol:market имеет свои currentCandleOpen, live, lastUpdateTime. FlushCandle вызывается для каждого активного по границе минуты. Live candles → `tableForMarket(market)`: futures → clusters_futures, spot → clusters_spot.
- Альтернативы:
  - Два отдельных aggregator instance — отвергнуто: лишняя сложность, общий tradesCh.
  - Один state с проверкой market — отвергнуто: невозможно вести две свечи параллельно.
- Последствия: spot/futures live-данные полностью изолированы. Rollup для каждого рынка отдельно.

### [2026-06-14] LastPrice в OrderBook: питается из aggregator trade-потока
- Контекст: `LiveDOMBroadcaster.broadcastAll()` пропускала все тики (`centerPrice <= 0`). `OrderBook.lastPrice` был всегда 0 — `SetLastPrice()` нигде не вызывался в production-коде.
- Причина: Binance depth stream (`@depth`) содержит **только лимитные ордера** (bids/asks), но **НЕ содержит цену последнего трейда**. Depth-события обновляют bids/asks, но не меняют lastPrice.
- Решение: `aggregator.processTrade()` вызывает `ob.SetLastPrice(trade.Price)` при каждом трейде. Aggregator хранит `orderBooks map[string]LastPriceSetter` (interface — избегает import cycle aggregator→depth). Общий инстанс `*depth.OrderBook` передаётся из main.go через `agg.SetOrderBooks()`.
- Альтернативы:
  - Depth-sync подключается к `@trade`/`@aggTrade` параллельно — отвергнуто: лишнее WS-соединение, дублирование логики.
  - Отдельный trade-stream goroutine — отвергнуто: aggregator уже обрабатывает trades, проще расширить его.
- Последствия: `BookKey(symbol, market)` унифицирован для aggregator, depth-sync, snapshotter, livedom. Проверка `ob, ok := a.orderBooks[key]; ok` — нет паники при отсутствии OrderBook.

### [2026-06-14] Depth-sync OrderBook: sync.RWMutex, не atomic/copy
- Контекст: depth-горутина пишет на каждое WS-событие (~100-500/сек), snapshotter и liveDOM читают ~1/сек. Нужна потокобезопасность.
- Решение: `sync.RWMutex`. Depth пишет (write lock), snapshotter/liveDOM читают (read lock). `lastPrice` хранится под тем же RWMutex (проще, чем atomic.Float64 через math.Float64bits). Contention минимальный: 2 reads/сек vs 100+ writes/сек, write операции быстрые (map assign/delete).
- Альтернативы:
  - `atomic.Float64` для `lastPrice` — отвергнуто: в Go нет встроенного atomic.Float64, requires math.Float64bits/Float64frombits + atomic.Uint64. Сложнее, без преимуществ.
  - Copy-on-read (полная копия maps на каждое чтение) — отвергнуто: избыточно при 2 reads/сек, 16KB копирований/сек незначительны.
  - `atomic.Value` для всего OrderBook — отвергнуто: нужна атомарность bids+asks+lastUpd together.
- Последствия: depth writes блокируют reads на microseconds (map assign), не критично.

### [2026-06-14] DOM snapshot timing: futures через CandleCloseCh, spot по таймеру
- Контекст: снапшот должен быть point-in-time на закрытие свечи. Futures: aggregator делает FlushCandle на границе минуты. Spot: нет live 15m candle close (rollup идёт из 1m, не в реальном времени).
- Решение: `CandleCloseCh` канал от aggregator → snapshotter. Futures: снапшот при каждом сигнале (каждую минуту). Spot: таймер проверяет `minute%15==0 && second==0`. Spot snapshot НЕ привязан к несуществующему 15m close сигналу — работает по wall clock.
- Альтернативы:
  - Отдельный таймер и для futures — отвергнуто: дублирование логики, нет гарантии синхронизации с FlushCandle.
  - Snapshot в aggregator после FlushCandle — отвергнуто: нарушает разделение обязанностей, aggregator не должен знать про DOM.
- Последствия: futures DOM-снапшоты точно привязаны к закрытию минутных свечей. Spot — по времени.

### [2026-06-14] Live DOM: WS push 1/сек, не REST polling
- Контекст: N клиентов × REST polling 1/сек = нагрузка. Уже есть WS hub infrastructure.
- Решение: `LiveDOMBroadcaster` goroutine, раз в секунду рассылает `dom_update` всем подписчикам активного символа. Channel key: `dom:{symbol}:{market}`. Фильтрация ±5% от `lastPrice` ПЕРЕД отправкой (не слать 1000 уровней).
- Альтернативы:
  - REST polling 1/сек — отвергнуто: N запросов/сек, латентность.
  - WS push на каждый depth diff — отвергнуто: слишком много сообщений, 250ms diffs × N символов.
- Последствия: экономия трафика и RAM на 8GB сервере. 1 push/сек на клиента.

### [2026-06-14] F&G: fetch каждые 60 мин, cache TTL 24h, fallback
- Контекст: alternative.me бесплатный, может быть недоступен. Нужна устойчивость.
- Решение: `FNGFetcher` fetch каждые 60 минут (дешевле перестраховаться). Redis hash `fng:current` с TTL 24h. При старте — fetch. При ошибке fetch — fallback на кэш. REST `/api/v1/fng` читает из кэша, если кэша нет — fetch напрямую.
- Альтернативы:
  - Fetch раз в 24h — отвергнуто: при падении в 00:00 данные протухнут до следующего дня.
  - Fetch на каждый запрос — отвергнуто: rate limiting, нагрузка на внешний API.
- Последствия: данные могут быть до 60 минут задержкой от alternative.me. При полном падении — последние закэшированные.

### [2026-06-14] Symbol config: единый `config/symbols.go`
- Контекст: хардкод `BTCUSDT`/`futures` в aggregator.go, main.go. Depth-sync/snapshotter нужна та же конфигурация.
- Решение: `config/symbols.go` — `SymbolConfig` с `Symbol`, `Market`, `PriceTick`, `BaseLevel`, `SnapInterval`. Методы: `CompressionConfig()`, `DOMTable()`, `Key()`. `DefaultSymbols` slice + `SymbolMap()` helper.
- Альтернативы:
  - JSON/YAML конфиг файл — отвергнуто: на старте project, достаточно Go-констант.
  - Админка/БД — отвергнуто: избыточно для 2 символов на старте.
- Последствия: aggregator, depth-sync, snapshotter, livedom берут конфиги из одного источника.

### [2026-06-14] InsertDOMSnapshotBatch: параметр table
- Контекст: хардкод `clusters_futures_dom`. Spot DOM-снапшоты писались бы в futures таблицу.
- Решение: `InsertDOMSnapshotBatch(ctx, rows, table string)`. Аналогично `InsertClusterBatch`. `config.SymbolConfig.DOMTable()` возвращает имя таблицы.
- Альтернативы: отдельный метод `InsertSpotDOMBatch` — отвергнуто (дублирование).
- Последствия: repository interface изменён. Все callers обновлены.

### [2026-06-13] Rollup: 15m/30m добавлены, GetLatestCandles: market + before
- Контекст: Spot timeframes = [15m, 30m, 1h, 4h] в фронте, но rollup генерировал только 1h/4h/1d. API `GetLatestCandles` хардкодил `clusters_futures` (spot невидим) и `before` фильтровал client-side (historical пустой).
- Решение: (1) `AlignToTimeframe` + `Rollup()` расширены на 15m/30m. (2) `GetLatestCandles` принимает `market` (table selection) и `before *int64` (server-side `WHERE candle_open < toDateTime64(?, 3)`). (3) `validTimeframes` + `30m`. Spot: [15m, 30m, 1h, 4h], futures: [1m, 5m, 15m, 30m, 1h, 4h].
- Альтернативы:
  - Отдельный метод GetCandlesBefore — отвергнут (лишний метод, один GetLatestCandles с optional before проще)
  - Client-side фильтрация before — отвергнуто (не работает для historical: latest N = live данные, все >= before)
- Последствия: live aggregator автоматически генерирует 15m/30m (через Rollup). Loader Summary показывает все 6 timeframes.

### [2026-06-13] Canvas lifecycle: хранить ссылки, удалять вручную, не querySelector
- Контекст: при смене timeframe Engine пересоздаётся (destroy + new). `AxisRenderer.destroy()` и `ClusterTextOverlay` не удаляли canvas из DOM, `app.destroy(true)` в PixiJS v8 ломается (v7 API) → мёртвые canvas оставались в container. `container.querySelector('canvas')!` при новом init находил старый canvas → InteractionManager на мёртвом canvas → freeze.
- Решение: (1) Renderer хранит `pixiCanvas` ссылку, `getPixiCanvas()` возвращает её. Engine.init() использует `renderer.getPixiCanvas()!` вместо `querySelector('canvas')!`. (2) Все canvas удаляются вручную при destroy: `pixiCanvas.remove()`, `axisRenderer.canvas.remove()`, `clusterTextOverlay.canvas.remove()`. (3) `app.destroy()` вызывается без аргументов (v8 API).
- Альтернативы:
  - querySelector с фильтром по pointer-events — отвергнуто (хрупко, зависит от CSS)
  - Очистка container.innerHTML — отвергнуто (агрессивно, может удалить не-наши элементы)
- Последствия: после смены ТФ ровно 3 canvas в DOM. Drag/zoom работают сразу.

### [2026-06-13] Candle interval: берётся из timeframe, не хардкод 60000
- Контекст: `Scales.timeToScreen()` делил `(timestamp - firstTimestamp) / 60000` — хардкод 1 минуты. Для не-1m ТФ (1h, 4h, 1d, spot 15m/30m) все свечи рендерились far right, viewport недостижим. Живые 1m работали только потому, что 60000 совпадало с реальным интервалом.
- Решение: `Scales.candleIntervalMs` — поле, устанавливаемое через `setCandleInterval(ms)`. Интервал берётся из `TIMEFRAME_INTERVALS[tf]` маппинга (Engine.setTimeframe). `setData()` вычисляет интервал из первых двух свечей ТОЛЬКО как fallback если setTimeframe не был вызван (для неизвестных/кастомных ТФ). `prependData()` компенсирует offsetX для стабильного viewport при догрузке.
- Альтернативы:
  - Вычислять интервал из данных всегда — отвергнуто (гепы/пропущенные свечи дают неверный интервал).
  - Передавать interval из React пропсов — отвергнуто (Engine не должен знать о React, timeframe уже есть в ChartContainer).
- Последствия:
  - Все ТФ (1m..1w) рендерятся корректно.
  - AxisRenderer рисует time labels из реальных candle timestamps, не фейковых Date.now().

### [2026-06-13] ClickHouse database: явный параметр в New()
- Контекст: `.env` содержит `CLICKHOUSE_DB=procluster`, но `clickhouse.New()` не принимал database → always `"default"`. Aggregator и loader писали в разные базы.
- Решение: `clickhouse.New(ctx, dsn, user, password, database string)`. Все callers передают `getEnv("CLICKHOUSE_DB", "default")`.
- Альтернативы: UseDatabase() после создания — отвергнуто (можно забыть вызвать, неявно).
- Последствия: CLICKHOUSE_DB читается из .env, применяется во всех подключениях. Старые данные в `default` можно игнорировать.

### [2026-06-13] Rollup grouping: bucket key = (aligned time, price level)
- Контекст: `AggregateForTimeframe` группировал по `PriceLevel` без привязки к границе ТФ. Все 1m свечи одного priceLevel за день мёрджились в одну строку (1h=1 строка вместо ~24).
- Решение: `AlignToTimeframe(t, tf)` — truncate time к границе интервала (1h→hour start, 4h→4h block, 1d→midnight). Bucket key = `(alignedTime, priceLevel)`. OHLC: open от earliest, close от latest по CandleOpen. Результат сортируется по (CandleOpen, PriceLevel).
- Альтернативы: Группировка в SQL (GROUP BY toStartOfInterval) — отвергнута (агрегация в Go, не в CH, чтобы не дублировать live/history).
- Последствия: rollup_test.go с 8 тестами покрывает все сценарии. Aggregator вызывает ту же `aggregation.Rollup()`.

### [2026-06-13] AggregateForTimeframe: volumes обнуляются при создании bucket
- Контекст: при `existing = &copy; row` volumes копировались из строки, затем `existing.BidVolume += row.BidVolume` добавлял ещё раз → double-counting.
- Решение: создавать `&model.ClusterRow{}` с нулевыми volumes, accumulate через `+=`.
- Альтернативы: пропускать `+=` для первого row — сложнее, error-prone.
- Последствия: все тесты rollup PASS, volumes корректны.

### [2026-06-13] Идемпотентность history-loader: DELETE перед INSERT
- Контекст: повторная загрузка того же диапазона дат не должна дублировать данные в ClickHouse. Два варианта: ReplacingMergeTree (автоматическая дедупликация при merge) или предварительная очистка диапазона.
- Решение: **DELETE перед INSERT**. Перед вставкой 1m данных за день выполняется `ALTER TABLE clusters_* DELETE WHERE symbol=? AND timeframe='1m' AND candle_open>=? AND candle_open<=?`. Затем INSERT. Для rollup (1h/4h/1d) — аналогично: DELETE + INSERT. Это проще, предсказуемее, не требует миграции ENGINE (MergeTree → ReplacingMergeTree) и версионной колонки.
- Альтернативы:
  - ReplacingMergeTree — отвергнута: требует миграции существующих таблиц, добавления версионной колонки, сложнее отлаживать, merge происходит асинхронно (данные могут дублироваться между merge-циклами).
  - INSERT ... ON DUPLICATE KEY UPDATE — не поддерживается ClickHouse.
- Последствия:
  - Loader идемпотентен: повторный запуск перезаписывает данные без дублей.
  - DELETE в ClickHouse — async background merge, не блокирует чтение.
  - Для live-агрегатора не нужно: он пишет по закрытии минуты, дублей нет.

### [2026-06-13] InsertClusterBatch с параметром table
- Контекст: `InsertClusterBatch` был хардкод на `clusters_futures`. Spot-данные писались в ту же таблицу — неверно.
- Решение: добавлен параметр `table string` в `InsertClusterBatch(ctx, rows, table)`. Агрегатор передаёт `tableForMarket(market)`, loader — `clusters_futures`/`clusters_spot` явно.
- Альтернативы: отдельный метод `InsertSpotBatch` — отвергнут (дублирование кода, интерфейс раздувается).
- Последствия: repository.MarketRepository интерфейс изменён. Все вызовы обновлены.

### [2026-06-13] Rollup вынесен в aggregation/rollup.go
- Контекст: `aggregator.rollup()` и `aggregator.aggregateForTimeframe()` были в aggregator.go. History-loader нужен тот же rollup — дублировать запрещено (MEMORY.md: единый модуль агрегации).
- Решение: функции перенесены в `aggregation/rollup.go` как `Rollup(rows)` и `AggregateForTimeframe(rows, tf)`. Aggregator и loader вызывают `aggregation.Rollup()`.
- Альтернативы: оставить в aggregator и вызывать из loader через aggregator — отвергнута (лишняя зависимость от Redis/aggregator, loader не использует Redis).
- Последствия: единый модуль для live, истории и будущего API.

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

### [2026-06-14] Фаза 12 Этап 3: Ticker Registry + Default Compressions + History-Loader
- Контекст: Тикеры захардкожены в config.SymbolMap() (BTCUSDT×2). Default compressions не существуют. History-загрузки с Binance Vision нет.
- Решения:
  - **Ticker Registry**: Тикеры хранятся в SQLite (tickers table). CRUD через admin API. SeedDefaultTickers создаёт BTCUSDT если БД пуста. SymbolConfigsFromTickers конвертирует []Ticker→map[string]SymbolConfig для main.go. Variant A: изменения生效 после рестарта.
  - **Default Compressions**: Хранятся в SQLite (default_compressions table, UNIQUE на symbol+market+timeframe). Глобальные для всех пользователей. ValidateCompressionMultiplier проверяет multiplier ≥ base compression (чтобы не было мульти-агрегации). Тарифные лимиты отложены на Этап 2.
  - **History-Loader**: HistoryClickHouse interface (не импортирует clickhouse пакет — избегает цикла). JobRegistry в памяти + SQLite (download_jobs) для выживания при рестарте. StartDownload запускает goroutine (не блокирует HTTP). CSV с Binance Vision парсится, 1m свечи агрегируются через CompressTrades+Rollup, вставка идемпотентная (DeleteClustersByRange перед InsertClusterBatch). Сервер не падает при ошибках скачивания.
  - **main.go refactor**: Hардкод ingest.New("BTCUSDT",...)×2 заменён на цикл по тикерам из БД. Seed при старте.
- Альтернативы:
  - Live hot-reload тикеров (отвергнуто — сложно, restart вариант A достаточен на старте).
  - Compressions в Redis (отвергнуто — SQLite проще, нет кэширования, данные критичны для startup).
  - In-memory only download jobs (отвергнуто — теряются при рестарте, SQLite надёжнее).
  - Generic Exec() на ClickHouse (отвергнуто — DeleteClustersByRange и InsertClusterBatch уже существуют).
- Последствия:
  - `admin/tickers.go`, `admin/compressions.go`, `admin/historyloader.go` — новые файлы.
  - `admin/handlers.go` — stubs заменены на реальные реализации.
  - `auth/sqlite.go` — 3 новые таблицы в Migrate().
  - `main.go` — динамический старт ingest workers по тикерам из БД.
  - Frontend: DatabaseTab с 3-колоночным layout (tickers, compressions, history download).

### [2026-06-15] ClickHouse clusters_futures — дедупликация по price_level (TODO backend)
- Контекст: ClickHouse `MergeTree()` не дедуплицирует строки с одинаковым `(symbol, timeframe, candle_open, price_level)`. Агрегатор и загрузчик истории могут вставить дубли, которые накапливаются. На фронтенде это приводит к дублированию ClusterCell на одном price → текст bid/ask накладывается ("задвоенный x").
- Решение (пока, frontend): `apiRowsToCells` в `adapter.ts` группирует через `Map<number, ClusterCell>` и суммирует bid/ask/volume — дубли схлопываются.
- TODO backend: в `GetClustersBatch` (или на уровне агрегатора) добавить `GROUP BY price_level` с `SUM(bid_volume), SUM(ask_volume)` при запросе, чтобы бэкенд отдавал уникальные строки. Альтернатива — `ReplacingMergeTree` вместо `MergeTree` в схеме.

## Шаблон записи
### [ГГГГ-ММ-ДД] <решение>
- Контекст: почему встал вопрос.
- Решение: что выбрали.
- Альтернативы: что отвергли и почему.
- Последствия: на что влияет.
