# PROGRESS.md — журнал выполненных задач

> Claude обновляет этот файл в КОНЦЕ каждой задачи. Новые записи — сверху.
> Формат записи строго по шаблону. Это память между чатами.

### [2026-06-29] indicators(delta): убран свечной режим, режим «минимизировать», фикс сжатия, цвета

- **Контекст**: Дельта-индикатор (подвальная панель) имел режим «свечи» — он масштабировал тело/тени по
  ОБЪЁМУ (синтетика `ask=(vol+delta)/2`), а не по дельте → крошечные тела, бессмысленные тени, расходилось
  со столбиками. Истинные дельта-свечи Tiger требуют бегущей дельты по времени (в данных нет: сырые сделки
  не хранятся, cells по цене). Решение: режим свечей убрать, оставить столбики (корректная дельта Tiger) и
  доработать. Также баг: при сильном горизонтальном сжатии бары не сжимались (ширина `candleWidth-8` уходила
  в минус) и налезали друг на друга.
- **Реализация** (только фронт, знак дельты не трогали — `candle.delta` нормализован в adapter.ts):
  - `chart2d/indicators/delta.ts` + `chart2d/types.ts`: убрано `deltaPlotType`; добавлено `deltaMinimized`
    (bool, false), `deltaColorUp` (#008f24), `deltaColorDown` (#e63737). `showLabels`, `sensitivity` оставлены.
  - `chart2d/ClusterChart.tsx`: удалена свечная ветка рендера + осиротевшие мемо `maxWickValue`/
    `zoomedMaxWickValue`. Ширина бара привязана к зуму как у ценовых свечей (`barW=max(1,(xR-xL)-gap*2)`,
    `gap=candleWidth>6?1:0`) — фикс наложения при сжатии. Бары одноцветные (`fillStyle=delta≥0?up:down`,
    без обводки/полупрозрачности). Два режима: false — двунаправленно от центра (`panelHeight*0.48`); true —
    однонаправленно вверх от низа (`panelHeight*0.9`), базовая линия у низа. Y-подписи оси сделаны
    mode-aware (минимизированный: верх `+max`, центр `+max/2`, низ `0.0K`).
  - `components/IndicatorsModal.tsx`: убран select режима, добавлены 2 color-picker (вверх/вниз) + чекбокс
    «минимизировать». `i18n/dictionaries/{ru,en,kz}.ts`: +`deltaMinimized/deltaColorUp/deltaColorDown`, убран `bars`.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. Ревью планировщика (рендер, ширина, осиротевшие
  переменные, подписи оси) + UI-проверка юзером (сжатие/цвета/минимизация) — ок.
- **Деплой**: коммит в main → push. Ручной деплой на VPS. Бэкенд не трогали.

### [2026-06-29] fix(admin): поле «Название» в форме редактирования тикера

- **Контекст**: В админке (База данных) при РЕДАКТИРОВАНИИ тикера не было поля «Название» (при добавлении —
  было), поэтому отображаемое имя тикера (видно в селекторе пар на графике: Bitcoin/ETH/…) нельзя было изменить.
- **Реализация** (чисто фронт, бэкенд/API/тип уже поддерживали `name`):
  - `frontend/src/components/AdminPanel.tsx` (~стр.685–688): добавлен инпут «Название» в edit-форму сразу после
    поля symbol. `value={editForm.name ?? tk.name ?? ''}` (как у symbol — открывается с текущим именем, нетронутое
    остаётся undefined и в PUT не уходит → не затирает). Метка `t('admin.database.name')`. `handleUpdate` не менялся —
    `editForm` уже летит в `apiUpdateTicker` → `PUT /api/v1/admin/tickers/{id}` (бэкенд принимает `name`, пишет в SQLite).
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. Ревью планировщика + UI-проверка юзером — ок.
- **Деплой**: коммит `5bf4ce2` в main → push. Ручной деплой на VPS (`/root/test-v2/deploy.sh`). Бэкенд не трогали.

### [2026-06-29] indicators: новый индикатор Dynamic Levels (POC + Value Area, как в ATAS/Tiger)

- **Контекст**: Нужен оверлей-индикатор динамических уровней объёмного профиля. Аналог Dynamic Levels
  в ATAS/Tiger Trade: developing-уровни — POC и зона Value Area 70% пересчитываются накопительно на
  каждой свече от начала периода (час/день/неделя/месяц/все бары), рисуются «лесенкой», на границе
  периода — сброс. Первая версия рисовала статичный профиль на период (плоские боксы) — переделана
  на developing после сверки со скрином эталона.
- **Реализация**:
  - NEW `frontend/src/chart2d/indicators/dynamicLevels.ts`: `bucketKey` (UTC-бакет час/день/неделя
    (Thu-anchored, как cvd) /месяц/all), `computePocVa(volByPrice)` — POC + расширение 70% VA
    (алгоритм один-в-один из эталона `design-src/.../drawingRenderer.ts`, маппинг index0=высшая цена,
    VAH верх/VAL низ), `computeDynamicLevels(candles,period)` — накопительный проход по барам со сбросом
    Map на границе периода, возвращает массив `DynamicLevel{poc,vah,val,periodStart}` длиной candles.
  - `frontend/src/chart2d/indicators/{index,descriptions}.ts`: регистрация `dynamicLevelsIndicator`
    в `MODULAR_INDICATORS` + desc/details RU/EN/KZ.
  - `frontend/src/chart2d/types.ts`: поля `dl*` в `IndicatorSettings` (период, цвета/толщина/прозрачности
    POC и VA, стиль границы, тоггл VA).
  - `frontend/src/chart2d/ClusterChart.tsx`: импорт `computeDynamicLevels`, memo `dynamicLevels`,
    рендер-блок лесенкой по видимым барам (заливка VA по барам, `drawStaircase` — непрерывный path с
    уступами, разрыв пера на `periodStart`); прозрачности через `hexToRgba`, стиль границы через
    `setLineDash` (solid `[]` / dashed `[4,4]` / dotted `[1,3]`); добавлен в `overlayIndicatorIds` (легенда).
  - `frontend/src/components/IndicatorsModal.tsx`: блок настроек (select периода, color+width+opacity POC,
    color заливки/границ VA, opacity заливки/границ, select стиля линии границы, тоггл показа VA).
  - `frontend/src/i18n/dictionaries/{ru,en,kz}.ts`: ключи `indicators.set.dl*`.
- **Проверка**: `npx tsc --noEmit` exit 0; `npx vite build` exit 0. Визуал юзером — ок (как ATAS).
- **TODO**: серверная подгрузка истории под профиль — периоды неделя/месяц/все считаются только по
  загруженным свечам, при недостатке истории уровни неполные. Отложено.
- **Деплой**: коммит `8e6e5e5` в main → push. Ручной деплой на VPS (`/root/test-v2/deploy.sh`).

### [2026-06-29] i18n: доперевод фронта (ChartHeader / IndicatorsModal / описания индикаторов) RU/EN/KZ

- **Контекст**: Часть пользовательского текста была захардкожена и не реагировала на смену языка.
  Цель — весь UI-текст по выбранному языку (RU/EN/KZ). Названия индикаторов оставить англ., админку не трогать.
- **Реализация**:
  - Словари `frontend/src/i18n/dictionaries/{en,ru,kz}.ts`: +`common.on/off/delete`,
    +`chart.anomalies/controls/availablePairs/compressionBase/addFavorite/removeFavorite`,
    +большие блоки `indicators.modal.*` (~60 ключей: заголовки, табы, пресеты, ошибки, уведомления,
    fallback-описания) и `indicators.set.*` (~75 ключей: подписи настроек всех индикаторов). Все три словаря
    синхронны (493 ключа в каждом, diff пуст).
  - `frontend/src/components/ChartHeader.tsx`: тикер/рынок/интервал/аномалии/On-Off/Controls/Available Pairs/
    base/тултипы избранного → `t()`.
  - `frontend/src/chart2d/ChartToolsHeader.tsx`: захардкоженный видимый текст «Click & Drag to Pan» +
    англ. тултипы зума/масштаба → `language`-тернарники с KZ (файл `@ts-nocheck`, получает `language` пропом,
    не `t`). Статус «Подключение…» уже имел KZ.
  - `frontend/src/components/IndicatorsModal.tsx`: локализованы ВСЕ пользовательские строки (заголовок,
    плейсхолдеры, табы — отображение через `t()`, внутренние ключи-категории RU оставлены ради сравнения,
    кнопки/тултипы пресетов, бейджи, сообщения об ошибках с сохранением интерполяции `{max}/{tf}/{tier}/{name}`,
    подписи параметров всех индикаторов). Названия индикаторов не тронуты.
  - `frontend/src/chart2d/indicators/descriptions.ts`: структура → `Record<id,{desc:Record<Lang,string>,
    details:Record<Lang,string>}>`. Все 16 индикаторов переведены на EN/KZ (термины трейдинга, имена индикаторов
    англ.). Централизовано — убран `MODULAR_INDICATORS.reduce` (описания больше не берутся из модулей).
    В модалке `desc[language]/details[language]`, fallback локализован.
- **Проверка**: `npx tsc --noEmit` exit 0; `npx vite build` exit 0; ключи словарей en/ru/kz совпадают.
- **TODO**: табы используют RU-строки как стабильные внутренние id (рефактор на 'all'/'favorites'/'community'
  потребовал бы правки типа `IndicatorModule.category` + 10 модулей + сравнений — вне объёма, отложено).
  ChartToolsHeader статус-строки оставлены `language`-тернарниками (в файле нет `t`).

### [2026-06-29] ui(chart): плашка подвального индикатора — влево, компакт на мобиле

- **Контекст**: Плашка-заголовок подвальной панели индикатора («(PROCLUSTER) … » + кнопки
  стрелки/глаз/настройки/удалить) висела в правом верхнем углу, вплотную к линии-разделителю.
  Просили перенести влево, компактнее на мобиле, скрыть приставку на мобиле, отступ от разделителя.
- **Реализация** (`frontend/src/chart2d/ClusterChart.tsx`, плашка ~стр.6568–6628):
  - Перенос вправо→влево: `right:"76px"` → `left:"52px"` (44px ширина DrawingToolbar w-11 + 8px
    отступ — иначе плашка налезала на левую панель инструментов рисования).
  - Отступ от разделителя: `top: panelTopY[id] + 1` → `+ 5` (5px).
  - На мобиле скрыта приставка: `{isMobile ? meta.label.replace(/^\(PROCLUSTER\)\s+/i,"") : meta.label}`.
  - Мобайл-компакт (desktop через sm:): контейнер `gap-1 px-2 py-0.5`, label `text-[9px]`, иконки
    кнопок `w-3 h-3 sm:w-3.5`, разделитель `hidden sm:block`.
  - Логика кнопок (movePanel/onToggleVisibility/onShowIndicatorsSettings/onRemoveIndicator),
    value-ref, тема — не тронуты.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. UI-проверка юзером — ок.
- **Деплой**: коммит в main → push. Ручной деплой на VPS.

### [2026-06-29] ui(indicators): шапка карточки в 2 строки + избранные сверху

- **Контекст**: В окне индикаторов кнопки «Дефолт»/«Добавить» висели не на одной линии с
  «ТИП»/«Пресеты», а избранные индикаторы (звезда) шли вперемешку в списке «Все индикаторы».
- **Шапка карточки** (`frontend/src/components/IndicatorsModal.tsx`, Title Card ~стр. 897+):
  перестроена в 2 строки. Строка 1: заголовок (truncate) слева + чип «ТИП» справа. Строка 2:
  «Пресеты» слева + право-группа «Дефолт»+«Добавить» справа (`flex justify-between`). Объединены
  дубликаты ТИП/Пресеты (был отдельный desktop + mobile `sm:hidden` комплект) в один адаптивный
  (`h-6 sm:h-8`); `presetBtnRef` на единственной кнопке. Подписи «Не задан»/«Активно: 1 шт.»
  убраны (инфо в title кнопок). Логику (toggleActive, handleToggleAdminDefault, дропдаун) не трогали.
- **Сортировка избранного** (`IndicatorsModal.tsx`, `getAccordionIndicators` ~стр. 168): для таба
  «Все индикаторы» результат filter сортируется — избранные (`isFavorite`) первыми, остальные в
  прежнем порядке (sort стабилен, на свежем массиве — draft не мутируется). Табы
  «Избранные»/«Сообщество» и поиск не тронуты.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓ (бандл уменьшился — дубли ушли).
  UI-проверка юзером — ок.
- **Деплой**: коммит в main → push. Ручной деплой на VPS.

### [2026-06-29] feat(admin): объём БД с разбивкой ClickHouse + перенос блоков

- **Контекст**: Во вкладке «Сервер» блок «Пользователи» дублировал вкладку «Пользователи», а блок
  «База данных» логичнее во вкладке «База данных». Плюс по ClickHouse хотелось видеть не только
  суммарный размер, но разбивку (кластеры/стакан/DOM/ratio/кеш) + Redis.
- **Вкладка «Сервер»** (`frontend/src/components/AdminPanel.tsx`, ServerTab): удалены оба InfoCard —
  «Пользователи» (совсем) и «База данных» (переехал). Удалена осиротевшая функция `InfoCard`
  (`noUnusedLocals`). Метрики CPU/RAM/Disk/логи и эндпоинт /admin/metrics не тронуты.
- **Backend — новый эндпоинт по запросу** (подсчёт тяжёлый, не в общем /metrics):
  - `backend/internal/repository/clickhouse/clickhouse.go`: метод `GetTableSizes(ctx, db)` —
    `SELECT table, sum(bytes_on_disk) FROM system.parts WHERE database=? AND active GROUP BY table`.
  - `backend/internal/admin/database_usage.go` (НОВЫЙ): struct `DatabaseUsage`, `handleDatabaseUsage`,
    `getRedisMemory`. Агрегация в Go: clusters=clusters_futures+spot, dom=clusters_*_dom,
    bookDepth=bookdepth_ratio, longShort=long_short_ratio, cache=cluster_cache, total=Σвсех,
    other=total−категории (guard <0→0). SQLite=os.Stat. Redis=used_memory из INFO memory
    (префикс `used_memory:`, _rss не матчится; nil/ошибка→0). Ошибка CH→нули, ответ не валится.
  - `backend/internal/admin/handlers.go`: роут `GET /api/v1/admin/database/usage` (auth+admin+rl, таймаут 15с).
- **Frontend**: `features/admin/api.ts` — `interface DatabaseUsage` + `apiGetDatabaseUsage()`.
  Новый `DatabaseMetricsBlock` (паттерн CoverageBlock: грузит 1 раз + по кнопке «Обновить», без
  авто-polling). Размещён ПОД CompressionBlock (обёртка `flex flex-col gap-6` 2-й колонкой грида,
  колонок по-прежнему 4). i18n ключи `admin.database.dbUsage*` в ru/en/kz.
- **Verification**: `go build`/`go vet`/`go test ./internal/admin/` ✓, `npx tsc --noEmit` ✓,
  `npx vite build` ✓. Живой GET /admin/database/usage → 200, поля заполнены, Σкатегорий=clickHouseBytes,
  other=0, redisBytes>0. UI-проверка юзером — ок.
- **Деплой**: коммит в main → push. Ручной деплой на VPS.

### [2026-06-29] style(chart): альт-палитра свечей — отдельные цвета для светлой темы

- **Контекст**: Альтернативная (бело-серая) палитра японских свечей в обычном режиме (zoom out)
  использовала одни цвета на обе темы. Для светлой темы цвета границ/теней/фона падения
  смотрелись не так — нужны отдельные значения. Тёмную тему не трогать.
- **Реализация** (`frontend/src/chart2d/ClusterChart.tsx`, ~стр. 4083–4101): 6 переменных
  альт-палитры (bullFill/bullBorder/bullWick, bearFill/bearBorder/bearWick) сделаны theme-aware
  через уже доступную `isLight`. Light: фон роста #E3E3E3, граница/тень роста #2F2F2F, фон
  падения #292929, граница падения #3A3A3A, тень падения #3C3C3C. Dark: строго прежние значения
  (#E3E3E3/#909090/#9D9D9D, #665D5D/#858585/#9B9B9B). Основная (красно-зелёная) палитра и
  детальный outline (~4205) не тронуты.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. UI-проверка юзером: светлая+альт —
  ок, тёмная+альт — без изменений.
- **Деплой**: коммит в main → push. Ручной деплой на VPS.

### [2026-06-29] feat(admin): блок «Покрытие данных» в админке

- **Контекст**: В админке не было видно РЕАЛЬНОГО покрытия истории в ClickHouse — с какого
  по какое число лежат данные по тикеру+рынку+типу и есть ли дыры (простои бэка). Список
  задач загрузки показывает что качали, но не фактическое состояние БД.
- **Backend** (`backend/internal/repository/clickhouse/clickhouse.go`,
  `backend/internal/admin/handlers.go`):
  - Структура `HistoryCoverageRow` + метод `GetHistoryCoverage(ctx)`: 4 SELECT по источникам
    (clusters_futures→futures, clusters_spot→spot, bookdepth_ratio и long_short_ratio с
    `GROUP BY symbol, market`). Имена таблиц/колонок — константы в коде (не ввод юзера) →
    SQL-инъекций нет. Падение одного источника логируется, не валит остальные.
  - SQL: `toDate(min/max(T))` диапазон, `countDistinct(toDate(T))` дни с данными,
    `dateDiff('day',...)+1` длина диапазона; `missingDays = spanDays - daysWithData` (в Go,
    guard < 0 → 0). `toInt64(...)` фиксирует тип агрегатов под Scan.
  - Хендлер `handleHistoryCoverage` (таймаут 15с) + роут `GET /api/v1/admin/history/coverage`.
- **Frontend** (`frontend/src/features/admin/api.ts`, `frontend/src/components/AdminPanel.tsx`):
  - `interface CoverageRow` + `apiGetCoverage()`.
  - `dataTypeBadge` вынесен на уровень модуля (общий для HistoryBlock и CoverageBlock).
  - Новый `CoverageBlock`: таблица Тикер|Рынок|Тип|С|По|Дней|Пропусков, бейдж типа, подсветка
    строк с дырами (амбер если missingDays>0, изумруд «—» если 0), кнопка «Обновить».
  - `DatabaseTab`: грид `xl:grid-cols-4` (lg:2, база:1); порядок Тикеры → Сжатие →
    **Покрытие** → Загрузка.
- **Ограничение**: дыры считаются по ДНЯМ (день покрыт, если есть хоть одна свеча) — простой
  внутри дня не детектится. Для обзора достаточно.
- **Verification**: `go build`/`go vet`/`go test ./internal/admin/` ✓, `npx tsc --noEmit` ✓,
  `npx vite build` ✓. SQL прогнан по реальной БД `procluster` (4 источника отдают данные).
  Новый бинарь поднят на alt-порту → роут зарегистрирован (401 без авторизации), 404 на левых.
- **Деплой**: коммит в main → push. Ручной деплой на VPS.

### [2026-06-29] feat(admin): бейдж типа загрузки в «Задачи загрузки»

- **Контекст**: В админке (ЗАГРУЗКА ИСТОРИИ / Binance Vision) список задач не показывал
  ЧТО качалось — кластера, глубину стакана или long/short ratio. Поле типа уже было
  в данных (`job.dataType`), но не отображалось.
- **Реализация** (`frontend/src/components/AdminPanel.tsx`, только фронт):
  - Хелпер `dataTypeBadge(dt)` рядом с `statusColor`: маппинг тип→{label, классы}.
    `clusters`→«Кластера» (синий), `bookDepth`→«Стакан» (violet),
    `longShortRatio`→«L/S Ratio» (amber), иначе→сырой dataType (slate, fallback).
    Классы — литералы (Tailwind v4 не сканирует динамические оттенки), тема light/dark
    через `isLight`.
  - Рендер задач: `jobs.map` → блочное тело; бейдж в первой строке сразу после
    spot/futures. Статус-бейдж справа не тронут.
  - Бэкенд не трогали — `dataType` уже приходит с сервера.
- **Verification**: `npx tsc --noEmit` ✓. UI-проверка юзером — ок.
- **Деплой**: коммит в main → push. Ручной деплой на VPS.

### [2026-06-28] feat: вертикальный пан тела подвальных индикаторов (drag по телу двигает линию/бары панели)

- **Контекст**: drag по ТЕЛУ подвала (delta/cvd/rsi/bidAskRatio/longShortRatio) раньше
  панорамировал основную цену — баг. Теперь вертикальный drag по телу панели двигает
  её содержимое в пределах панели (оффсет), цена не трогается. Горизонтальный скролл
  по времени и зум правой шкалы сохранены. Только фронт. Бэкенд не трогали.

- **Сделано** (`chart2d/ClusterChart.tsx`):
  - 5 состояний оффсета `deltaOffset/cvdOffset/rsiOffset/bidAskRatioOffset/longShortRatioOffset`
    (px) + рефы `activePanelDragIdRef` (какая панель тащится) и `panelDragStartOffsetRef`
    (оффсет на момент mousedown). Хелперы `getPanelOffset/setPanelOffset/resetPanelScale`.
  - `handleMouseDown`: после проверки таймлайна — детект тела панели через тот же
    `inPanelZone` (panelTopY[id]+getPanelHeight(id)); запоминает id+стартовый оффсет.
    Обычный пан (isDragging/scrollLeft) инициализируется как прежде → горизонталь работает.
  - `handleMouseMove`: вертикаль — если `activePanelDragIdRef` задан → `setPanelOffset(start+deltaY)`
    с clamp ±getPanelHeight(id); иначе прежний `setPriceCenterOffset`. Горизонталь без изменений.
  - `handleMouseUpOrLeave`: сброс `activePanelDragIdRef`.
  - Оффсет применён в Y-хелперах: `getCvdY +cvdOffset`, `rsiYInPanel +rsiOffset`,
    `ratioYInPanel +bidAskRatioOffset`, `getLsrY +longShortRatioOffset`; delta —
    `deltaMidY = panelH/2 + deltaOffset` (все Y дельты производны от него).
  - Правые SVG-тики: хардкод-позиции получили `+offset` (delta x3, cvd x3, longShort x3,
    rsi top/bottom, bidAskRatio centre); тики через Y-хелпер уже сдвигаются сами.
  - Touch: 1 палец по телу панели = вертикальный пан панели (детект в `handleTouchStart`,
    ветка в `handleTouchMove`, сброс в `handleTouchEnd`).
  - Дабл-клик по телу панели (`handleDoubleClick`) сбрасывает оффсет в 0 и зум в 1.0.
  - Новые оффсеты добавлены в deps draw-замыкания.

- **Проверено**:
  - `npx tsc --noEmit` — чисто (EXIT 0). `npx vite build` — чисто (chunk-size warning
    пре-существующий).
  - Не сломаны: основной пан цены, горизонтальный скролл, зум правой шкалы у всех
    панелей, crosshair (правый strip обрабатывает зум отдельно от тела — конфликта нет).
  - **Живой визуал (тянуть тело каждого подвала, дабл-клик, тач) — за пользователем**
    (политика: функционал/визуал проверяет юзер сам).

- **TODO**: нет.

### [2026-06-28] feat: индикатор Long/Short Account Ratio (GLOBAL) — Фаза 3 ФИНАЛ (фронт: линия в подвале + настройки)

- **Контекст**: отрисовка линии глобального long/short account ratio в подвальной
  панели графика + настройки. Данные с бэка (`GET /api/v1/long-short-ratio`,
  массив `[{t,ratio}]`, futures-only). Образцы: CVD (линия+автомасштаб+зум),
  Bid & Ask Ratio (фетч с бэка, futures-only, «Только futures»), RSI/bidAskRatio
  (вертикальная шкала+зум). Финальная фаза 3 из 3. Бэкенд не трогали.

- **Сделано (procluster/frontend)**:
  - `features/longshort/api.ts` (новый): `fetchLongShortRatio` → `[{t,ratio}]`,
    бэр-токен опционален, символ нормализуется вызывающей стороной (replace "/").
  - `chart2d/indicators/longShortRatio.ts` (новый): `IndicatorModule` id
    `longShortRatio`, «Подвальный», defaultSettings
    `{ longShortRatioLineColor:"#a855f7", longShortRatioDisplayMode:"ratio" }`.
  - Регистрация в `chart2d/indicators/index.ts`; типы в `chart2d/types.ts`
    (`longShortRatioLineColor?`, `longShortRatioDisplayMode?: "ratio"|"longPct"`).
  - `components/IndicatorsModal.tsx`: блок настроек — селект «Режим» (Ratio/Long %)
    + color-picker «Цвет линии».
  - `chart2d/ClusterChart.tsx` (полная интеграция подвала, паттерн bidAskRatio+CVD):
    панель в `REORDERABLE_PANEL_IDS`, высота+localStorage
    (`procluster_longshortratio_panel_height`), `panelTopY`/resize-грип/ресайз;
    fetch-эффект (active && FUTURES, рефетч по symbol/market/timeframe/подгрузке
    истории, символ `toUpperCase().replace("/","")`); Map по `t===candle.timestamp`;
    режим: `longPct` → `ratio/(ratio+1)*100`, иначе сырой ratio; ЛИНИЯ (как CVD,
    непрерывная — свечи без точки пропускаются БЕЗ разрыва пути); автомасштаб по
    видимым min/max + нейтральная пунктирная (ratio=1 / 50%); состояние Scale + зум
    перетаскиванием (mouse+touch, exp(deltaY/200), clamp); правая SVG-шкала
    (top/center/bottom, формат ratio=2 знака / longPct целые %); «Только futures»
    на спотах; новые состояния добавлены в deps draw-замыкания; цвет из
    `longShortRatioLineColor`.

- **Проверено**:
  - `npx tsc --noEmit` — чисто (EXIT 0). `npx vite build` — чисто (warning о размере
    чанка — пре-существующий, не связан).
  - Парность с bidAskRatio: все 64 точки интеграции bidAskRatio в ClusterChart
    зеркально продублированы для longShortRatio; других файлов-вайтлистов нет.
  - **Живой визуал (линия/шкала/зум/режимы/цвет/спот) — за пользователем** (политика:
    функционал/визуал проверяет юзер сам; история есть за 2026-06-26 BTCUSDT).

- **Итог**: индикатор Long/Short Account Ratio готов end-to-end (Фазы 1–3):
  таблица + live-поллер + REST + бэкфилл из metrics + фронт-линия.

### [2026-06-28] feat: индикатор Long/Short Account Ratio (GLOBAL) — Фаза 2 (бэкфилл истории из metrics-дампов)

- **Контекст**: расширили существующий загрузчик истории веткой
  `dataType="longShortRatio"` (рядом с "clusters" и "bookDepth"). Только futures.
  Источник — daily metrics-дампы Binance Vision
  (`/futures/um/daily/metrics/{SYM}/{SYM}-metrics-{YYYY-MM-DD}.zip`), 5-мин сетка,
  ~288 строк/день. Таблица `long_short_ratio` и `InsertLongShortRatioBatch` — из Фазы 1.
  Фаза 2 из 3.

- **Сделано (бэкенд)**:
  - `historyloader.go`: `buildMetricsURL` (futures-only); ветка
    `downloadWorkerLongShort` (downloading → parsing → inserting, без aggregating);
    `unzipAndParseMetricsLongShort` + `parseMetricsLongShortCSV` — читает ЗАГОЛОВОК,
    находит индексы `create_time` и `count_long_short_ratio` ПО ИМЕНИ (порядок
    колонок может меняться). count_long_short_ratio = GLOBAL account ratio.
    create_time парсится как UTC. Битый/пустой ratio пропускается со счётчиком.
    Идемпотентно через ReplacingMergeTree (без pre-delete). `InsertLongShortRatioBatch`
    добавлен в интерфейс `HistoryClickHouse`.
  - `handlers.go` (handleStartDownload): `longShortRatio` добавлен в enum dataType;
    guard market=futures (иначе 400).
  - Тест-мок `mockClickHouse` дополнен методом (vet зелёный).

- **Сделано (фронт, procluster/frontend)**:
  - `AdminPanel.tsx` HistoryBlock: пункт «Long/Short Ratio» (value `longShortRatio`)
    в селекте «Что качать»; при выборе рынок фиксируется на futures (как bookDepth).
    `dataType` уже прокидывается в `apiStartDownload` — менять api.ts не пришлось.

- **Проверено**:
  - `go build` + `go vet ./internal/...` — чисто. Фронт `npx tsc --noEmit` + `npx vite build` — чисто.
  - Реальный путь (download→parse→insert→DB) прогнан временным integration-тестом
    (build-tag `manual`, удалён после): BTCUSDT за 2026-06-26 (вчерашний дамп 06-27
    ещё не опубликован Binance, 404) — распарсено **288 строк, 0 пропусков**.
  - Проверка в БД: `toDate(ts)='2026-06-26'` → **287 строк** (288-я — ts 00:00 06-27,
    попадает в следующий день), ts 00:05…23:55, **ratio 1.926–2.394** (в норме 0.5–5).
  - Чистый рестарт procluster.exe (все воркеры, миграции). На финише остановлен.

- **TODO**:
  - Фаза 3: фронт — линия индикатора Long/Short Account Ratio на графике.

### [2026-06-28] feat: индикатор Long/Short Account Ratio (GLOBAL) — Фаза 1 (бэкенд: таблица + live-поллер + API)

- **Контекст**: новый индикатор глобального long/short account ratio = отношение
  числа аккаунтов в long к числу в short. Только futures. Источник — публичный
  futures-data эндпоинт Binance `globalLongShortAccountRatio`, период 5 минут.
  Binance отдаёт ratio + доли long/short (сумма = 1), поэтому хранится ОДИН ratio:
  long% выводится точно как `ratio/(ratio+1)*100`. Фаза 1 из 3. Образец — недавний
  bid/ask ratio (bookdepth).

- **Сделано**:
  - Миграция ClickHouse `008_long_short_ratio.sql`: таблица `long_short_ratio`
    (ReplacingMergeTree, PARTITION by месяц, ORDER BY (symbol, market, ts), TTL 1 год).
    Колонки: symbol, market LowCardinality, ts DateTime64(3), ratio Decimal(18,4).
  - `model.LongShortRatio` (Symbol, Market, TS, Ratio).
  - Репозиторий: `InsertLongShortRatioBatch` (батч, идемпотентно через ReplacingMergeTree)
    и `GetLongShortRatio(symbol, market, from, to)` — параметризованный SELECT, ORDER BY ts ASC.
    Оба добавлены в интерфейс `repository.MarketRepository`.
  - Новый пакет `internal/longshort/poller.go`: live-поллер. Endpoint
    `globalLongShortAccountRatio?symbol&period=5m&limit=30`. Futures-символы берутся из
    `symbolConfigs` (как snapshotter, НЕ хардкод). Тикер 5 мин + первичный опрос на старте.
    HTTP-клиент с таймаутом 10с. Ошибки сети/HTTP логируются и не валят цикл. Остановка по ctx.
    Запущен в `main.go` рядом с воркерами (`go lsrPoller.Run(ctx)`, лог `[longshort] started`).
  - API `GET /api/v1/long-short-ratio?symbol&market&timeframe&from&to`: группирует 5-мин
    точки по бакету свечи запрошенного ТФ (AlignToTimeframe), берёт ПОСЛЕДНЕЕ значение в
    бакете (по max ts) — ratio мгновенный, не аддитивен. Ответ — массив `[{t,ratio}]`.
    Лимит истории по тарифу через `resolveHistoryDepth` (как handleCandles/bookdepth).
    Middleware RateLimit+betaGate+Auth как у `/api/v1/candles`.

- **Проверено**:
  - `go build` + `go vet ./internal/...` — чисто.
  - Чистый старт, миграция применена (`SHOW CREATE TABLE` совпадает со спекой).
  - Поллер локально ДОСТУЧАЛСЯ до Binance (direct, без прокси): 30 точек/символ для
    BTC/ETH/SOL, ratio ~2.0–2.6, без ошибок в логе.
  - REST `/api/v1/long-short-ratio` (tf=1h) вернул сгруппированные точки, last-in-bucket
    совпал с `anyLast(ratio)` в БД.
  - procluster.exe остановлен в конце (юзер запускает сам).

- **TODO**:
  - Фаза 2: бэкфилл истории из metrics-дампов (как для bookdepth).
  - Фаза 3: фронт — линия индикатора Long/Short Account Ratio.

### [2026-06-28] feat: индикатор Bid & Ask Ratio — Фаза 1 (бэкенд: таблица + живая запись + API)

- **Контекст**: новый индикатор соотношения глубины стакана bid/ask в полосах
  ±1/3/5% от цены. Только futures. Источник realtime — уже работающий сбор
  стакана (`depth/snapshotter` на закрытии минутной свечи). Формула
  `ratio = (bid − ask)/(bid + ask)`, где bid/ask — суммарный qty лимиток в стакане.
  Это СТАКАН, не проторгованный объём. Фаза 1 из 3.

- **Сделано**:
  - Миграция ClickHouse `bookdepth_ratio` (ReplacingMergeTree, PARTITION by месяц,
    ORDER BY (symbol, market, snapshot_ts), TTL 1 год). Колонки bid/ask_1/3/5 Decimal(18,1).
  - `model.BookDepthRatio`.
  - Репозиторий: `InsertBookDepthRatioBatch` (truncate объёма до 1 знака, как у DOM) и
    `GetBookDepthRatio(symbol, market, from, to)` — параметризованный SELECT, сортировка
    по snapshot_ts. Оба добавлены в интерфейс `repository.MarketRepository`.
  - `OrderBook.GetBandSums(centerPrice, pcts)` — суммы qty бидов/асков в полосах ±pct
    под RLock, без агрегации по уровням.
  - Живая запись в `snapshotter.takeSnapshot`: после DOM-снапшота собирает одну
    `BookDepthRatio` (Market=futures, SnapshotTS = CandleOpen+1мин) и пишет батчем.
    DOM-запись не тронута.
  - API `GET /api/v1/bookdepth-ratio?symbol&market&timeframe&from&to`: группирует
    снапшоты по бакету свечи запрошенного ТФ (AlignToTimeframe), суммирует bid_N/ask_N,
    считает ratio_N (знаменатель 0 → 0). Ответ — массив `[{t,r1,r3,r5}]`. Лимит истории
    по тарифу переиспользует `resolveHistoryDepth` (как handleCandles). Middleware
    RateLimit+Auth(beta)+гость как у `/api/v1/candles`.

- **Файлы**:
  - `backend/internal/repository/clickhouse/migrations/007_bookdepth_ratio.sql` (новый)
  - `backend/internal/model/model.go` (+BookDepthRatio)
  - `backend/internal/repository/clickhouse/clickhouse.go` (+2 метода, import aggregation)
  - `backend/internal/repository/repository.go` (+2 метода в интерфейс)
  - `backend/internal/depth/orderbook.go` (+GetBandSums)
  - `backend/internal/depth/snapshotter.go` (живая запись ratio)
  - `backend/internal/api/bookdepth.go` (новый handler)
  - `backend/internal/api/server.go` (регистрация маршрута)

- **Verification**:
  - `go build` ✓, `go vet` (depth/api/repository/model) ✓.
  - Старт без ошибок, `[clickhouse] migrations applied`; `SHOW CREATE TABLE` совпал со спекой.
  - Дождался 2 закрытий минутной свечи: `bookdepth_ratio` = 6 строк (BTC/ETH/SOL futures ×2),
    bid_5 ≥ bid_3 ≥ bid_1, объёмы truncate до 1 знака. count() + max(snapshot_ts) ✓.
  - API проверен вживую: 1m → 2 точки, 5m → 1 точка (корректная группировка/суммирование),
    missing `from` → HTTP 400. Ratio сошёлся с ручным расчётом.
  - procluster.exe остановлен (юзер запускает сам).

- **Заметки/непонятки**:
  - В `handleCandles` строка `role, _, _ := auth.ExtractUserFromRequest(...)` берёт ПЕРВЫЙ
    возврат (userID), хотя сигнатура `(userID, role, err)` — т.е. в `role` попадает userID.
    Залогиненные юзеры из-за этого получают «полную» историю (не falls в free=6мес).
    Зеркально повторил в `bookdepth.go` ради идентичного поведения двух эндпоинтов.
    Если это баг — фиксить надо синхронно в обоих местах (вопрос к тебе).
  - `GetBandSums` для бидов доп. ограничивает `price <= center` (асков `>= center`) —
    отсекает кросс-уровни; в чистой книге это no-op.
  - `GetBookDepthRatio` — простой SELECT без FINAL. Снапшот уникален на минуту, дублей
    в норме нет; для бэкфилла (Фаза 2) учесть ReplacingMergeTree-дедуп при перезаписи.

- **TODO**:
  - Фаза 2: бэкфилл истории `bookdepth_ratio` из depth-архивов (data.binance.vision),
    по аналогии с загрузчиком трейдов (futures). Идемпотентность через ReplacingMergeTree.
  - Фаза 3: фронт — рендер индикатора Bid & Ask Ratio (правки в `procluster/frontend`,
    НЕ в design-src).
  - Деплой на VPS (ручной: `bash /root/test-v2/deploy.sh`).

### [2026-06-28] feat(chart): вертикальная шкала + зум для подвалов RSI и Bid & Ask Ratio

- **Контекст**: у RSI и Bid & Ask Ratio не было правой шкалы значений и зума перетаскиванием
  (как у Delta/CVD). Повторён тот же паттерн. Только фронт, `ClusterChart.tsx`.

- **Сделано** (всё по образцу delta/cvd: `exp(deltaY/200)`, clamp mouse [0.01,200] / touch [0.1,2000]):
  - Состояние `rsiScale`/`bidAskRatioScale` (useState 1.0) + start-рефы + флаги drag (mouse+touch).
  - Зумленые границы (component-scope) + общие хелперы Y для канваса И SVG:
    RSI вокруг 50 — `zoomedRsiMin/Max = 50 ∓ 50/scale`, `rsiYInPanel`;
    Ratio симметрично 0 — `zoomedRatioMax = 1/scale`, `zoomedRatioMin = -max`, `ratioYInPanel` (клампит).
  - `inPanelZone`-цепочка (mouse onMouseDown + touch onTouchStart/Move/End/Cancel): ветки
    `rsi` и `bidAskRatio`.
  - Два `useEffect` движения (копии cvd) на `isDraggingRsiScale` / `isDraggingBidAskRatioScale`.
  - Канвас: RSI getRsiY → `rsiYInPanel` (линии 30/50/70 и зона движутся при зуме);
    Ratio getRatioY → `ratioYInPanel`, знак бара по сырому значению. Убраны канвас-подписи слева (+1/0/−1).
  - Правая SVG-шкала: RSI — top=`round(zoomedRsiMax)`, 70/50/30 на своих Y (70/30 только если в окне),
    bottom=`round(zoomedRsiMin)`. Ratio (новый блок) — top=`+max` (bullColor), 0.00 (серый),
    bottom=`min` (bearColor), формат 2 знака. Нулевая линия по центру осталась.
  - `rsiScale`/`bidAskRatioScale` добавлены в deps draw-замыкания.
  - Сброса масштаба у delta/cvd нет (нет dblclick) → у rsi/ratio тоже не добавлял (паритет).

- **Файлы**: `frontend/src/chart2d/ClusterChart.tsx` (state ~1018, зум-границы/хелперы после getCvdY,
  movement-effects после cvd-effect, draw RSI/Ratio ~4470/4540, inPanelZone+touch ~5140–5210,
  SVG-тики RSI/Ratio ~5490+).

- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓ (CSS @import warning — пре-existing).
  Визуал (правая шкала у RSI/Ratio, тянуть шкалу панели = зум, delta/cvd/ценовая не сломаны,
  spot → «Только futures») — за пользователем (policy: Playwright на визуал не дёргаю).

- **TODO**: — (паритет с delta/cvd достигнут).

### [2026-06-28] feat: Bid & Ask Ratio — Фаза 3 (фронт: подвал-индикатор + настройки)

- **Контекст**: финал индикатора. Подвальный индикатор по данным с бэкенда
  (`GET /api/v1/bookdepth-ratio`, массив `[{t,r1,r3,r5}]`, значения −1..+1, только futures).
  В ОТЛИЧИЕ от CVD/Delta НЕ считается из свечей — фронт только фетчит, матчит к свечам и рисует.

- **Сделано**:
  - Модуль `chart2d/indicators/bidAskRatio.ts`: IndicatorModule id `bidAskRatio`,
    label «(PROCLUSTER) Bid & Ask Ratio», type «Подвальный», описание+детали (RU). Без расчёта.
    defaultSettings: band 5 / bull #10b981 / bear #ef4444 / opacity 100.
  - Регистрация в `MODULAR_INDICATORS` (`indicators/index.ts`) → каталог, описания (`descriptions.ts`
    reduce), хранилище подхватывают автоматически.
  - Типы настроек в `chart2d/types.ts`: `bidAskRatioBand`/`Bull`/`BearColor`/`Opacity`
    (ключи с префиксом — едины для модалки и графика; «короткие» имена из ТЗ это сокращение).
  - API-клиент `features/bookdepth/api.ts`: `fetchBookDepthRatio(symbol,market,tf,from,to,token)`.
    ВАЖНО: эндпоинт отдаёт ГОЛЫЙ массив (не {ok,data}), поэтому прямой fetch (не общий `request`),
    Bearer-токен как в `hooks/useDOM.ts`. На любой ошибке → `[]` (не падает в render-loop).
  - `ClusterChart.tsx`: панель «bidAskRatio» — REORDERABLE_PANEL_IDS, высота + LS
    (`procluster_bidaskratio_panel_height`), panelTopY/resize/плашка/стрелки как у CVD/RSI.
    Фетч-эффект (active && FUTURES; from/to по min/max ts свечей; рефетч при смене
    symbol/market/tf и подгрузке истории; Abort-флаг). Матч точек к свече по `t === candle.timestamp`.
    Отрисовка: ФИКС шкала −1..+1, нулевая линия по центру, бар вверх bullColor / вниз bearColor,
    opacity; подписи оси +1/0/−1. Spot → пустой подвал с «Только futures», без падений.
    Добавил `bidAskRatioPoints`/`marketType` в deps draw-замыкания (иначе пришедшие данные
    не перерисуются — у draw нет в deps самих points-массивов, только `candles`).
  - `IndicatorsModal.tsx`: блок настроек для `bidAskRatio` — select «Диапазон» (±1/3/5%),
    color-picker «Цвет bid» и «Цвет ask», слайдер «Прозрачность».

- **Файлы**:
  - `frontend/src/chart2d/indicators/bidAskRatio.ts` (новый)
  - `frontend/src/chart2d/indicators/index.ts`, `frontend/src/chart2d/types.ts`
  - `frontend/src/features/bookdepth/api.ts` (новый)
  - `frontend/src/chart2d/ClusterChart.tsx`, `frontend/src/components/IndicatorsModal.tsx`

- **Verification**:
  - `npm run build` (tsc + vite) ✓ без ошибок (CSS @import warning — пре-existing, не связан).
  - Визуал/функционал (вкл. индикатор на BTCUSDT futures, гистограмма −1..+1, смена 1/3/5%
    и цветов, 1m/5m+, spot → «Только futures», консоль) — за пользователем (по policy
    Playwright не дёргаю на визуал; backend сейчас остановлен).

- **Заметки/непонятки**:
  - Значение в плашке подвала (`--`) к crosshair НЕ привязано (минимизация правок в большом
    ClusterChart). Можно дописать позже (как cvd/rsi value-span).
  - История из Фазы 2 — суб-минутная (см. запись Фазы 2): на 1m точки лягут в :04/:31, на 5m+ ок.
    Совпадение live/история на 1m требует выравнивания snapshot_ts (см. TODO).

- **TODO**:
  - spot bookDepth (сейчас futures-only) + long/short ratio — отдельными задачами.
  - Мелочь: выравнивание live snapshot_ts на минуту (консистентность 1m live↔история).
  - Привязать значение подвала к crosshair.

### [2026-06-28] feat: Bid & Ask Ratio — Фаза 2 (бэкфилл истории глубины)

- **Контекст**: бэкфилл `bookdepth_ratio` из дампов data.binance.vision. НЕ новый
  загрузчик — расширен существующий выбором «что качать» (dataType). Только futures.
  Источник: `.../futures/um/daily/bookDepth/{SYM}/{SYM}-bookDepth-{YYYY-MM-DD}.zip`,
  CSV `timestamp,percentage,depth,notional`. depth — кумулятивная глубина до ±N% от mid.

- **Сделано (бэкенд)**:
  - `DownloadJob.DataType` ("clusters"|"bookDepth", дефолт clusters). Колонка `data_type`
    в SQLite `download_jobs` (+ идемпотентный ALTER для старых БД). CreateJob — вариадик
    `dataType ...string` (старые вызовы не сломаны).
  - `buildBookDepthURL` (futures-only). `downloadWorker` ветвится: bookDepth → новый
    `downloadWorkerBookDepth` (downloading → parsing → inserting, без aggregating; clusters
    путь не тронут).
  - `parseBookDepthCSV`: группировка строк по timestamp, маппинг percentage → полоса
    (-1/-3/-5=bid, 1/3/5=ask), одна `model.BookDepthRatio` на timestamp. Неполные минуты
    (нет всех 6 полос) — пропуск со счётчиком. Незнакомые percentage — игнор. Объём
    truncate до 1 знака на вставке (InsertBookDepthRatioBatch). timestamp понимает epoch
    ms/sec и "YYYY-MM-DD HH:MM:SS".
  - Идемпотентность — ReplacingMergeTree (повтор диапазона перезаписывает по ключу
    symbol,market,snapshot_ts), без delete.
  - `InsertBookDepthRatioBatch` добавлен в интерфейс `HistoryClickHouse` (+ в тест-мок).
  - `handleStartDownload`: валидация `dataType` (enum, пусто→clusters); bookDepth+market≠futures
    → 400. Проброс в CreateJob + audit log.

- **Сделано (фронт, procluster/frontend)**:
  - `AdminPanel.tsx` HistoryBlock: StyledSelect «Что качать» (Кластера/Глубина стакана);
    при bookDepth рынок фиксируется на futures (spot убирается из опций). dataType уходит в запрос.
  - `features/admin/api.ts`: `dataType` в `DownloadJob` и `apiStartDownload`.

- **Файлы**:
  - `backend/internal/admin/historyloader.go` (DataType, bookDepth worker, парсер)
  - `backend/internal/admin/handlers.go` (валидация dataType)
  - `backend/internal/admin/historyloader_test.go` (мок +InsertBookDepthRatioBatch)
  - `backend/internal/admin/historyloader_bookdepth_integration_test.go` (новый, gated BOOKDEPTH_IT=1)
  - `frontend/src/components/AdminPanel.tsx`, `frontend/src/features/admin/api.ts`

- **Verification**:
  - `go build` ✓, `go vet ./internal/admin/` ✓. Фронт `tsc --noEmit` ✓, `vite build` ✓.
  - Интеграционный прогон реального воркера (BOOKDEPTH_IT=1) за 2026-06-26: download→parse→insert
    job=completed. ClickHouse: **2880 строк** за день (00:00:04–23:59:31), 0 нарушений
    bid5≥bid3≥bid1 / ask5≥ask3≥ask1. Старт бэкенда чистый, ALTER data_type без ошибок.
  - procluster.exe остановлен (юзер запускает сам).

- **⚠️ Расхождение (нужно решение к Фазе 3)**:
  - Дампы Binance bookDepth идут с шагом ~30 сек (2 строки/мин) и timestamp НЕ на границе
    минуты (00:00:04, 00:00:31...) → **2880 строк/день, а не ~1440** как ожидалось в ТЗ.
    Реализация буквально по спеке (одна строка на timestamp).
  - Live-путь (Фаза 1) пишет 1 строку/мин, snapshot_ts на границе (candleOpen+1мин).
    История — сырой суб-минутный ts. В API (`AlignToTimeframe` для 1m НЕ обрезает) это
    значит: на 1m история даст ~2 точки/мин в :04/:31, live — 1 в :00. Для 5m+ группировка
    корректна. Ratio нормирован (scale-invariant), значения в норме.
  - Варианты на Фазе 3: (а) оставить суб-минутную историю как есть и решать на фронте;
    (б) даунсемплить историю до минуты под live-конвенцию (snapshot_ts=минута+1, дедуп
    ReplacingMergeTree). Жду решение.
  - Тест-файл `*_integration_test.go` хардкодит dev-пароль ClickHouse (`clickhouse`,
    задокументирован в CLAUDE.md), gated — в обычном go test/vet пропускается. Удалить, если не нужен.

- **TODO**:
  - Фаза 3: фронт-индикатор Bid & Ask Ratio (рендер r1/r3/r5).
  - Решить расхождение гранулярности/выравнивания истории vs live (см. выше).
  - spot bookDepth (сейчас futures-only) + long/short ratio — отдельными задачами.

### [2026-06-28] fix(api): тариф-лимит истории читал userID вместо role

- **Корень**: `auth.ExtractUserFromRequest` имеет сигнатуру `(userID, role, err)`, но в
  `handleCandles` и `handleBookDepthRatio` первый возврат читался в `role` → туда попадал
  userID, тариф не матчился, `maxDepthForRole` падал в default (-1 = безлимит). Итог: любой
  залогиненный юзер (включая free) получал безлимитную историю.
- **Фикс**: взять ВТОРОЙ возврат — `_, role, _ := auth.ExtractUserFromRequest(...)` в обоих
  местах. Логика `if role == "" { role = "guest" }` сохранена (гость по-прежнему "guest").
- **Файлы**: `backend/internal/api/candles.go`, `backend/internal/api/bookdepth.go`.
- **Verification**: `go build` ✓, `go vet ./internal/api/` ✓. procluster.exe остановлен.

### [2026-06-27] perf(api): gzip-сжатие ответов

- **Контекст**: тяжёлые JSON (clusters-batch на 30m+/мелком шаге до ~2.9 МБ) летели несжатыми — упор в передачу+парсинг. nginx на VPS /api не жмёт.
- **Сделано**: gzip-middleware в `server.go`, обёрнут внешним слоем `Handler: gzipMiddleware(mux)` → покрывает все /api. stdlib `compress/gzip`, без новых зависимостей. На данные не влияет (lossless), только транспорт.
- **Детали**: `/ws` пропускается БЕЗ обёртки (gzip ломает WebSocket upgrade/hijack); если клиент без `Accept-Encoding: gzip` — passthrough; иначе ставим `Content-Encoding: gzip` + `Vary: Accept-Encoding`, удаляем `Content-Length` (chunked). `gzipResponseWriter` создаёт gzip.Writer лениво на первый Write (204/OPTIONS без тела не плодят байт), `sync.Pool` для writer'ов (hot-path без аллокаций). writeJSON Content-Length не ставит — конфликта нет.
- **Файлы**: `backend/internal/api/server.go`.
- **Verification**: `go build ./...` ✓, `go vet ./internal/api/...` ✓. На проде: Response Headers `Content-Encoding: gzip` у candles/clusters-batch, transferred кратно меньше (2.9МБ→~300-500кБ); /ws живой; данные без изменений.
- **Итог**: роадмап оптимизации загрузки закрыт (свечи+кэш, code-split, gzip; гонка кластеров и 401-конфиг пофикшены).

### [2026-06-27] fix(chart): интермиттентный 401 на /tickers,/compressions — гейт конфига по auth-ready

- **Контекст**: ~1 из 10 свежих загрузок сжатие падало на минимум (25) на всех ТФ, плашки «рекомендуемое» нет. В Network — `/tickers` и `/compressions` 401, кластеры на min-шаге (через grace).
- **Корень**: `apiRefresh()` (access-токен по refresh-куке) в AuthContext асинхронный и не дожидается. Конфиг-фетчи (loadTickers→/tickers, adminDefaults→/compressions) стартовали на маунте при `accessToken=null` → запрос без Authorization → beta-gate 401. Ретрай по accessToken спасал ~90%, остальное падало на фоллбэк-сжатие (resolveCompression→1).
- **Фикс** (`ChartControlsContext.tsx`): взят `loading` из `useAuthContext()` как `authLoading`; оба конфиг-эффекта гейтятся `if (authLoading) return` + `authLoading` в deps. Фетч стартует только когда `apiRefresh()` осел (токен есть ИЛИ гость подтверждён) → tokenless-запрос исключён конструктивно. Ретрай по accessToken, terminal-флаги на success, grace 3s, isChartReady — сохранены.
- **Файлы**: `frontend/src/contexts/ChartControlsContext.tsx`.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. Браузер (Disable cache + Slow 4G, много резетов): `/tickers`,`/compressions` 200, сжатие = админ-дефолт сразу, без 401/падения на 25.
- **TODO (косметика)**: устаревший коммент у `tickersFetched/adminDefaultsFetched` (пишет «flip on success/failure», по факту только success). `settings 500` — отдельная серверная ошибка (похоже холодная SQLite после рестарта), не трогали.

### [2026-06-27] fix(chart): «мессиво» добито — гейт кластеров по СОШЕДШЕМУСЯ сжатию

- **Контекст**: после гейта `configReady` мессиво всё равно возвращалось при СМЕНЕ ТФ (и иногда на перезагрузке). В Network снова два `clusters-batch` — `priceStep=2.5` (мин, ~3.7МБ) и правильный.
- **Корень (глубже)**: `configReady` ждал загрузки конфига, но не РЕЗОЛВА сжатия. `adminDefaults` приходят и флипают `configReady=true`, а `slot.compression` обновляет ОТДЕЛЬНЫЙ re-resolve эффект на СЛЕДУЮЩЕМ рендере. В окно «гейт открыт, compression ещё транзиентный (1)» летел фетч на шаге 2.5; затем compression резолвился → второй фетч на правильном. На смене ТФ `configReady` (per-symbol) уже true → не держал вовсе.
- **Фикс**: новый per-slot `isChartReady(slotIndex)` = `isConfigReady(symbol)` И (явный выбор сжатия ИЛИ `slot.compression === resolveCompression(...)`). Гейтит кластеры пока сжатие не СОШЛОСЬ с финальным резолвом → ровно один `clusters-batch` на правильном шаге для старта/смены ТФ/смены сжатия. ChartContainer2 зовёт `isChartReady(chartIndex)` вместо `isConfigReady(symbol)`. `invalidateAdminDefaults` сбрасывает `adminDefaultsFetched[sym]` (ре-гейт после правки админом).
- **Файлы**: `frontend/src/contexts/ChartControlsContext.tsx`, `frontend/src/chart2d/ChartContainer2.tsx`.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. Браузер (Disable cache + throttle Slow 4G, много переключений ТФ): `priceStep=2.5` не появляется → структурное доказательство (фетч не стартует пока сжатие транзиентное). Мессива нет.
- **Итог**: гонка двойной загрузки кластеров закрыта детерминированно по всем входам (первая загрузка, смена ТФ, смена сжатия).

### [2026-06-27] fix(chart): первая загрузка — не коммитить фоллбэк-сжатие на 401

- **Контекст**: после фикса гонки (ниже) на ПЕРВОЙ загрузке мелькало сжатие 25 на всех ТФ и временно не работала дозагрузка истории; самочинилось после прихода токена.
- **Корень**: `/compressions` и `/tickers` на первой загрузке падают 401 (токен ещё не подставлен), но флаги `tickersFetched`/`adminDefaultsFetched` ставились в `.finally` ДАЖЕ на ошибке → `configReady=true` с фоллбэк-сжатием (25) до прихода токена + гейт блокировал дозагрузку.
- **Фикс** (`ChartControlsContext.tsx`): `*Fetched=true` ставится ТОЛЬКО на успех (`.then`; пустой `[]` = валидно). На ошибке флаг не ставим и кэш не пишем → effect по смене `accessToken` перезапрашивает до 200 → `configReady` ждёт РЕАЛЬНОГО админского сжатия. Бэкстоп на реальный сбой/гостя — grace-таймер в `ClusterChartAdapter.tsx` ужат 6s→3s.
- **Файлы**: `frontend/src/contexts/ChartControlsContext.tsx`, `frontend/src/chart2d/ClusterChartAdapter.tsx`.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. Браузер: первая загрузка — правильное сжатие сразу (без 25), дозагрузка работает, один `clusters-batch` на правильном шаге.

### [2026-06-27] fix(chart): «мессиво» кластеров — устранена двойная загрузка (race)

- **Контекст**: периодически поверх нормальных кластеров рисовались мелкие сырые уровни (min-шаг), FPS 2–4. Недетерминированно (race) — мог появиться и на проде, и локально после рестарта бэкенда. Не зависел от сегодняшней оптимизации (воспроизводился на откаченном коде).
- **Корень**: двойная загрузка кластеров. На старте `compression` = `1` (DEFAULT_SLOT, до гидрации настроек) → `priceStep` = минимальный → первый `clusters-batch` на min-шаге (2.9 МБ). Потом приходят settings/adminDefaults → `compression`=4 → второй `clusters-batch` на правильном шаге. Оба в deps load-эффекта (`compression`, `!!accessToken`). Какой ответ придёт последним — тот и рисуется; под задержкой побеждал мелкий → мессиво. (Гейт по `baseCompression/priceTick` был бы пустышкой — `resolveTickerConfig` всегда даёт ненулевой фоллбэк.)
- **Фикс**: гейт `configReady` = `settingsHydrated && tickersFetched && adminDefaultsFetched[symbol]` (все флаги ТЕРМИНАЛЬНЫ — true даже на ошибке/401, иначе гость завис бы). Кластеры не фетчатся пока конфиг не осел → `compression` финальный → ровно ОДИН `clusters-batch` на правильном шаге. Свечи грузятся всегда. Grace-таймер 6s — страховка от зависшего конфига. Preview (без пропа `configReady`) грузится сразу на фоллбэк-шаге.
- **Файлы**: `frontend/src/contexts/UserSettingsContext.tsx` (флаг `settingsHydrated`), `frontend/src/contexts/ChartControlsContext.tsx` (`tickersFetched`/`adminDefaultsFetched`/`isConfigReady`), `frontend/src/chart2d/ChartContainer2.tsx` (проброс `configReady`), `frontend/src/chart2d/ClusterChartAdapter.tsx` (гейт `clustersReady`, grace, guard скролл/visible, `loadKeyRef` от мигания лоадера).
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. Браузер: при сжатии ≠ минимум запрос `priceStep=2.5` больше НЕ летит (структурное доказательство — один фетч на правильном шаге, гонке нечем перетереть).
- **TODO**: проверка на проде после деплоя. Затем поочерёдно вернуть откаченные оптимизации (свечи+кэш `661772d`, code-split `d8792a9`, gzip) — каждую отдельным деплоем с проверкой.
### [2026-06-27] perf(frontend): code-splitting тяжёлых компонентов (lazy load) (ПЕРЕПРИМЕНЕНО)

- **Контекст**: после ускорения данных остался «хвост» первой загрузки — крупный JS-бандл грузил
  наперёд всем тяжёлые редко-нужные части (AdminPanel ~395кБ виден только админам, IndicatorsModal,
  RoadmapModal, UserProfile).
- **Сделано**: 4 компонента в `App.tsx` переведены на `React.lazy` + `Suspense`. AdminPanel грузится
  ТОЛЬКО при заходе в админку (не-админ чанк не качает). Модалки (Indicators/Roadmap) монтируются
  по флагу открытия → чанк грузится при первом открытии. Fallback: ChartLoader для полно-экранных
  (admin/profile), `null` для модалок.
- **Баг по пути**: seed-эффект IndicatorsModal (`prevIsOpen = useRef(isOpen)`) при ленивом монтаже
  рождался с `isOpen=true` → seed пропускался → пустой список индикаторов. Фикс: `useRef(false)`
  (no-op для старой always-mounted формы).
- **Чанки (vite build)**: AdminPanel 77.8кБ, IndicatorsModal 79.2кБ, UserProfile 23.6кБ,
  RoadmapModal 17.6кБ — все вышли из главного бандла.
- **Файлы**: `frontend/src/App.tsx`, `frontend/src/components/IndicatorsModal.tsx`.
- **Проверка**: tsc чисто, vite build ✓, браузер — список индикаторов на месте, всё грузится по клику.
- **TODO**: деплой VPS.

### [2026-06-27] perf(chart): ускорение первой загрузки — свечи без скана истории + кэш кластеров (ПЕРЕПРИМЕНЕНО после фикса гонки)

- **Контекст**: первая загрузка графика ~10с при CPU <15% (упор в I/O ClickHouse). Два REST-запроса
  (candles, clusters-batch) по 1–3с.
- **Задача 1 (свечи)**: `GetLatestCandles` переписан — подзапрос дёшево читает только `candle_open`
  (узкая PK-колонка) и находит candle_open N-й свежей свечи; внешняя агрегация идёт ТОЛЬКО по этому
  диапазону. Тяжёлые колонки больше не читаются по всей истории. `before` (скролл) сохранён,
  значения через placeholders, начальное число свечей не менялось (TF_LIMIT 500/400/300/200).
- **Задача 2 (кластеры)**: новая таблица `cluster_cache` (ReplacingMergeTree, миграция
  `006_cluster_cache.sql`). clusters-batch стал read-through: закрытые свечи берутся из кэша,
  промахи считаются из `clusters_*` и пишутся обратно. Кэшируются ТОЛЬКО закрытые свечи и ТОЛЬКО
  при админском дефолтном priceStep (`defaultPriceStep` = priceTick × default_compressions.multiplier);
  прочие priceStep — мимо кэша. Чтение через `argMax(updated_at)` (защита от гонки).
  `OR`-цепочка заменена на `candle_open IN (…)`. RAM/Redis не затронуты (кэш на диске CH, TTL 90 дней).
- **Файлы**: `migrations/006_cluster_cache.sql` (новый), `clickhouse.go`, `repository.go`,
  `api/candles.go`.
- **Verification**: `go build`/`go vet`/`go test ./internal/api/... ./internal/admin/...` ✓.
  Миграция применена в БД `procluster`. Задача 1: вывод old==new (count+cityHash) на 6 сериях
  (futures/spot, 1m..4h); read_bytes 40.6→9.3 MiB (~4.4× меньше I/O) на BTCUSDT 1m (835k строк).
  Задача 2: round-trip source↔cache бит-в-бит; дубль-вставка 56→28 строк на чтении (argMax dedup);
  OR==IN совпал. Тестовые строки из cluster_cache удалены.
- **TODO**: деплой на VPS — ручной (push в main + `/root/test-v2/deploy.sh`).
- **Примечание (переприменение 2026-06-27)**: откатывали вместе с code-split при разборе «мессива»;
  мессиво оказалось пре-existing гонкой (не от этой оптимизации). После фикса гонки + первой загрузки
  возвращаем. Миграция `006_cluster_cache.sql` — БЕЗ коммент-шапки (она роняла runner «Empty query»).

### [2026-06-26] fix(dom): объёмы size в стакане целыми числами (без центов)

- **Контекст**: в стакане (DOM ladder) size показывался с двумя знаками после запятой — центы не нужны.
- **Решение**: `level.askSize.toFixed(2)` / `bidSize.toFixed(2)` → `Math.round(...).toLocaleString()` (округление + разделитель тысяч как у цены). Цена не тронута.
- **Файлы**: `frontend/src/components/DOMSidebar/OrderBookTable.tsx` (стр.107, 160), `docs/PROGRESS.md`.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. В браузере size без десятичных (юзер подтвердил).

### [2026-06-26] fix(admin): кастомный дропдаун вместо нативного select (белое-на-белом)

- **Контекст**: в админке нативные `<select>` в тёмной теме показывали белый текст опций на белом системном popup → список не виден, пункты читались только под курсором (синяя подсветка).
- **Решение**: новый компонент `StyledSelect` в стиле существующего `UserDropdown` (motion popover, класс `muddy-glass-popover` для тёмной темы, галочка `Check` amber у выбранного). Триггер rounded-xl + ChevronDown (rotate-180). Закрытие: клик-вне + Escape.
- **Файлы**: `frontend/src/components/StyledSelect.tsx` (создан), `frontend/src/components/AdminPanel.tsx` (импорт + 3 `<select>` заменены: тикер сжатия ~стр.930, тикер истории ~стр.1081, рынок SPOT/FUTURES ~стр.1086), `docs/PROGRESS.md`.
- **Не трогали**: селекты ролей/тарифов в админке (оставлены нативными в этой задаче).
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. В браузере дропдауны читаемы в обеих темах (юзер подтвердил).
- **TODO (опц.)**: при желании перевести оставшиеся `<select>` (роли ~стр.1503/1556) на `StyledSelect` для единообразия.

### [2026-06-22] perf(chart): вынос ChartToolsHeader в React.memo-компонент (Branch A, шаг 2)

- **Контекст**: ClusterChart — монолит ~5500 строк. WS-тик (setCandles ~2/сек) вызывал ререндер всей шапки (чипы индикаторов, зум-кнопки, настройки). Branch A, шаг 2 (шаг 1 — DrawingToolbar: 44.5→75 FPS).
- **Решение**:
  - Новый файл `frontend/src/chart2d/ChartToolsHeader.tsx` (React.memo + props interface ~320 строк JSX).
  - `handleResetZoom` стабилизирован через `resetZoomDataRef` (latest-ref паттерн, candles не в deps → callback stable).
  - `handleZoom` → `useCallback([candleType])`, `handleVerticalZoom` → `useCallback([])`.
  - `onTimezoneChange`, `onToggleChartSettings` → `useCallback([])`.
  - `showWorkspaceMenu` state + `workspaceDropdownRef` + click-outside effect перенесены внутрь ChartToolsHeader (чистое владение).
  - `WORKSPACE_LAYOUTS` (id + icon) вынесены в module scope — иконки создаются один раз при загрузке.
  - `isLight: boolean` передаётся примитивом (паттерн DrawingToolbar).
  - `activePair` стабилизирован в `ClusterChartAdapter.tsx` через `useMemo([symbol, market])` — ранее пересоздавался на каждый WS-тик.
- **Файлы**: `frontend/src/chart2d/ChartToolsHeader.tsx` (создан), `frontend/src/chart2d/ClusterChart.tsx` (блок ~3963–4286 заменён компонентом, 5 useCallback + resetZoomDataRef добавлены), `frontend/src/chart2d/ClusterChartAdapter.tsx` (useMemo для activePair).
- **FPS скролл**: было ~75 FPS (после DrawingToolbar), после — **70 FPS**.
- **FPS drag-pan**: **130 FPS**.
- **Profiler**: ChartToolsHeader — 0 ререндеров на WS-тик ✓.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓ (749 ms).
- **Что закрыто**: Branch A шаг 2 (из 3).
- **TODO (следующий шаг)**: Branch A шаг 3 — мемоизация IndicatorsModal / остальные тяжёлые компоненты.
- ~~**TODO (отдельный коммит)**: `ClusterChartAdapter.tsx:344` — `onWorkspaceLayoutChange ?? (() => {})` — inline-стрелка пересоздаётся на каждый рендер. Обернуть в useCallback или вынести stable noop в module scope.~~ ✅ Закрыто коммитом `1790c27` (NOOP в module scope).

### [2026-06-22] fix(chart): FPS-счётчик не перекрывает zoom-hint (stacking context)
- **Причина**: FPS overlay (z-30) — прямой потомок root div, который не создаёт stacking context. ChartToolsHeader (z-20, backdrop-blur) тоже прямой потомок root. Оба конкурируют глобально по z-index. z-30 > z-20 → FPS рисовался поверх всего header'а включая zoom dropdown (z-50 локальный внутри header'а — за его пределы не выходит).
- **Фикс**: z-30 → z-10 на FPS overlay. Теперь header (z-20) рисуется поверх FPS.
- **Файлы**: `frontend/src/chart2d/ClusterChart.tsx`, `docs/PROGRESS.md`.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓ (1.1 s).

### [2026-06-22] style(chart): позиция/размер/z-index FPS-оверлея
- `right: margin.right + 8 = 98px` (margin.right=90, константа line 418) — счётчик левее ценовой шкалы.
- `fontSize 9px → 11px`, точка-пульс `w-1.5 h-1.5 → w-2 h-2`.
- z-index `z-50 → z-30` (zoom hint остался z-50 — перекрывает счётчик).
- Логика FPS не изменена.
- **Файлы**: `frontend/src/chart2d/ClusterChart.tsx`, `docs/PROGRESS.md`.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓ (710 ms).

### [2026-06-22] feat(chart): FPS-счётчик для админа (привязан к реальному frame())
- **Контекст**: Нужна диагностика реальной частоты рисования движка (Canvas2D draw loop), а не частоты браузерного RAF. Счётчик виден только администратору и реально падает при тормозах скролла/зума.
- **Реализация**:
  - 3 ref добавлены в `ClusterChart.tsx`: `fpsFrameCountRef`, `fpsLastTimeRef`, `fpsRef` — после `drawRef`.
  - `fpsDisplay: number | null` state — `null` = idle ("—").
  - Блок измерения (~10 строк) вставлен в самое начало `drawRef.current()` — до ранних `return`. Пересчёт каждые 500 мс, `setFpsDisplay` ≤2×/сек.
  - Idle useEffect: 1-секундный interval **только для admin**, сбрасывает display в `null` если нет кадров >1 с.
  - JSX оверлей: `absolute top-2 right-2 z-50`, emerald 9px mono, `backdrop-blur-sm`, пульсирующая точка. В DOM **только при** `userRole.toLowerCase() === "admin"`.
- **Фикс цепочки пропа**: `userRole` не доходил до `ClusterChart` — исправлено в 2 файлах:
  - `ChartContainer2.tsx`: деструктурирован `user` из `useAuthContext()`, передан `userRole={user?.role ?? ''}`.
  - `ClusterChartAdapter.tsx`: добавлен `userRole?: string` в интерфейс и деструктуризацию, прокинут в `<ClusterChart>` через `{...(userRole !== undefined ? { userRole } : {})}` (требование `exactOptionalPropertyTypes`).
- **userRole**: `AuthUser.role: string` (api.ts), backend хранит `"admin"` lower, проверка `(userRole ?? "").toLowerCase() === "admin"` — регистронезависимо.
- **Idle**: при простое >1 с отображается "— FPS".
- **Файлы**: `frontend/src/chart2d/ClusterChart.tsx`, `frontend/src/chart2d/ClusterChartAdapter.tsx`, `frontend/src/chart2d/ChartContainer2.tsx`, `docs/PROGRESS.md`.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓ (717 ms).

### [2026-06-21] perf(chart2d): D — удалён hot-path session-separator с toLocaleDateString
- **Контекст**: Реальное профилирование (monkey-patch `CanvasRenderingContext2D.prototype` + `Date.prototype.toLocaleDateString` без правок репо) показало: **~91% времени canvas-draw** уходит на `toLocaleDateString` в цикле отрисовки вертикальных разделителей суток (`~2763-2786`). Цикл сравнивал день текущей и предыдущей свечи через `d.toLocaleDateString("en-US", { timeZone })` — **75-85 µs на вызов × 2 вызова на каждую видимую свечу за кадр**. Линейный скейл подтверждён замером:

  | visible | мс/draw | toLocaleDateString | % | calls/frame |
  |--------:|--------:|-------------------:|--:|------------:|
  |     33  |     5.0 |               4.5  |90%|         67  |
  |     69  |    11.3 |              10.2  |90%|        139  |
  |    275  |  **51.5** |             46.9  |**91%**|        551  |

  Экстраполяция: **1000 visible → ~170 мс/draw**. Прочие находки (canvas-realloc, clip, save/restore, watermark, Date constructor) **опровергнуты замером** — каждая <2% кадра.
- **Решение**: пользователь подтвердил, что вертикальные разделители суток не нужны. Цикл удалён целиком вместе с `tzOpt` (использовалась только там, подтверждено grep'ом).
- **Файлы**: `frontend/src/chart2d/ClusterChart.tsx`, удалены строки `~2763-2786` (заменены 5-строчным комментарием).
- **Verification**:
  - `npx tsc --noEmit` ✓
  - `npx vite build` ✓ (786 ms)
  - Замер после удаления (тот же harness):

  | visible | мс/draw до | мс/draw после | ×ускорение |
  |--------:|-----------:|--------------:|-----------:|
  |    140  |        ~20 |       **1.64** |       12.2 |
  |    275  |       51.5 |       **~3.5** (экстраполяция, не достиг массива) | ~14× |
  |   1000  |      ~170  |       **~6** (экстраполяция, линеен) | **~28×** |

  - `toLocaleDateString` **исчез из топа** категорий draw'а (остался 1 редкий вызов на кадр из hover-overlay `formatTimezoneString`, не hot-path).
  - **FPS scroll**: было 24.5 → **77.3 / 83.1 / 71.3** FPS (медиана **77, +213%**, цель 60 FPS взята с запасом).
  - **FPS idle при WS**: 18-67 (нестабильно от WS-всплесков, диапазон сравним с предыдущим).
  - **FPS mousemove**: 44-83 (медиана ~64, без регрессии).
  - Визуально: вертикальные линии-разделители суток отсутствуют (как и задумано). Hover-бокс таймстампа продолжает показывать дату ("00:06 22.06.2026"). Время на нижней шкале корректно. Crosshair, индикаторы, скролл, зум — без регрессий.
- **Что закрыто**:
  - ✅ Главное узкое место canvas-draw устранено. Draw scaling по visible — теперь дешёвый.
  - ✅ Цель 60 FPS на скролле — достигнута (77 FPS медиана).
- **TODO (бэклог, теперь становятся видны)**:
  - Idle при WS: 18-67 диапазон — следующий шаг Branch A (memoization тяжёлых поддеревьев — Header, PriceScale).
  - canvas.width realloc guard — опционально, эффект <0.1%.
  - S4 (движок вне React) — финал.

### [2026-06-21] perf(chart2d): Branch A шаг 1 — вынос DrawingToolbar в React.memo
- **Контекст**: после R оставшийся потолок FPS — стоимость одного ре-рендера монолита ClusterChart (~160 мс на WS-тик). Шаг — отделить пере-рендер этого монолита от тяжёлых поддеревьев. Запрос пользователя был «вынести панель стакана», но **стакан уже изолирован**: `DOMSidebar` смонтирован в `App.tsx:701` как сосед `ClusterChartAdapter`, не внутри `ClusterChart`. Внутри `ClusterChart.tsx` `orderBook` фигурирует только как пропс для отрисовки баров на canvas внутри `drawRef.current` (`:3675-3748`). После согласования с пользователем цель шага 1 перенесена на **DrawingToolbar** — самые стабильные пропсы внутри JSX, не зависит от WS/scroll/курсора/цены.
- **Решение**:
  1. Новый файл `frontend/src/chart2d/DrawingToolbar.tsx` — функциональный компонент в `React.memo`. Литерал массива `DRAWING_TOOLS` объявлен на модуль-уровне, не аллоцируется на рендер.
  2. Пропсы стабильные: `activeDrawingTool`, `setActiveDrawingTool` (setState setter), `areDrawingsVisible`, `onToggleDrawingsVisibility` (useCallback), `onClearAllDrawings` (useCallback), `hasDrawings: boolean` (НЕ массив `drawings` — иначе любой `setDrawings` пробил бы memo), `isLight`, `language`.
  3. В `ClusterChart.tsx` добавлены `useCallback`-обёртки с **функциональными setState-updater'ами** (`prev => ...`), чтобы deps были пустыми — useCallback никогда не пересоздаётся.
  4. Удалён inline JSX блок (`~4357-4474`, 118 строк), заменён `<DrawingToolbar ... />`.
- **Файлы**:
  - Новый: `frontend/src/chart2d/DrawingToolbar.tsx` (~178 строк).
  - `frontend/src/chart2d/ClusterChart.tsx`: импорт + 2 useCallback + замена JSX.
- **Verification**:
  - `npx tsc --noEmit` ✓
  - `npx vite build` ✓ (1.38 s)
  - **Главная метрика — MutationObserver на поддереве DrawingToolbar за 13.5 с теста** (3×scroll + 3×idle + 3×mousemove): **0 мутаций**. React.memo пропускает ре-рендер 100%, его DOM остаётся неизменным на каждом commit'е монолита.
  - FPS-замер (BTCUSDT futures 1m, японские свечи, локальный backend, WS):

    | сценарий | R (до) | A.1 (после) |
    |----------|-------:|------------:|
    | scroll | 44.5 | 21-75 (best 75, медиана ~40, зашумлено WS) |
    | mousemove | 35-79 (медиана 52) | 65-92 (медиана ~69) |
    | idle | 74-98 | 48-88 (≈сохранён) |

    Числа имеют большой разброс из-за WS-всплесков, но **тренд положительный** на mousemove (+стабильность), scroll-best виден рост до 75. Чтобы стабилизировать — нужны следующие шаги Branch A (PriceScaleSvg, ChartHeader).
- **Что закрыто**:
  - ✅ Зашумление от WS-тика на DrawingToolbar полностью устранено (mutations=0). Каждый последующий ре-рендер монолита больше не walk'ает toolbar-поддерево.
- **TODO (Branch A продолжение)**:
  - **A.2**: `ChartHeader` (market toggle + indicator chips + controls) — много зависимостей, осторожная стабилизация.
  - **A.3**: `PriceScaleSvg` (правая шкала + drawing-горизонтали) — часть пропсов меняется на WS-тике через цену.
  - **A.4**: indicator overlays (Delta/CVD chip overlays) — уже ref-driven значения от S1, мелкий выигрыш.
  - S1.5, БФ, S4 — без изменений.

### [2026-06-21] perf(chart2d): R — снижение стоимости ре-рендера монолита (debounce scroll-state + кучу useMemo вынес в drawRef)
- **Цель этапа**: профилировка после S3 показала, что scroll выдаёт 24.5 FPS, а внутри одного React commit'а тратится ~160 мс. Кадр на скролле: рисование на canvas ~2.5 мс, draw-замыкание ~12 мс, а ~110 мс — React. Цель — снизить стоимость одного ре-рендера ClusterChart.
- **Step 0 (профилировка, без правок)**:
  - `Array.prototype.filter` патч на 1500 мс скролла: 1016 вызовов, суммарно **2 мс** — `.filter` НЕ узкое место.
  - Long-tasks ~4/сек @ avg 196 мс, median 169 мс — это throttled state-push commit'ы из S3.
  - Главный draw-loop сам — `mainDrawsPerSec` = 16.7 (rAF coalescing работает).
  - **Вывод**: ~160 мс commit'а — не аллокации (`filter`/`reduce` дешёвые), а **реконсиляция гигантского JSX** (5300 строк, монолит) + цепочки `useMemo`, которые рефаялись на каждый half-candle push (`visibleScrollLeft` state в их deps). JSX в `ClusterChart.tsx` инлайн, отдельных дочерних компонентов нет — **Branch A (мемоизация поддеревьев) не применима без крупного рефакторинга**.
- **Применено: Branch B (стабилизация useMemo) + умный throttle для scroll-state**.
  1. **Удалены 3 цепных useMemo** (`visibleCandlesList`, `visibleMaxCellVol`, `visibleMaxSingleVol` — `~1123/2288/2301`): все потребляются только внутри `drawRef.current` (нормализация cell для detailed/cluster mode). Перенесены в одно одно-проходное вычисление внутри draw-замыкания, сразу после `startIdx/endIdx`. Обёрнуто в `if (isDetailedMode)` — в японском режиме (наш бенчмарк) выполняется 0 операций. Цепочка React-mem'ов с `visibleScrollLeft` в deps удалена — на каждое throttled state-push больше нет ~30-50 мс работы внутри commit'а.
  2. **`requestScrollStateSync` переведён на pure-debounce** (`~609-633`). Раньше `half-candle move` пушил state немедленно (≈3 setState/сек на скролле → 3 commit'а × 160 мс = 480 мс блокировки/сек, именно это и съедало FPS). Теперь: **ноль setState во время непрерывного скролла**; через 100 мс после остановки — debounced flush. Сохраняется force-flush при подходе к левому краю (`latest < 200`), чтобы `onNeedHistory` срабатывал и догрузка истории не зависала.
- **Файлы** (один): `frontend/src/chart2d/ClusterChart.tsx`.
  - Удалён `visibleCandlesList` useMemo: `~1123`.
  - Удалены `visibleMaxCellVol` / `visibleMaxSingleVol` useMemo: `~2287/2300`.
  - Вычисление обоих перенесено в drawRef: `~2723-2742`.
  - `requestScrollStateSync` debounce-only + edge force-flush: `~609-633`.
- **Verification**:
  - `npx tsc --noEmit` ✓
  - `npx vite build` ✓ (≈1.17 s)
  - FPS-замер, BTCUSDT futures 1m, японские свечи, локальный backend (WS активен), вне зоны force-flush:

    | сценарий | S3 (до) | R (после) | target |
    |----------|--------:|----------:|-------:|
    | idle при WS | 81-108 | 74-98 (медиана ~87) | 85-90 ✓ |
    | mousemove | 55-109 | 35-79 (медиана ~52) | ≥85 |
    | **скролл** | **24.5** | **44.5 (+82%)** | ~60 |

    Long-tasks на скролле: было 4×196 мс → стало 4×181 мс (только WS-тики, не scroll-state). `mainDrawsPerSec` на скролле = 35.5 (rAF выпускает кадры, не блокируется).
- **Что закрыто / компромиссы**:
  - ✅ Scroll **+82%** (24.5 → 44.5 FPS). Цели 60 FPS не достиг — оставшийся cost — это WS-тик-инициированный full re-render монолита (~160 мс), Branch A.
  - ✅ Idle сохранён (74-98 ≈ S3 уровень).
  - ⚠️ Mousemove зашумлён 35-79 — WS-тик попадает в окно замера; medianы пляшут. Не регрессия. Лечится тем же Branch A.
  - ⚠️ **Компромисс throttle**: история запросов (`onNeedHistory`) и видимые таймстампы обновляются на 100 мс позже после остановки скролла. Подгрузка истории не страдает (force-flush при `<200 px` до левого края).
- **Попутно — `estimatePriceStep` НЕ удалена**: вопреки плану, `activePair.priceStep` (результат `estimatePriceStep`) реально используется как fallback в `~6` местах (форматирование цены `<0.1?3:1`, default-offsets рисования, `oneTickHeight` для DOM-стакана, drawingRenderer). Удаление сломает форматирование и рисование. Оставлено в коде.
- **TODO (узкое место, требует S4 или Branch A)**:
  - **A (нужен крупный рефакторинг)**: вынести верхний тулбар, индикатор-чипы, легенду индикаторов, settings-модалы из основного render-а в отдельные компоненты + `React.memo`. Сейчас один WS-тик гонит реконсиляцию ВСЕГО JSX (~160 мс). После memo поддеревьев commit упадёт до <20 мс → scroll к 60 FPS, mousemove стабильно ~85.
  - **S4**: вынос движка из React (класс с собственным render-loop).
  - **S1.5**: throttle cluster-search математики в `handleSvgMouseMove` по смене `colIdx`.
  - **БФ**: guard `canvas.width` realloc (находка №3), offscreen-кэш watermark (№6).

### [2026-06-21] perf(chart2d): S3 — scrollLeft в ref + throttled state, удалён мёртвый POC
- **Цель**: Профилировка перед S3 показала, что 88-98% кадра на скролле — это React re-render монолита, не canvas. Корень — `visibleScrollLeft` в `useState`: каждый scroll-event → setState → full re-render компонента 5300 строк (+пересчёт useMemo с этим деп'ом). Canvas-операции стоили 2.5 мс/кадр, сама draw-замыкание ~12 мс, остальные ~110 мс — React. Цель этапа: расцепить горячий путь скролла от React.
- **Решение**:
  1. **`visibleScrollLeftRef`** — горячее зеркало. `onScroll` пишет в ref на каждое событие, зовёт `scheduleDraw()` (S2). React state НЕ обновляется на каждое scroll-event.
  2. **Throttled state**: новый helper `requestScrollStateSync` — если позиция изменилась на ≥half-candle (`max(8, (candleWidth+12)/2)` px) — `flushScrollState` сразу. Иначе ставится таймер на 100 мс, который пушит state когда скролл остановился. Это кормит существующие эффекты/мемо, которые НЕЛЬЗЯ сломать: `history-on-scroll` (`:629`), `visible-timestamps` (`:648`), `visibleCandlesList` memo (`:1070`), CVD min/max memo (`:2203`).
  3. **`setVisibleScrollLeftSync` helper** для императивных писалок scrollLeft (zoom-к-курсору, prepend-компенсация, init, container-resize) — обходит throttle и синхронизирует ref+state+lastSynced атомарно. **Anti-jump prepend** (`prependScrollRef`, `:537`) использует именно его — поэтому после догрузки истории state синхронизирован сразу, без рывка.
  4. **Drag-pan** (`:1551`): больше не зовёт setState на каждый mousemove. Пишет в ref + `scheduleDraw()`. Состояние догонит через native scroll-event handler (throttle).
  5. **Shadow declarations** в hot-path замыканиях (drawRef, drawOverlay, handleSvgMouseMove, handleMouseDown, handleMouseMove, sync overlay layout effect): `const visibleScrollLeft = visibleScrollLeftRef.current;` в начале — тело не меняется, читает свежее значение из ref.
  6. **`visibleScrollLeft` удалён из deps главного draw useLayoutEffect** — нет смысла пере-устанавливать closure на каждое state-пушение, ref читается на frame-time.
  7. **Мёртвый POC-цикл удалён** (`~2829`): `filter` + двойной `reduce` по всем cells каждой свечи каждый кадр → `activePocPrice`, который **нигде не читается** (подтверждено grep'ом до и после). Чистый GC-мусор удалён.
- **Файлы** (один): `frontend/src/chart2d/ClusterChart.tsx`.
  - `visibleScrollLeftRef` + throttle инфра: `~497-499`, `~597-625`.
  - `onScroll` rewire: `~4470-4480`.
  - `setVisibleScrollLeftSync` распылён на 6 императивных сайтов (prepend, anti-jump, zoom×2, scroll-to-end, resize): `~537, 652, 907, 947, 1060, 2550`.
  - Drag-pan ref-write: `~1551-1556`.
  - Shadow declarations: drawRef `~2592`, drawOverlay `~1669`, handleSvgMouseMove `~1846`, handleMouseDown `~1151`, handleMouseMove `~1426`, sync overlay `~3868`.
  - Удалён `visibleScrollLeft` из deps: `~3852`.
  - Удалён dead POC block: было `~2829-2838`, стало 2 строки комментария.
- **Verification**:
  - `npx tsc --noEmit` ✓
  - `npx vite build` ✓ (634 ms)
  - FPS-замер, BTCUSDT futures 1m, японские свечи, локальный backend (WS активен):

    | сценарий | S2 (до) | S3 (после) | target |
    |----------|--------:|-----------:|-------:|
    | idle при WS | ~58 | **81-108** (cap 60 с jitter, **закрыта №7**) | 85-90 ✓ |
    | mousemove | 85 (luck-сэмпл) | 55-109 (медиана ~55) | ≥85 |
    | **скролл** | **10.8** | **24.5 (2.3×)** | ~60 |

    Longtask на скролле: было 9×179 мс, стало 4×159 мс — число re-render монолита упало с ~один-на-scroll-event до **~4/сек** (только half-candle flush). Цифра «единицы, не десятки» из ТЗ — соблюдена.
    Main-draw closures per second на mousemove: 2 (только WS-тики), на скролле: 25 — реальные кадры draw'а, не raw scroll-events.
- **Что закрыто / что нет / компромиссы**:
  - **Находка №7 (idle-просадка от WS)** — **закрыта**. WS-тик больше не гонит каскад из re-render + sync-draw монолита: draw планируется в rAF, состояние scroll не дёргается.
  - **Anti-jump preserved**. `prependScrollRef` использует `setVisibleScrollLeftSync` — ref+state+lastSynced атомарно. История подгружается без рывка.
  - **Scroll до 60 не дотянул (24.5)**. Причина — каждый half-candle move всё ещё триггерит full re-render 5300-строчного монолита, и одна такая re-render стоит ~160 мс. rAF не лечит дорогой одиночный re-render. Чтобы добить до 60 — нужна React-мемоизация поддеревьев (`React.memo` на стакан/индикатор-панели/UI-чипы) или вынос движка из React (S4). Это за рамками S3.
  - **Mousemove нестабилен 55-109**. Не регрессия относительно реалистичного S2 (там тоже было нестабильно — «85» был лучший сэмпл). Колебание ловит WS-тики, которые раз в 200-500 мс делают синхронный re-render монолита. Тот же бэклог: `React.memo` для поддеревьев.
- **TODO (бэклог)**:
  - **R**: `React.memo` стакана/индикатор-панелей/UI-чипов → одиночный re-render монолита удешевится с 160 мс до <16 мс → scroll должен прыгнуть к 60 FPS, mousemove стабилизируется на ~85.
  - **S1.5**: throttle математики cluster-search в `handleSvgMouseMove` по смене `colIdx`.
  - **БФ**: guard `canvas.width` realloc (находка №3), offscreen-кэш watermark (№6), удалить `estimatePriceStep` в `ClusterChartAdapter.tsx:46`.
  - **S4**: вынести движок в класс с собственным render-loop вне React.

### [2026-06-21] perf(chart2d): S2 — rAF + dirty-flag вокруг главного draw
- **Цель**: Снять синхронную перерисовку главного canvas на каждый React-commit. CHART_ENGINE.md требует «перерисовка только при изменении (dirty-flag), не каждый кадр». До S2 главный `useLayoutEffect` тяжело рисовал на каждый scroll-event/WS-tick/setState — отсюда idle-просадка от WS-тиков и тяжёлый скролл.
- **Решение**:
  1. Введён единый rAF-планировщик: `rafIdRef`, `dirtyRef`, `drawRef` (ref на актуальное замыкание draw-функции), `scheduleDraw()` — ставит `dirty=true`, если кадр не запланирован — `requestAnimationFrame(...)`; в callback'е сбрасывает флаг, обнуляет id и зовёт `drawRef.current()` ровно один раз. На unmount — `cancelAnimationFrame`.
  2. Главный `useLayoutEffect(() => {...}, deps)` теперь только: устанавливает `drawRef.current = () => { ...прежнее тело draw... }` и зовёт `scheduleDraw()`. Никакого синхронного рисования на каждый commit. Несколько setState за одну JS-задачу схлопываются в один draw на кадр.
  3. Тело draw не менялось — обёрнуто без переиндентации (JS до отступов безразличен), `return;` внутри тела теперь выходят из lambda вместо useLayoutEffect — семантика идентична.
  4. Anti-jump для prepend-истории не трогался: компенсация `scrollLeft` остаётся в своём `useLayoutEffect` (synchronously, до paint). Draw для prepend-кадра идёт через rAF (+1 кадр задержки, визуально невидимо при 60 Hz; canvas — sticky, старое содержимое в той же экранной точке, не «прыгает»).
- **Файлы** (один): `frontend/src/chart2d/ClusterChart.tsx`.
  - Планировщик: ~544–571.
  - Главный draw переехал в `drawRef.current = () => {...}; scheduleDraw();` — обёртка на seam'ах ~2517–2521 и ~3731–3733. Тело между ними не менялось.
- **Verification**:
  - `npx tsc --noEmit` ✓
  - `npx vite build` ✓ (855 ms).
  - FPS-замер, BTCUSDT futures 1m, Японские свечи, локальный backend (WS активен):

    | сценарий | S1 (до S2) | после S2 | target |
    |----------|-----------:|---------:|-------:|
    | idle (мышь стоит) | 58 | 53–62 (≈58 средн.) | 85–90 |
    | **движение мыши** | 53.1 | **85.0 (1.6×)** | 85–90 ✓ |
    | скролл | 12.6 | 10.8 (в пределах шума) | ~60 |

    Longtask за 1.5с скролла: 9 блоков, средний **179 мс**, медиана 181, max 358, суммарно 1611 мс из 1500.
- **Что работает / что нет**:
  - **Mousemove попал в target (85 FPS).** Причина выигрыша: до S2 любой WS-тик во время движения мыши гнал синхронный draw (~90 мс), который блокировал handler S1 и роняло FPS до 53. После S2 WS-тик ставит rAF — handler мыши идёт без блокировок.
  - **Idle и scroll НЕ выиграли существенно.** Главная причина — сам draw стоит ~90 мс (idle) и ~180 мс (scroll). rAF может схлопнуть N перерисовок за тик в одну, но когда они и так одна на кадр, схлопывать нечего. Idle при WS-активности уже шёл «одна перерисовка на тик», скролл — «одна перерисовка на scroll-event ≈ одна на кадр».
  - Скролл-стоимость 179 мс vs idle-стоимость 90 мс = удвоение. Причина — на скролле `visibleScrollLeft` меняется и пересчитываются useMemo'ы с этим деп'ом (visibleCandlesList, CVD-координаты и др.) ДО draw'а. Это React render-CPU, не сам canvas.
  - Сводно: находка №2 (нет rAF/dirty-flag) — **закрыта**. Находка №7 (idle-просадка) — **не закрыта**: rAF не лечит дорогой одиночный draw. Требуется удешевить сам draw (S1.5 + БФ блок).
- **TODO (следующие этапы плана)**:
  - **S1.5** — throttle математики cluster-search в `handleSvgMouseMove` по смене `colIdx`; для скролла — батчить пересчёт `visibleCandlesList`/CVD-координат через `visibleScrollLeft` в ref + raf-throttled state.
  - **БФ** — не пересоздавать `canvas.width` каждый draw (находка №3); offscreen-кэш watermark (находка №6); удалить мёртвую `estimatePriceStep` (`ClusterChartAdapter.tsx:46`).

### [2026-06-21] perf(chart2d): S1 — crosshair/hover вынесены на отдельный canvas-слой
- **Проблема**: В режиме «Японские свечи» без кластеров FPS при движении мыши падал с ~90 до ~11. Замер: каждый mousemove блокировал главный поток ~90 мс (медиана 54, макс 226). За 1.5с движения поток занят ~1356 мс (90%). Причина — `crosshair`/`hoveredCell` в `useState`, прописаны в зависимостях главного draw-эффекта → каждое движение мыши форсирует полную перерисовку всех видимых свечей, осей, watermark, текста.
- **Решение (S1 из плана `plan-chart2d-piped-hare.md`)**:
  1. Второй прозрачный `<canvas>` поверх основного (`overlayCanvasRef`), `pointer-events:none`, `z-index:1`. Сайз/DPR синхронизируются с основным; буфер пересоздаётся только при реальной смене размеров (`overlaySizeRef`).
  2. `crosshair`/`hoveredCell`/`hoveredClusterSearch` переведены с `useState` на `useRef`. `handleSvgMouseMove`/`handleSvgMouseLeave` пишут в refs и не вызывают setState.
  3. Новая функция `drawOverlay()` перерисовывает только верхний слой: crosshair-линии + бокс с подписью времени под курсором. Вызывается из mousemove/mouseleave и из пост-render layout-эффекта (синхронизация после рендеров по другим причинам).
  4. DOM-подписи у курсора обновляются императивно через refs (`updateCrosshairDom`, `updateClusterTooltipDom`): подпись цены на шкале (SVG `<g>` всегда смонтирован, видимость через `display`), значения Delta/CVD (`<span>` с classname/style через ref), тултип Cluster Search (всегда смонтирован, все 6 полей + цвета + позиция через refs). Никакого setState на mousemove.
  5. Из основного draw-эффекта удалены: рисование crosshair-линий, мёртвый `isHoveredCol`, hover-бокс таймстампа (перенесён в overlay), зависимости `crosshair` и `hoveredCell`. Логика «скрывать соседние таймстампы рядом с hover» снята — фоновая заливка overlay-бокса сама маскирует подписи под собой.
  6. Sticky-обёртка над двумя canvas-ами: `<div sticky left-0 top-0>` с фиксированным размером, оба canvas-а `absolute left-0 top-0` поверх друг друга — overlay не нарушает скролл-математику основного.
- **Файлы** (один): `frontend/src/chart2d/ClusterChart.tsx`.
  - State → refs: ~448–463 (+ 16 новых DOM/canvas refs).
  - `formatPriceForOverlay`, `drawOverlay`, `updateCrosshairDom`, `updateClusterTooltipDom` — ~1568–1768.
  - `handleSvgMouseMove`/`handleSvgMouseLeave` переписаны на refs + императивный DOM — ~1770–2030.
  - Удалена деривация `hoveredCandle`/`deltaValueText`/`cvdValueText` (~2486).
  - Удалён `isHoveredCol` (~2530).
  - Упрощены time-labels (3476-): теперь только «стандартные» подписи, без зависимости от crosshair.
  - Удалены `crosshair`-lines + `crosshair`/`hoveredCell` из deps главного `useLayoutEffect` (~3531–3739).
  - Sync `useLayoutEffect(() => { ... })` без deps — выставляет DOM/overlay из refs после каждого commit (~3741–3760).
  - JSX: sticky-обёртка с двумя canvas (~4361–4380), crosshair price label всегда смонтирован (~4677–4709), Delta span с ref (~4724), CVD span с ref (~4788), Cluster Search tooltip всегда смонтирован (~4935–5005).
- **Verification**:
  - `npx tsc --noEmit` ✓
  - `npx vite build` ✓ (576 ms, 2923 модулей)
  - Замер FPS в Chrome DevTools, BTCUSDT futures 1m, Японские свечи, локальный backend:

    | сценарий | FPS до | FPS после |
    |----------|--------|-----------|
    | idle (мышь стоит) | 89.7 | 58–98 (зашумлено WS live-тиками; не задача S1) |
    | **движение мыши** | **11.5** | **53.1 (4.6×)** |
    | скролл | 14.0 | 12.6 (S2: dirty-flag + rAF, не S1) |

    Longtask-блокировка во время движения мыши: до — 15 движений = 15 longtasks (~90% потока). После — 104 движений = 9 longtasks (~9%). Подавляющее большинство mousemove теперь не блокирует поток.
  - Визуально (скриншот): crosshair-линии следуют, подпись цены `$64,214.6` на правой шкале, hover-бокс таймстампа «13:19 21.06.2026», Delta `-7.7K` (красный), CVD `+230.5K` (фиолетовый). Никаких визуальных регрессий.
- **Что не делалось (по плану — этапы S2/БФ)**:
  - rAF + dirty-flag вокруг основного draw (это даст выигрыш на скролле и склеит несколько setState в один кадр).
  - guard `canvas.width` — не пересоздавать буфер основного canvas, если размер не поменялся.
  - кэш watermark в offscreen.
  - удаление мёртвой `estimatePriceStep` в `ClusterChartAdapter.tsx`.
- **TODO (S2, следующий шаг)**:
  - Дотянуть mousemove FPS с 53 до ~85: throttle cluster-search математики на каждый mousemove (запускать только при смене `colIdx`).
  - rAF + dirty-flag для скролла.

### [2026-06-21] Volume Profile: 5 раздельных прозрачностей + color-picker палитра
- **Цель**: 5 отдельных alpha-слайдеров (VA / out-VA / POC / фон / обводка) вместо одного `opacity`. Цвета профиля и POC — только через `<input type="color">` (системная палитра), без 5 круглых пресетов. Hard-coded фиолетовая обводка убрана — теперь обводка/фон красятся `volColor`.
- **Тип** (`frontend/src/chart2d/utils/drawingRenderer.ts`): в `DrawingItem` добавлены `vpVaOpacity?`, `vpOutVaOpacity?`, `vpPocOpacity?`, `vpBgOpacity?`, `vpBorderOpacity?`. Поле `opacity?` оставлено для fallback на старых сохранениях.
- **Рендер** (ветка `d.type === "volume"`):
  - `hexToRgba` поднят в начало ветки (для обводки).
  - Обводка (stroke): `hexToRgba(baseColor, vpBorderOpacity ?? 0.8)`. Внутренний fill прямоугольника обводки удалён.
  - Фон VA rect: `hexToRgba(baseColor, vpBgOpacity ?? 0.03)` вместо hard-coded синего.
  - VA bars: `hexToRgba(baseColor, vpVaOpacity ?? opacity ?? 0.28)`.
  - Out-VA bars: `hexToRgba(baseColor, vpOutVaOpacity ?? (opacity * 0.3) ?? 0.084)`.
  - POC stroke + текст: `hexToRgba(pocColor, vpPocOpacity ?? 1.0)`.
  - VAH/VAL пунктир и подписи — не трогали.
- **Дефолты** (`frontend/src/contexts/DrawingDefaultsContext.tsx` → `VOLUME_DEFAULTS`): `{ extendPoc:false, volColor:"#3b82f6", pocColor:"#3b82f6", vpVaOpacity:0.28, vpOutVaOpacity:0.084, vpPocOpacity:1.0, vpBgOpacity:0.03, vpBorderOpacity:0.8 }`. При дефолтах картинка идентична прежней.
- **Init-state + миграция** (`frontend/src/chart2d/ClusterChart.tsx` ~208): init локального state расширен 5 новыми полями. Миграция: если из localStorage пришёл `opacity` без `vpVaOpacity` → `vpVaOpacity = opacity`, `vpOutVaOpacity = opacity * 0.3`, остальные = дефолты, persist.
- **Окно настроек** (`frontend/src/chart2d/ClusterChart.tsx` ~4831-4950): 5 круглых пресет-кнопок удалены в обоих блоках цвета. Остался только `<input type="color">` с классом `vp-color-swatch` (чистый круг w-7 h-7). Один слайдер "Histogram Opacity" заменён на 5 слайдеров в секции "Прозрачности" (range 0.05..1.0 step 0.01). Чекбокс "Extend POC" оставлен. Стилистика карточки прежняя.
- **CSS** (`frontend/src/styles/index.css`): класс `.vp-color-swatch` — `appearance-none` + сброс webkit/moz color-swatch до чистого круга.
- **Backend / БД**: не трогали. `settings` — JSON-строка, "volume" уже в allowlist.
- **Verification**: `npx tsc --noEmit` ✓, `npx vite build` ✓. UI-проверка вручную: гость → localStorage, авторизованный → PUT `/api/v1/user/drawing-defaults`, fallback на старый `opacity` через миграцию, клик по `<input type="color">` открывает системную палитру, каждый из 5 слайдеров влияет на свой слой.

### [2026-06-21] Volume Profile fix: clusterStep вместо activePair.priceStep, убраны пропуски баров
- **Root cause**: `drawingRenderer.ts` использовал `activePair.priceStep` (= estimatePriceStep, хардкод 2.5), а клетки candle.cells агрегированы `computePriceStep` (= базовый шаг × compression). Из-за этого VA 70% / POC смещались, а между барами гистограммы были вертикальные пропуски.
- **Fix 1** (`drawingRenderer.ts:54`): добавлено поле `clusterStep?: number` в `RenderContext`.
- **Fix 2** (`drawingRenderer.ts:81`): `clusterStep` деструктурирован из params.
- **Fix 3** (`drawingRenderer.ts:335`, `:501`): `activePair.priceStep` → `clusterStep || activePair.priceStep || fallback` — приоритет у реального шага агрегации.
- **Fix 4** (`drawingRenderer.ts:615`): `bHeightStep + 0.25` → `bHeightStep` — удалён зазор, бары теперь слитные.
- **Fix 5** (`ClusterChart.tsx:2402`, `:3330`): проброшен `clusterStep: effectiveStep` в оба вызова `drawDrawingObjects`.
- **Verification**: tsc --noEmit ✓, vite build ✓.

### [2026-06-21] 3 правки UI из PROCLUSTER3: ClustersIcon, палитра, Pan tooltip
- **ClustersIcon** (`frontend/src/components/icons/ClustersIcon.tsx`): заменён на три rect-плитки с `fillOpacity` 0.1 / 0.8 / 0.3 и `strokeWidth="1.5"`.
- **Palette button** (`frontend/src/components/ChartHeader.tsx`): удалена текстовая подпись "COLOR"/"ЦВЕТ" над кнопкой, удалён `min-w-[40px]` — только иконка свечи + стрелка.
- **Pan tooltip** (`frontend/src/chart2d/ClusterChart.tsx`): при hover на "Click & Drag to Pan (2D)" — всплывающий блок с заголовком "Управление масштабом" и подсказками SHIFT+SCROLL / CTRL+SCROLL. Move icon — `animate-pulse`. Позиционирован ниже плашки (top-full), чтобы не обрезался `overflow-hidden` на родителе.
- **i18n**: добавлены ключи `zoomControlsTitle`, `zoomVertical`, `zoomHorizontal` в RU/EN/KZ.
- **fix (tooltip clipping)**: `right-0` вместо `left-0`, ширина `w-56`, `whitespace-nowrap` на строках описаний.
- **fix (palette btn layout)**: `justify-center` вместо `justify-between`, `min-w-[40px]` и `whitespace-nowrap`.

### [2026-06-19] Fix v3: follow-mode — live-append не кидает в историю, prepend без дёрганья (удалён prependHandledRef)
- **Баг 2 (prepend дёргает масштаб)**: setVisibleClientWidth после prepend давал второй прогон эффекта, где prependHandledRef уже был consumed → scroll к правому краю.
- **Баг 3 (live-append кидает на конец)**: при появлении новой свечи candles.length рос → авто-скролл ехал к правому краю, даже если пользователь в истории.
- **Решение**: follow-mode на базе isNearRightEdge — scroll-к-правому-краю только при смене combo ИЛИ если пользователь уже у правого края (следит за live). Prepend (пользователь слева) и live-append в истории (пользователь не у края) — не трогают позицию.
- **Правки** (только `frontend/src/chart2d/ClusterChart.tsx`):
  - **isComboChange** (строка 840): захват `hasInitializedZoomRef.current !== activePair.symbol` ДО zoom-init (чтобы scroll-код знал, init это или нет).
  - **isNearRightEdge** (строка 898): `container.scrollLeft >= maxScroll - 50` — порог ~50px от правого края.
  - **Scroll guard** (строка 899): `if (isComboChange || isNearRightEdge)` — scroll-к-правому-краю только по этим условиям.
  - **setVisibleClientWidth guard** (строка 904): `setVisibleClientWidth(prev => prev === clientWidth ? prev : clientWidth)` — не триггерит re-render тем же значением.
  - **Удалён prependHandledRef** (был :478, :494, :882-886) — избыточен, заменён isNearRightEdge.
- **Сценарии**:
  - **F5 / смена TF/market/compression/тикера**: isComboChange=true → scroll к правому краю, ~100 свечей, центр вертикали. ✓
  - **Live-свеча, пользователь У ПРАВОГО КРАЯ**: isNearRightEdge=true → scroll к обновлённому правому краю (следование). ✓
  - **Live-свеча, пользователь В ИСТОРИИ**: isNearRightEdge=false → позиция не трогается, new свеча добавляется молча. ✓
  - **Prepend (скролл влево, дозагрузка)**: пользователь у левого края → isNearRightEdge=false → scroll не трогается. Даже второй прогон от setVisibleClientWidth не сдвинет. ✓
  - **Несколько prepend подряд**: стабильно. ✓
  - **Prepend → смена TF**: isComboChange=true → scroll к правому краю. ✓
- **Проверки**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (619ms)
- **Не коммитить** — жду подтверждение: live-свеча в истории не двигает; prepend без дёрганья; смена TF + live у края — правый край.

### [2026-06-19] Fix v2: prepend — устранена регрессия (ложный триггер дозагрузки при F5)
- **Регрессия**: после fix v1 (prependHandledRef) при F5/смене combo график застревал на левом крае/центре истории, не доезжая до последней свечи.
- **Причина**: триггер дозагрузки (`ClusterChart.tsx:513-533`) срабатывал ЛОЖНО при `visibleScrollLeft=0` (начальное состояние). `firstVisibleIdx = floor((0-60)/157) = -1`, и условие `firstVisibleIdx < 100` было TRUE → ставился `pendingScrollAnchorRef` + вызывался `onNeedHistory`. Асинхронный fetch завершался, LayoutEffect :483 видел leaked anchor, ставил `prependHandledRef=true` и компенсировал scrollLeft на левый край — авто-скролл :830 скипался (prependHandledRef=true), график не доезжал до правого края.
- **Правка** (только `frontend/src/chart2d/ClusterChart.tsx`, строка 516-520):
  - **`hasInitializedZoomRef` guard** (строка 516): ранний return если `hasInitializedZoomRef.current !== activePair.symbol` — не пускать триггер до завершения инициализации зума/скролла.
  - **`firstVisibleIdx >= 0`** (строка 520): добавлена нижняя граница индекса — триггерить дозагрузку только при реальном скролле к левому краю, а не при `visibleScrollLeft=0`.
- **Trace для F5 (после правки)**:
  1. Effect :513: `hasInitializedZoomRef (null) !== symbol` → early return. `pendingScrollAnchorRef` НЕ ставится.
  2. Effect :830: zoom init + scroll-к-правому-краю → `hasInitializedZoomRef = symbol`. ✓
  3. Effect :513 (повторно, если visibleScrollLeft изменился): guard passes, `firstVisibleIdx` большой → `>= 0 && < 100` → false → нет триггера.
- **Краевые случаи**:
  - **F5**: нет фейковой дозагрузки, график едет к правому краю, ~100 свечей, центр по вертикали.
  - **Смена TF/market/compression/тикера**: правый край, без ложной дозагрузки.
  - **Реальный скролл влево**: `firstVisibleIdx >= 0 && < 100` → дозагрузка срабатывает, prepend-компенсация работает, график стоит на месте.
  - **firstVisibleIdx = 0**: дозагрузка срабатывает корректно (у самого начала истории).
  - **Несколько prepend подряд**: стабильно.
  - **Prepend → смена TF**: едет к правому краю.
- **Проверки**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (575ms)
- **Не коммитить** — жду подтверждение: F5 → правый край + 100 свечей; реальный prepend → без дёрганья; смена TF → правый край.

### [2026-06-19] Fix: prepend — график не дёргается и не прыгает на последнюю свечу при дозагрузке истории (Canvas2D)
- **Проблема**: при скролле влево (дозагрузка старых свечей) график прыгал на последнюю свечу.
- **Причина**: авто-скролл-эффект (`ClusterChart.tsx:830-903`, deps: `candles.length`) перезапускался при prepend (length вырос) и в строчке `container.scrollLeft = finalScrollLeft` (:898) перезаписывал scrollLeft на правый край, перетирая корректную компенсацию из `useLayoutEffect` (:492-498), которая уже восстановила позицию по anchor-свече.
- **Правки** (только `frontend/src/chart2d/ClusterChart.tsx`):
  - **Новый ref `prependHandledRef`** (строка 478): сигнал от LayoutEffect к useEffect, что прошла компенсация prepend.
  - **LayoutEffect (строка 494)**: при успешной обработке anchor (компенсация scrollLeft) устанавливает `prependHandledRef.current = true` сразу после `pendingScrollAnchorRef.current = null`.
  - **Auto-scroll effect (строки 881-900)**: scroll-к-правому-краю обёрнут в `if (prependHandledRef.current) { prependHandledRef.current = false } else { ... }` — при активном сигнале пропускает установку scrollLeft (позиция уже восстановлена LayoutEffect) и сбрасывает флаг. `setVisibleClientWidth(clientWidth)` остаётся вне if-блока (:901) — resize продолжает работать.
- **Жизненный цикл флага**:
  - `pendingScrollAnchorRef.current` СТАВИТСЯ (`ClusterChart.tsx:520-523`) при обнаружении скролла к левому краю (триггер дозагрузки).
  - СБРАСЫВАЕТСЯ в null при успешной компенсации в LayoutEffect (строка 493).
  - `prependHandledRef.current` СТАВИТСЯ сразу после этого (строка 494).
  - СБРАСЫВАЕТСЯ при потреблении в авто-скролл эффекте (строка 883).
- **Сценарии**:
  - **Дозагрузка влево (prepend)**: флаг выставлен → scroll-к-правому-краю пропущен → график неподвижен, без дёрганья.
  - **Несколько prepend подряд**: каждый раз anchor → компенсация → флаг → потребление → stable.
  - **Prepend → смена TF**: после prepend флаг = false (consumed). Смена TF: symbol меняется → `hasInitializedZoomRef !== symbol` → zoom init + scroll-к-правому-краю работают.
  - **F5 / загрузка**: флаг false → scroll к последней свече.
  - **Resize окна**: `visibleClientWidth` в deps → флаг false → scroll-к-правому-краю работает (пересчёт позиции).
  - **Live update**: `candles.length` растёт, но без anchor → флаг false → scroll-к-правому-краю работает (существующее поведение).
- **Проверки**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (571ms)
- **Не коммитить** — жду подтверждение: при дозагрузке график стоит на месте, после смены TF едет к правому краю.

### [2026-06-19] Fix: начальный зум ~100 свечей + центровка по вертикали (Canvas2D)
- **Проблема**: при загрузке график смещён вверх (свечи в верхней половине) + начальный зум показывал ~40 свечей.
- **Причина**: `priceBounds` считал `basePriceCenter` по ВСЕМ загруженным свечам (500+), а не по видимым → центр видимого диапазона не совпадал с центром последних свечей → смещение вверх. `zoomInit` считал candleWidth на 40 свечей, а не на комфортные 100.
- **Правки** (только `frontend/src/chart2d/ClusterChart.tsx`):
  - **Константа `VISIBLE_CANDLES = 100`** (строка 382): единое число видимых свечей для горизонтального зума и вертикальной центровки.
  - **`candlesToScale` (строки 608-612)**: теперь использует `candles.slice(-VISIBLE_CANDLES)` вместо всех свечей → `priceBounds` считает диапазон и центр только по последним 100 свечам. Это чинит вертикальное смещение, т.к. `basePriceCenter` теперь совпадает с центром видимых свечей.
  - **`zoomInit` (строки 838-876)**: `40` → `VISIBLE_CANDLES` для candleWidth (горизонталь) и для расчёта `rangeV/centerV` (вертикаль). Поскольку `candlesToScale` уже использует те же последние 100, `priceRange = rangeV` и `basePriceCenter = centerV` → `targetVerticalScale = 0.812`, `priceCenterOffset = 0` (синхронно с начальным состоянием).
  - **Начальные `verticalScale`** (строка 391): `0.7` → `0.812` — совпадает с zoomInit, устраняет флэш первого кадра. Соответственно `verticalScaleRef` (строка 456) тоже `0.812`.
- **Поведение**:
  - **F5 / загрузка**: ~100 свечей в окне, вертикально центрированы, без смещения вверх, без флэша.
  - **Смена TF/market/compression/тикера**: `activePair.symbol` меняется → zoomInit пересчитывает candleWidth под 100 свечей и центрует по последним 100.
  - **Мало данных (< 100 свечей)**: `Math.min(VISIBLE_CANDLES, candles.length)` → показываются все имеющиеся, центрированы.
  - **Ручной зум/скролл после загрузки**: не тронут, сохраняет всё поведение.
- **Проверки**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (498ms)
- **Не коммитить** — жду скрин: ~100 свечей в окне, по центру вертикали.

### [2026-06-19] Fix: авто-скролл к последней свече при F5 / смене TF/market/compression (Canvas2D)
- **Причина**: `useEffect` авто-скролла (`ClusterChart.tsx:829-893`) имел deps `[activePair.symbol, visibleClientWidth]` — без данных и combo. На F5 эффект бежал при пустом `candles` (length=0 → skip) и не догонял при асинхронном приходе данных. Смена TF/market/compression работала только за счёт случайного unmount/remount через loading-флаг.
- **Правки** (только `frontend/src/chart2d/ClusterChart.tsx`):
  - **Deps (строка 893)**: добавлены `candles.length, timeframe, marketType, clusterStep` — теперь эффект догоняет при приходе данных и при любой смене combo.
  - **clientWidth fallback (строка 832-833)**: убран `|| 800`. Вместо этого ранний return при `clientWidth <= 100` — скролл не ставится по ошибочной ширине, а дожидается реальной через ResizeObserver → visibleClientWidth → повторный вызов эффекта.
  - **Zoom init (строка 837)**: не тронут — `hasInitializedZoomRef` блокирует только зум, но scrollLeft ПЕРЕустанавливается при каждом вызове эффекта (код после if-блока), что соответствует требованию.
- **Проверки**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (709ms)
- **F5**: candles.length 0→N в deps → эффект догоняет → scrollLeft = правый край.
- **Смена TF/market/compression**: соответствующий dep меняется → эффект бежит → scrollLeft = правый край.
- **Драг-скролл** в рамках одной загрузки не тронут.
- **Не коммитить** — жду скрин: после F5 и смены TF график на последней свече.

### [2026-06-19] Добавление 5m в роллап (бэкенд) — AlignToTimeframe, Rollup, live-рассылка
- **Проблема**: 5m не роллапился → ClickHouse не содержал 5m-записей → REST возвращал пустой массив.
- **Правки**:
  - `aggregation/rollup.go:22-25`: добавлен `case "5m"` в `AlignToTimeframe` — граница периода = `t.Minute() / 5 * 5`.
  - `aggregation/rollup.go:102`: `"5m"` добавлен в список ТФ функции `Rollup()` (теперь 6 ТФ: 5m,15m,30m,1h,4h,1d).
  - `aggregator/aggregator.go:95`: `"5m"` добавлен в `higherTimeframes` — live-рассылка автоматически шлёт `candle_update` на канал `...:5m`.
- **Как работает**: Ingest пушит 1m кластера, `FlushCandle` → `rollup` → `AggregateForTimeframe(rows, "5m")` группирует 1m строки по 5-минутным bucket'ам (сумма Bid/Ask, first→open, last→close). Live: `updateTFStates` аккумулирует трейды в 5m-период, при смене границы — сброс. Никаких новых таблиц — timeframe='5m' пишется в те же `clusters_futures`/`clusters_spot`.
- **Проверки**:
  - `go build ./cmd/procluster/`: PASS
  - `go test ./...`: ALL PASS (aggregation/rollup тесты не сломаны)
  - `go vet ./...`: PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (712ms)
- **Примечание**: после перезапуска роллапу нужно несколько минут для накопления 5m-данных.
- **Не коммитить** — жду скрин: 5m показывает историю и обновляется вживую.

### [2026-06-19] Live broadcast всех ТФ (бэкенд) — 1м→15м/30м/1ч/4ч/1д + диагностика 5м
- **Причина (подтверждена)**: `aggregator.go:248` хардкодит `Timeframe:"1m"` в `CandleUpdate`, `stream.go:36` шлёт broadcast только в канал `...:1m`. Старшие ТФ (15м/30м/1ч/4ч/1д) и спот-не-1м никогда не получают WS-сообщений. Живёт только фьюч 1м.
- **Диагностика 5m (REST)**:
  - `Rollup()` в `aggregation/rollup.go:98-109` производит только `15m, 30m, 1h, 4h, 1d` — **5m не роллапится**. GET `/api/v1/candles?symbol=BTCUSDT&market=futures&timeframe=5m&limit=200` → ClickHouse не содержит 5m-записей → пустой массив.
  - Причина: в `AlignToTimeframe()` (rollup.go:20-36) нет case `"5m"`. В `Rollup()` нет `"5m"` в списке ТФ. 5m никогда не пишется в БД → всегда пустая история.
  - **Зафиксировано, НЕ ПОЧИНЕНО** — требуется решение о model/data gap.
- **Решение (бэкенд — aggregator.go)**:
  - Добавлены типы `priceLevel` (bid/ask) и `tfLiveState` (candleOpen, live, levels map) для аккумуляции live-данных старших ТФ в памяти.
  - `a.tfStates map[string]map[string]*tfLiveState` — bookKey → tf → состояние. Инициализируется в New().
  - **`updateTFStates(trade, level, side, volume)`** (aggregator.go:280-330): на каждый trade обновляет OHLC + level-аккумулятор для 15м/30м/1ч/4ч/1д через `aggregation.AlignToTimeframe(trade.Time, tf)`. При смене периода ТФ — сброс (без записи в БД). Уровни накапливаются в памяти той же функцией `CompressPrice`/`InterpretTrade`/`TruncateVolume`, что и 1м.
  - **`pushTFUpdates(symbol, market)`** (aggregator.go:332-365): конвертирует in-memory levels в `[]CandleLevel` и шлёт `CandleUpdate` в `UpdatesCh` для каждого активированного ТФ.
  - **`processTrade`** модифицирован: зовёт `a.updateTFStates()` после 1м-обновления, и `a.pushTFUpdates()` после 1м-пуша (тот же 200ms throttle).
  - **Переиспользован `aggregation.AlignToTimeframe`** — та же усечка времени, что в rollup.go. OHLC и уровни для старших ТФ считаются так же, как их посчитал бы `AggregateForTimeframe()`, но для текущей не-закрытой свечи.
  - **stream.go/hub.go не тронуты** — `ListenToAggregator` уже использует `update.Timeframe` динамически в `buildChannelKey`.
- **Не тронуто**: ingest, схема БД, tier_policies, объекты рисования, фронтовый WS-клиент (он уже шлёт правильные ТФ в подписке).
- **Файл**:строка правки: `aggregator/aggregator.go:280-365` — новые методы `updateTFStates` + `pushTFUpdates` + модификация `processTrade` (строки 256, 278).
- **Проверки**:
  - `go build ./cmd/procluster/`: PASS
  - `go test ./...`: ALL PASS
  - `go vet ./...`: PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (495ms)
- **Не коммитить** — жду скрин/гиф: на 15м и на споте свеча и кластера обновляются вживую.

### [2026-06-19] Live chart update — Canvas2D WebSocket client
- **Диагностика**: `VITE_USE_CANVAS2D=true` → активен Canvas2D путь (`ClusterChartAdapter` → `ClusterChart`). PIXI.js WS код (`ChartContainer.tsx:197-236`) мёртв — не используется. Canvas2D путь вообще не имел WS-клиента.
- **Факт 1** (`auth/middleware.go:71-77`): `ExtractUserFromRequest` читает JWT из `?token=` query-параметра — подходит для `new WebSocket()` (не умеет кастомные headers).
- **Факт 2** (`api/session.go:13-16`): `heartbeatInterval=10s`, `sessionTTL=30s` — heartbeat на клиенте ставить на **8с**.
- **Создан `useLiveChart.ts`** (`frontend/src/chart2d/useLiveChart.ts`):
  - WS подключение к `/ws?token=<accessToken>` (без токена — гость)
  - `chart_subscribe` при открытии и при смене symbol/market/timeframe (unsubscribe старого)
  - Heartbeat каждые 8с
  - `candle_update` → парсинг OHLC + levels → `parseCandleUpdate()` (вычисляет delta/cells/poc/vah/val)
  - Обработка `session_active`, `session_rejected`, `session_evicted`
  - Авто-переподключение через 3с при обрыве
  - Cleanup: `chart_unsubscribe` + `ws.close()` + очистка таймеров
- **ClusterChartAdapter.tsx** (строки 109-125): интегрирован `useLiveChart`, вызывает `setCandles(prev => mergeLiveUpdate(prev, candle))` на каждый `candle_update`. Добавлен `liveState` + UI-бейдж для `rejected`/`evicted`.
- **Split-layout**: каждая панель рендерит свой `ClusterChartAdapter` → свой WS с независимой подпиской.
- **Не тронуто**: бэкенд (ingest/aggregator/hub/session), БД, tier_policies, объекты рисования, PIXI-путь.
- **Проверки**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (548ms)
- **Не коммитить** — жду скрин/гиф с живой свечой.

### [2026-06-19] Фаза 14 Шаг 2: Сохранение нарисованных объектов на бэкенде (per-user, привязка к symbol+interval+market)
- **Бэкенд — миграция (auth/sqlite.go:278-289)**: `CREATE TABLE IF NOT EXISTS drawings (id, user_id, symbol, interval, market_type, drawing_type, payload TEXT, created_at, updated_at, PRIMARY KEY (id, user_id))` + индекс `idx_drawings_lookup(user_id, symbol, interval, market_type)` — идемпотентно.
- **Бэкенд — SQL функции (auth/sqlite.go:560-630)**: `GetDrawings(ctx, db, userID, symbol, interval, marketType)` → `[]DrawingRow`; `BatchReplaceDrawings(ctx, db, userID, symbol, interval, marketType, []DrawingRow)` — транзакция DELETE + INSERT batch; `DeleteDrawing(ctx, db, id, userID)` — DELETE с проверкой user_id.
- **Бэкенд — эндпоинты (auth/handlers.go:600-700)**:
  - **`GET /api/v1/user/drawings?symbol=&interval=&market=`** — RequireAuth, параметризованный SELECT, возвращает `{id, drawingType, payload}`. Валидация market в (spot,futures).
  - **`PUT /api/v1/user/drawings`** — RequireAuth, batch-replace: принимает `{symbol, interval, market, drawings:[{id, drawingType, payload}]}`, в транзакции DELETE все существующие для комбо + INSERT всех. Лимит 200 объектов на комбо, 10KB на payload, валидация drawingType из whitelist.
  - **`DELETE /api/v1/user/drawings/{id}`** — RequireAuth, удаление с проверкой user_id (404 если не принадлежит).
  - **Подход**: batch-replace (клиент шлёт полный список комбо → сервер заменяет полностью), т.к. фронт делает автосейв с debounce 800ms.
- **Бэкенд — тесты (auth/handlers_test.go:1102-1325)**: 9 тестов (401 без auth, missing params, успешное чтение, scoped by combo, batch replace, replace existing, too many, invalid market, delete success, delete not-owned). ALL PASS.
- **Фронтенд — API (features/drawings/api.ts:37-88)**: `apiGetDrawings()`, `apiPutDrawings()` (batch), `apiDeleteDrawing()`.
- **Фронтенд — ClusterChart.tsx:100-101, 228-271**:
  - **Загрузка**: `useEffect([comboKey])` — при монтировании и смене symbol/interval/marketType очищает drawings и загружает с бэка. Только для авторизованных (accessToken есть).
  - **Автосохранение**: `useEffect([drawings])` с debounce 800ms — любое изменение drawings (создание/перемещение/изменение/удаление) сохраняет весь набор для текущего комбо через PUT batch. Не сохраняет до завершения первой загрузки (`drawingsLoadedRef`).
  - **Гость**: без accessToken объекты только в памяти, не сохраняются.
- **Затронутые файлы**:
  - `backend/internal/auth/sqlite.go` (+drawings CREATE + индекс, +GetDrawings, +BatchReplaceDrawings, +DeleteDrawing, +DrawingRow)
  - `backend/internal/auth/handlers.go` (+handleGetDrawings, +handlePutDrawingsBatch, +handleDeleteDrawing, +routes)
  - `backend/internal/auth/handlers_test.go` (+9 тестов, +import fmt)
  - `frontend/src/features/drawings/api.ts` (+apiGetDrawings, +apiPutDrawings, +apiDeleteDrawing, +типы)
  - `frontend/src/chart2d/ClusterChart.tsx` (+import useAuthContext + api*; +comboKey, refs; +useEffect load, +useEffect auto-save 800ms)
- **Не тронуто**: drawing_defaults (шаг 1), tier_policies, лимиты, ingest/aggregator, движок рендера.
- **Тесты/проверки**:
  - `go test ./...`: ALL PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (624ms)
- **Багфикс (2026-06-19, после выявления через Network-тест)**:
  - **Primary cause**: `id` отправлялся как JSON number (`Date.now()`) → бэкенд ожидал string → `json.Decode` падал с 400, catch молчал. Исправлено: `String(d.id)` в auto-save payload (`ClusterChart.tsx:269`), тип `DrawingSaveItem.id: string` (`api.ts:40`).
  - **Secondary cause**: `accessToken` не был в зависимостях load effect → effect не перезапускался после появления токена (token=`null` → async `apiRefresh()` → token появляется). GET никогда не выполнялся при перезагрузке. Исправлено: dep `[comboKey, accessToken]` + guard refs (`prevComboKeyRef`, `hadTokenRef`) чтобы не перезагружать при обновлении токена.
  - **Race condition**: load effect делал `setDrawings(mapped)` после GET → затирал объекты, созданные локально во время загрузки. Исправлено: merge `setDrawings(prev => ...)` сохраняет локальные + бэкендовые.
  - **Whitelist incomplete**: `validDrawingTypes` отсутствовали `"long"` и `"short"` → PUT падал с 400 на любом батче, содержащем эти типы. Исправлено: добавлены `"long"`, `"short"` в whitelist (12 типов).
  - **CSS warning**: `<input type="color">` получал `"rgba(16,185,129,0.22)"` (невалидный формат). Исправлено: добавлена `rgbaToHex()` утилита, применяется к value обоих color-инпутов в Position Settings.
- **Верификация**:
  - `go test ./...`: ALL PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (511ms)
  - Empirically verified: PUT volume+horizontal → 200; GET возвращает оба типа; long/short больше не валятся.
- **Не коммитить** — жду скриншот: все типы переживают перезагрузку, консоль чистая от rgba warning.

### [2026-06-19] Фаза 14 Шаг 1: Per-user per-type drawing defaults (backend storage)
- **Бэкенд — миграция (auth/sqlite.go:267-277)**: `CREATE TABLE IF NOT EXISTS drawing_defaults (user_id, drawing_type, settings TEXT, updated_at, PRIMARY KEY (user_id, drawing_type))` — идемпотентно.
- **Бэкенд — SQL функции (auth/sqlite.go:512-538)**: `GetDrawingDefaults(ctx, db, userID)` → `map[string]string`; `UpsertDrawingDefault(ctx, db, userID, drawingType, settings)` → INSERT ... ON CONFLICT DO UPDATE.
- **Бэкенд — эндпоинты (auth/handlers.go:508-575)**:
  - `GET /api/v1/user/drawing-defaults` — публичный (как /user/limits): гость → `{}`, авторизованный → все его настройки с парсингом JSON.
  - `PUT /api/v1/user/drawing-defaults` — RequireAuth, whitelist из 10 типов (`volume`, `position`, `trend`, `arrow`, `channel`, `horizontal`, `rect`, `fibonacci`, `ruler`, `text`), валидация settings как JSON-объекта, UPSERT.
  - `user_id` извлекается из JWT через `ExtractUserFromRequest` (GET, как в handleGetLimits) и `r.Context().Value(UserIDKey)` (PUT, через RequireAuth).
- **Бэкенд — тесты (auth/handlers_test.go:1102-1310)**: 8 тестов (гость пустой, auth чтение, PUT успех, перезапись, невалидный тип, невалидный JSON, null settings, изоляция пользователей). ALL PASS.
- **Фронтенд — API (features/drawings/api.ts)**: `apiGetDrawingDefaults()`, `apiGetDrawingDefaultsWithToken()`, `apiPutDrawingDefault()`.
- **Фронтенд — DrawingDefaultsContext (contexts/DrawingDefaultsContext.tsx)**: загружает defaults после авторизации, кэширует в памяти, предоставляет `drawingDefaults`, `updateDrawingDefault(type, settings)` (PUT + локальный кэш), `getClientDefaults()` для fallback. Provider добавлен в App.tsx.
- **Фронтенд — ClusterChart.tsx**: импортирован `useDrawingDefaults`. Добавлен `useEffect`, синхронизирующий `drawingDefaults` из бэкенда в локальный стейт (`positionGlobalSettings`, `volProfileGlobalSettings`). `updatePositionSettings` и `updateVolProfileSettings` теперь вызывают `updateDrawingDefault("position"/"volume", updated)` — настройки сохраняются на бэкенде per-user. localStorage оставлен как fallback для гостей.
- **Затронутые файлы**:
  - `backend/internal/auth/sqlite.go` (+drawing_defaults CREATE, +GetDrawingDefaults, +UpsertDrawingDefault)
  - `backend/internal/auth/handlers.go` (+handleGetDrawingDefaults, +handlePutDrawingDefaults, +validDrawingTypes, +routes)
  - `backend/internal/auth/handlers_test.go` (+8 тестов)
  - `frontend/src/features/drawings/api.ts` (NEW)
  - `frontend/src/contexts/DrawingDefaultsContext.tsx` (NEW)
  - `frontend/src/App.tsx` (+DrawingDefaultsProvider)
  - `frontend/src/chart2d/ClusterChart.tsx` (+import useDrawingDefaults, +useEffect sync from backend, +updateDrawingDefault в update*Settings)
- **Не тронуто**: геометрия объектов, шаг 2 (сохранение нарисованных объектов), tier_policies, лимиты, ingest/aggregator, движок рендера.
- **Тесты/проверки**:
  - `go test ./...`: ALL PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (643ms)
- **Не коммитить** — жду скрин: второй объект наследует настройки первого + подтверждение что переживает перезаход.

### [2026-06-19] Фаза 13: Перенос объектов рисования и иконок из эталона PROCLUSTER3
- **Компоненты**: `frontend/src/chart2d/utils/drawingRenderer.ts`, `frontend/src/chart2d/ClusterChart.tsx`
- **Что перенесено:**
  - **Long/Short Position (drawingRenderer.ts)**: Добавлены типы `"long"` и `"short"` в `DrawingType`, новые поля (`deposit`, `risk`, `riskType`, `colorTarget`, `colorStop`, `makerFee`, `takerFee`, `entryFeeType`, `exitFeeType`, `stopPrice`, `opacity`, `volColor`, `pocColor`, `extendPoc`) в `DrawingItem`. Полный рендер блока Long/Short с Canvas-расчётами позиции (риск/депозит, кол-во, комиссии, net PnL, соотношение риск/прибыль), цветными зонами (Цель/Стоп), badge-лейблами на ценах, i18n RU/EN.
  - **Двойной клик по объектам рисования (ClusterChart.tsx)**: `handleDoubleClick` — при dblclick по `volume`/`long`/`short` объекту открывает соответствующее окно настроек. Обработчик привязан к `onDoubleClick` на контейнере.
  - **Окно настройки профиля объема (Volume Profile Settings)**: Чекбокс "Продлевать POC до касания" (`extendPoc`), ползунок прозрачности гистограммы, две цвет-пикера (гистограмма + POC линия). Сохранение в `localStorage` (`procluster_volume_profile_settings`). Все настройки применяются ко всем volume-рисункам.
  - **Окно настройки Long/Short позиции (Position Settings)**: Размер депозита ($), риск на сделку (%/$), комиссии мейкер/тейкер, тип входа/выхода, размер текста (px), прозрачность зон (%), цвет цели/стопа. Сохранение в `localStorage` (`procluster_position_settings`). Настройки применяются к текущему или ко всем long/short рисункам.
  - **Обновлённая иконка параллельного канала**: `TrendingUp` → `Equal` (lucide-react).
  - **Кнопки Long/Short на панели инструментов**: Кастомные SVG-иконки с "L" и "S" (TrendingUp/TrendingDown как fallback), тултипы RU/EN.
  - **Hit testing и handles для Long/Short**: bounding box включает стоп-зону; handles на entry (x2), target (center), stop (center).
  - **Custom volColor/pocColor/opacity/extendPoc для Volume Profile**: `hexToRgba()` конвертер, цвета применяются к гистограммам и POC линии, POC продлевается до касания свечи.
  - **`language` в RenderContext**: передаётся в `drawDrawingObjects` для локализации надписей (RU/EN) на Long/Short badge-ах.
  - **Дедуп названий индикаторов** (проверено): `ind.label.replace("(PROCLUSTER) ", "")` уже был в PROCLUSTER2 — дополнительных изменений не требуется.
- **Затронутые файлы**:
  - `frontend/src/chart2d/utils/drawingRenderer.ts` (+long/short типы +поля +рендер +handles +vol color/opacity/extendPoc +language)
  - `frontend/src/chart2d/ClusterChart.tsx` (+imp: TrendingDown, Equal; +state: positionSettingsDrawingId, volumeSettingsDrawingId, positionGlobalSettings, volProfileGlobalSettings; +updatePositionSettings +updateVolProfileSettings; +handleDoubleClick; +hit test long/short; +long/short handler drag; +toolbar long/short +channel=Equal; +onDoubleClick binding; +language в render; +position +volume модалки)
- **Не тронуто**: бэкенд, tier_policies, индикаторные пресеты (IndicatorsModal/server endpoints /api/indicator/presets).
- **Тесты/проверки**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (548ms)
- **Не коммитить** — жду скрины.

### [2026-06-18] Фаза 12: Стилизация страницы выбора тарифов по эталону design-src (2-я итерация)
- **Компонент**: `frontend/src/components/UserProfile.tsx`
- **Что изменено:**
  - **Бейдж "ПОПУЛЯРНО"** (строки 585-587): зелёная капсула над Pro, `absolute -top-3 right-6`, bg `#10191B`, border `#2FD3B2/30`, текст `t('profile.popular')`.
  - **Подсветка карточек** (строки 553-581): Pro — зелёная рамка `border-[#2FD3B2]/30` + glow `rgba(45,212,178,0.32)`, внутренняя ambient `from-[#2FD3B2]/15`. VIP — оранжевая рамка `border-amber-500/30` + glow `rgba(245,158,11,0.32)`, ambient `from-amber-500/10`. Free — нейтральная. На hover для неактивных — border + glow + scale.
  - **Цвета кнопок** (строки 625-631): Pro — зелёная `bg-[#1CD5A6]` + `shadow-[0_4px_25px_rgba(28,213,166,0.3)]`. VIP — оранжевая `bg-amber-500` + `shadow-md shadow-amber-500/20`. Free — нейтральная `bg-[#1F2228] border border-white/10`.
  - **Текст и логика кнопок** (строки 617-636):
    - Текущий тариф (= карточка) → `isActive=true` → серая disabled `bg-slate-500/10 text-slate-500`, текст `t('profile.currentPlan')`.
    - Роль `admin` → на ВСЕХ карточках `t('profile.activateFree')` (ru: "Активировать").
    - Карточка Free (не текущая) → `t('profile.activateFree')` (ru: "Активировать").
    - Карточки Pro/VIP (не текущие) → `t('profile.activate')` (ru: "Подключить").
    - Цвет кнопки всегда по карточке (Pro-зелёная, VIP-оранжевая, Free-нейтральная), кроме "Текущий тариф" — серый.
    - Примеры: FREE→[Текущий/Подключить/Подключить], PRO→[Активировать/Текущий/Подключить], VIP→[Активировать/Подключить/Текущий], ADMIN→[Активировать/Активировать/Активировать].
  - **Значения из API** (строки 136-150, 420-448): `useUserLimits()` через `cardValues()` — если карточка совпадает с текущим тарифом, значения `workspacesCount`, `historyMaxDays`, `compressionMax`, `maxIndicators`, `customIndicatorSettings`, `telegramEnabled`, `anomaliesEnabled` берутся из API. Для других карт — fallback на дефолты.
  - **Строка аномалий** (строка 613): `LimitRow label={t('profile.propsAnomalies')} value={anomalies}` — 9-я строка в списке.
  - **Правило безлимита** (строки 510-540): `LimitRow`: числа >=100 → `t('profile.unlimited')` (зелёным `text-[#10B981]`). Compression >=10 → безлимит. History для VIP → `t('profile.allHistory')`.
  - **i18n**: добавлены ключи `profile.activateFree` в en/ru/kz. ru: `activate`="Подключить", `activateFree`="Активировать".
- **Затронутые файлы**:
  - `frontend/src/components/UserProfile.tsx` (import useUserLimits, cardValues helper, PlanCard userRole prop, button logic)
  - `frontend/src/i18n/dictionaries/en.ts` (+activateFree)
  - `frontend/src/i18n/dictionaries/ru.ts` (+activateFree, activate→Подключить)
  - `frontend/src/i18n/dictionaries/kz.ts` (+activateFree, activate→Қосу)
- **Не тронуто**: бэкенд, логика оплаты, tier_policies.
- **Тесты/проверки**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (504ms)
- **Не коммитить** — жду скрины.

### [2026-06-18] Фаза 12: БЛОК ТАРИФНЫХ ЛИМИТОВ ЗАВЕРШЁН — коммит feat(admin): tier policies admin tab + per-tier limits enforcement
- Этапы 0-6 выполнены: миграция БД, seed, админ-эндпоинты GET/PUT /api/v1/admin/policies, вкладка в админке, GET /api/v1/user/limits (реалтайм из БД), публичный доступ для гостя, LimitsContext на фронте, применение 4 лимитов (compression, workspaces, indicators, anomalies).
- Осталось (отдельные подшаги):
  - лимит истории по ТФ (historyDaysPerTf) — на клиенте пока не подключён
  - telegramEnabled — поле эндпоинт отдаёт, UI не применяет
  - history-loader (отдельная фаза)

### [2026-06-18] Фаза 12 Этап 6: Лимиты гостя — /user/limits публичный, гость читается из БД
- **Проблема**: GET /user/limits под RequireAuth → гость без токена получал 401 → фронт падал в catch → DEFAULT_LIMITS (хардкод). Настройки guest из админки игнорировались.
- **Решение (бэкенд — auth/handlers.go:131,735-739)**:
  - Маршрут: снят `RequireAuth` → `mux.HandleFunc("GET /api/v1/user/limits", h.handleGetLimits)`.
  - `handleGetLimits`: вместо чтения `r.Context().Value(RoleKey)` (недоступен без RequireAuth) — вызов `ExtractUserFromRequest(h.cfg, r)`:
    - Есть валидный JWT → роль из токена (как раньше) → читает tier_policies по этой роли.
    - Нет/невалиден токен → роль `"guest"` → читает tier_policies WHERE tier='guest' из БД.
    - **Никогда не возвращает 401**.
    - SQL параметризован; fallback на дефолты только если строки guest нет в БД.
- **Решение (фронтенд — contexts/LimitsContext.tsx, auth/api.ts)**:
  - `apiGetLimitsPublic()` — новая функция (fetch без Authorization header).
  - `LimitsContext.refresh()`: если `accessToken` есть → `apiGetLimitsWithToken`, иначе → `apiGetLimitsPublic()`.
  - **Всегда** вызывает API (гость ↔ логин). DEFAULT_LIMITS только при сетевой ошибке.
  - `useEffect` теперь безусловно вызывает `refresh()` при смене `user?.id || accessToken`.
- **Проверка**: админ выставляет guest (workspacesCount=2, anomaliesEnabled=1, compressionMax=4, maxIndicators=3) → гость без логина получает эти значения (200, не 401). Авторизованные тарифы продолжают работать.
- **Затронутые файлы**:
  - `backend/internal/auth/handlers.go:131,735-739`
  - `frontend/src/features/auth/api.ts` (+apiGetLimitsPublic)
  - `frontend/src/contexts/LimitsContext.tsx` (всегда fetch, DEFAULT_LIMITS только при ошибке)
- Не в этой задаче (потом): применение на клиенте лимита истории по ТФ и telegram.
- **Тесты/проверки**:
  - `go test ./...`: ALL PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (705ms)

### [2026-06-18] Фаза 12 Этап 5 Fix: диагностика /user/limits — бэкенд корректен, проблема на фронте
- Go-тест напрямую: admin token → compressionMax=10, workspaces=2, indicators=100, anomalies=1. Free → 1/1. Guest → 4/2. **Эндпоинт работает правильно.**
- Добавлен `console.log` в LimitsContext catch/refresh для видимости в DevTools Console.
- Пользователь должен проверить: строку `[LimitsContext] fetched:` (данные) или `[LimitsContext] fetch error:` (ошибка → DEFAULT_LIMITS → guest-minimum).
- Вероятная причина: `apiGetLimits()` бросает ошибку → catch → DEFAULT_LIMITS.

### [2026-06-18] Фаза 12 Этап 5: Единый источник лимитов (GET /user/limits + useUserLimits)
- Проблема: compressionMax кэшировался при старте сервера, остальные лимиты (workspaces, indicators, anomalies) клиент не получал вообще.
- Решение: новый эндпоинт + hook для реалтайм-чтения лимитов из БД.
- **Бэкенд — GET /api/v1/user/limits** (auth/handlers.go:729-786):
  - RequireAuth. Читает role из JWT (r.Context().Value(RoleKey)).
  - SELECT из tier_policies WHERE tier = role — **в реальном времени**, без кэша.
  - Fallback на guest-дефолты если строки нет.
  - Возвращает все поля: compressionMax, maxIndicators, customIndicatorSettings, telegramEnabled, workspacesCount, anomaliesEnabled, sessionLimit, historyDaysPerTf.
  - camelCase JSON (через struct tags).
  - Маршрут зарегистрирован: `mux.HandleFunc("GET /api/v1/user/limits", RequireAuth(h.cfg)(...))` — auth/handlers.go:131.
- **Бэкенд — GetLimitsForTier** (admin/tier_policies.go:140-158): хелпер для прямого SELECT по tier (для использования из auth пакета — написан SQL напрямую в handler из-за циклического импорта admin↔auth).
- **Фронтенд — LimitsContext** (contexts/LimitsContext.tsx):
  - `LimitsProvider`: оборачивает приложение (после AuthProvider).
  - `useUserLimits()` hook: возвращает `{ limits, loading, refresh }`.
  - `refresh()` → `apiGetLimits()` → `GET /user/limits`.
  - **Перезапрашивает при смене user** (user?.id в deps) — при релогине новый юзер получает свои лимиты.
  - DEFAULT_LIMITS = guest-дефолты (fallback при ошибке/нет юзера).
- **Фронтенд — apiGetLimits** (auth/api.ts:99-101): `request<UserLimits>('/user/limits')`.
- **Применение 4 лимитов:**
  - **Сжатие** (ChartHeader.tsx:73): `compressionMax = limits.compressionMax ?? 1`. Замочки: `compressionMax < 10 && (idx+1) > compressionMax`.
  - **Workspaces** (ChartContainer2.tsx:87): `workspacesCount={limits.workspacesCount}` → ClusterChart блокирует выбор 2-го workspace если < 2.
  - **Indicators** (IndicatorsModal.tsx:21): `maxIndicators = limits.maxIndicators >= 100 ? Infinity : limits.maxIndicators`. Toggle блокируется при `activeCount >= maxIndicators`.
  - **Anomalies** (ChartHeader.tsx:220-238): кнопка заблокирована (`disabled, opacity-40, cursor-not-allowed`) если `limits.anomaliesEnabled === 0`.
- Затронутые файлы:
  - `backend/internal/auth/handlers.go` (+handleGetLimits, +route)
  - `backend/internal/admin/tier_policies.go` (+GetLimitsForTier)
  - `frontend/src/contexts/LimitsContext.tsx` (NEW)
  - `frontend/src/features/auth/api.ts` (+UserLimits, +apiGetLimits)
  - `frontend/src/App.tsx` (+LimitsProvider)
  - `frontend/src/components/ChartHeader.tsx` (limits.compressionMax, anomaliesEnabled)
  - `frontend/src/components/IndicatorsModal.tsx` (limits.maxIndicators, limits.tier)
  - `frontend/src/chart2d/ChartContainer2.tsx` (limits.workspacesCount)
- Тесты/проверки:
  - `go test ./...`: ALL PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS

### [2026-06-18] Фаза 12 Этап 4 Fix v2: диагностика пустых карточек tier-policies
- Причина: **старый бинарник**. Хендлер `handleGetPolicies` (handlers.go:751-758) — РЕАЛЬНЫЙ (вызывает `GetPolicies(h.db)`), routes registered correctly (line 99-100). Но запущенный сервер был собран до добавления реальных хендлеров → отдавал stub-ответ `{ok:true, data:{status:"stub_..."}}`.
- Доказательство: Go-тест напрямую через `RegisterAdminRoutes` → `GetPolicies(db)` возвращает 5 tiers, handler возвращает 401 без токена (admin-only). Код корректен.
- Фикс: `go build ./cmd/procluster/` → перезапуск. Debug-плашка из TierPoliciesBlock удалена.
- Факты: БД содержит 5 строк tier_policies (guest/free/pro/vip/admin) со всеми полями. Миграция и seed отработали.
- Тесты/проверки:
  - `go test ./...`: ALL PASS
  - `npx tsc --noEmit`: PASS
  - `npx vite build`: PASS
- **Действие для пользователя:** пересобрать бэкенд (`go build ./cmd/procluster/`) и перезапустить сервер. После этого GET /api/v1/admin/policies вернёт 5 групп со всеми полями.

### [2026-06-18] Фаза 12 Этап 4 Fix: перенос политик в "Пользователи", i18n, замена chartCompressionLocked
- Что сделано:
  - **П.1 — Перенос вкладки**: Отдельная вкладка `AdminTab='policies'` УДАЛЕНА. Блок "Настройки лимитов и политик" (`TierPoliciesBlock`) перемещён ВНУТРЬ вкладки "Пользователи" — между верхними счётчиками (хосты/зарегистрировано/онлайн) и блоком "Добавить пользователя". Структура как в design-src.
  - **П.2 — Карточки**: Все 8 карточек рендерятся и грузят/сохраняют данные из GET/PUT `/api/v1/admin/tier-policies`. Компонент `TierPoliciesTab` переименован в `TierPoliciesBlock`.
  - **П.3 — i18n**: Добавлены ВСЕ ключи `admin.policies.*` в словари ru.ts, en.ts, kz.ts (28 ключей: title, subtitle, maxHistoryPerTf, maxHistoryPerTfDesc, compressionMax, compressionMaxDesc, maxIndicators, maxIndicatorsDesc, customIndicatorSettings, customIndicatorSettingsDesc, telegramEnabled, telegramEnabledDesc, workspacesCount, workspacesCountDesc, anomaliesEnabled, anomaliesEnabledDesc, sessionLimit, sessionLimitDesc, saveAll, active, inactive, telegramOn, telegramOff, days, activeIndicators, space1, space2, unlimited, sessions). Сырых ключей на экране нет.
  - **П.4 — Хвост сжатия**: `chartCompressionLocked` УДАЛЁН из login response. Заменён на `compressionMax` (int, 1..10). Источник — `tier_policies.compression_max` через `LoadCompressionMax()` в admin/tier_policies.go. `SetTierCompressionMax(map[string]int)` в auth handler. ChartHeader.tsx переключен: `user?.compressionMax ?? 1`. Логика замочков: `compressionMax < 10 && (idx+1) > compressionMax` — блокирует уровни выше лимита.
  - **Бэкенд**: `LoadCompressionMax()` добавлен в admin/tier_policies.go. `main.go` загружает compressionMax из tier_policies и передаёт в authHandler. `chartCompressionLocked` удалён из userResponseData. `tierCompressionLocked map[string]bool` заменён на `tierCompressionMax map[string]int` в auth Handler.
  - **Тесты**: 5 тестов compression-locked обновлены на compressionMax. Все PASS.
- Затронутые файлы:
  - `backend/internal/auth/handlers.go` (tierCompressionMax, compressionMax в userResponseData)
  - `backend/internal/auth/handlers_test.go` (5 тестов обновлены)
  - `backend/internal/admin/tier_policies.go` (+LoadCompressionMax)
  - `backend/cmd/procluster/main.go` (+LoadCompressionMax wiring)
  - `frontend/src/features/auth/api.ts` (chartCompressionLocked → compressionMax)
  - `frontend/src/components/ChartHeader.tsx` (compressionMax logic)
  - `frontend/src/components/AdminPanel.tsx` (policies → Users tab, TierPoliciesBlock)
  - `frontend/src/i18n/dictionaries/ru.ts` (+admin.policies)
  - `frontend/src/i18n/dictionaries/en.ts` (+admin.policies)
  - `frontend/src/i18n/dictionaries/kz.ts` (+admin.policies)
- Тесты/проверки:
  - `go test ./...`: ALL PASS
  - `go vet ./...`: PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (489ms)

### [2026-06-18] Фаза 12 Этап 4: Вкладка "Настройки лимитов и политик групп" — полная реализация
- Что сделано:
  - **Миграция (auth/sqlite.go)**: Идемпотентно через PRAGMA table_info добавлены новые колонки к tier_policies: `compression_max INTEGER DEFAULT 1`, `max_indicators INTEGER DEFAULT 1`, `custom_indicator_settings INTEGER DEFAULT 0`, `telegram_enabled INTEGER DEFAULT 0`, `workspaces_count INTEGER DEFAULT 1`, `anomalies_enabled INTEGER DEFAULT 0`, `history_days_per_tf TEXT DEFAULT '{"1m":1,"5m":1,"15m":1,"30m":1,"1h":1,"4h":1}'`. Старая колонка `chart_compression_locked` оставлена неиспользуемой (SQLite не поддерживает DROP COLUMN идемпотентно).
  - **TierPolicy struct (admin/tier_policies.go)**: Полностью переписан — новые поля `CompressionMax`, `MaxIndicators`, `CustomIndicatorSettings`, `TelegramEnabled`, `WorkspacesCount`, `AnomaliesEnabled`, `HistoryDaysPerTf map[string]int`. Удалены `LoadCompressionLocked`, `EnsureCompressionLockedValues`, `ChartCompressionLocked`.
  - **Seed defaults**: guest(1/7/1/1/0/0/1/0), free(1/180/1/1/0/0/1/0), pro(2/-1/3/5/0/1/2/1), vip(2/-1/6/15/1/1/2/1), admin(-1/-1/10/100/1/1/2/1). history_days_per_tf: guest/free=all 1, pro=3/7/14/30/60/180, vip=7/14/30/60/120/360, admin=14/30/60/120/240/720.
  - **GetPolicies**: Читает все поля + JSON unmarshal history_days_per_tf.
  - **UpsertPolicies**: INSERT ON CONFLICT DO UPDATE со всеми новыми полями + JSON marshal history_days_per_tf.
  - **GET /api/v1/admin/tier-policies**: Реализован (ранее был stub). Admin-only. Возвращает 5 групп со всеми полями.
  - **PUT /api/v1/admin/tier-policies**: Реализован (ранее был stub). Валидация: compression_max 1..10, session_limit >= -1, max_indicators >= 0, custom_indicator_settings/telegram_enabled/anomalies_enabled 0/1, workspaces_count 1..2, history_days_per_tf 6 валидных ключей ТФ с days >= 0. Admin-only, audit log.
  - **main.go**: Удалены `EnsureCompressionLockedValues`, `LoadCompressionLocked`, `srv.SetTierCompressionLocked`, `authHandler.SetTierCompressionLocked`.
  - **Frontend AdminPanel.tsx**: Новая вкладка "Настройки лимитов и политик" (AdminTab='policies'). 5 под-табов (GUEST/FREE/PRO/VIP/ADMIN) с цветовыми бейджами. 8 карточек: (1) история по 6 ТФ, (2) compression_max с range 1..10, (3) max_indicators числовое поле, (4) custom_indicator_settings toggle, (5) telegram_enabled toggle, (6) workspaces_count 1/2, (7) anomalies_enabled toggle, (8) session_limit числовое поле. Кнопка "Сохранить все лимиты". Верстка 1:1 по design-src.
  - **Frontend admin/api.ts**: TierPolicy интерфейс обновлен под новую схему. apiGetPolicies/apiUpdatePolicies обновлены.
  - **Tests**: tier_policies_test.go переписан под новую схему (9 тестов). Тесты compression-locked удалены.
- Затронутые файлы:
  - `backend/internal/auth/sqlite.go` (+7 колонок к tier_policies)
  - `backend/internal/admin/tier_policies.go` (полная перезапись)
  - `backend/internal/admin/tier_policies_test.go` (полная перезапись)
  - `backend/internal/admin/handlers.go` (реализация GET/PUT policies)
  - `backend/cmd/procluster/main.go` (удалены compression-locked вызовы)
  - `frontend/src/features/admin/api.ts` (обновлен TierPolicy)
  - `frontend/src/components/AdminPanel.tsx` (новая вкладка policies)
- Тесты/проверки:
  - `go test ./...`: ALL PASS
  - `go vet ./...`: PASS
  - `gofmt -l` на изменённых файлах: PASS
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npx vite build`: PASS (529ms)

### [2026-06-15] Фаза 12 Этап 2 Подшаг 2.1: tier_policies в БД + рефактор лимитов с fallback
- Модель: Opus
- Что сделано:
  - **Миграция (auth/sqlite.go, пункт 6)**: `CREATE TABLE IF NOT EXISTS tier_policies (tier TEXT PRIMARY KEY, session_limit INTEGER, history_max_days INTEGER, created_at, updated_at)` — идемпотентно, не ломает порядок миграций.
  - **Seed (admin/SeedTierPolicies)**: при пустой таблице INSERT 5 строк с текущими значениями: guest(1/7), free(1/180), pro(2/-1), vip(2/-1), admin(-1/-1). Идемпотентен (проверка COUNT > 0). Вызывается в main.go рядом с SeedDefaultTickers/Compressions.
  - **LoadTierPolicies**: читает из БД, возвращает `sessionLimits map[string]int` + `historyLimits map[string]time.Duration` (-1→-1, дни→days*24h). Если таблица пуста → nil (fallback).
  - **Session limits в main.go**: `admin.LoadTierPolicies()` → если не nil, передаётся в `NewSessionManager(rdb, dbSessionLimits)`. Иначе `authCfg.SessionLimits`. `session.go:75-81` hardcoded fallback при limits==nil ОСТАВЛЕН.
  - **History gating (api/candles.go)**: добавлен `Server.tierHistoryLimits` + `SetTierHistoryLimits()`. `resolveHistoryDepth(role)` — сначала проверяет `tierHistoryLimits[role]`, затем fallback на `maxDepthForRole(role, cfg)`. `maxDepthForRole` как standalone функция оставлена для тестов.
  - **AuthConfig**: SessionLimits, HistoryMaxGuest/HistoryMaxFree ОСТАВЛЕНЫ как fallback.
  - **GetPolicies/UpsertPolicies**: функции в admin/tier_policies.go для будущих админ-эндпоинтов.
- Поведение НЕ изменилось: seed воспроизводит ровно те же значения, что были в хардкоде. При пустой таблице — полный fallback на AuthConfig/switch.
- Затронутые файлы:
  - `backend/internal/auth/sqlite.go` (+tier_policies CREATE TABLE)
  - `backend/internal/admin/tier_policies.go` (NEW — Seed, Load, Get, Upsert)
  - `backend/internal/admin/tier_policies_test.go` (NEW — 9 тестов)
  - `backend/internal/api/candles.go` (+resolveHistoryDepth, +s.tierHistoryLimits check)
  - `backend/internal/api/server.go` (+tierHistoryLimits field, +SetTierHistoryLimits)
  - `backend/cmd/procluster/main.go` (+SeedTierPolicies, +LoadTierPolicies → session/history wiring)
- Ключевые решения:
  - Seed в админ-пакете (не в auth), вызывается в main.go.
  - `resolveHistoryDepth` метод на Server с fallback на `maxDepthForRole` — api не импортирует admin.
  - Session limits передаются мапой из main.go, не читаются из БД в рантайме.
  - Fallback трёхуровневый: (1) БД, (2) AuthConfig/env, (3) хардкод в session.go.
- Тесты: 9 новых (seed, load, empty table, idempotency, upsert, value match). Полная регрессия: auth(55/55), api(12/12), admin(39/39), aggregation(14/14), depth(12/12), history(8/8), ingest(5/5), clickhouse — ALL PASS. go vet PASS. tsc --noEmit PASS. vite build PASS. go build PASS.

### [2026-06-14] Фаза 12 Этап 1 Fix v2: ClickHouse size окончательный + суточные графики + растяжка высоты
- Модель: Opus (mimo-v2.5-free)
- Что сделано:
  - **FIX 1 — ClickHouse size**: `SELECT COALESCE(sum(bytes_on_disk), 0) FROM system.parts WHERE database = ?` — скан в `var size uint64`, затем `int64(size)` для JSON. Драйвер clickhouse-go v2 не поддерживает каст UInt64→int64 напрямую — нужно сканировать в `*uint64`.
  - **FIX 1b — sampler disk path**: `sampleOnce()` исправлен: `disk.Usage(".")` → `disk.Usage(dataDir)` где `dataDir = filepath.Dir(SQLITE_PATH)`.
  - **TASK 2 — Суточная история метрик**:
    - `admin/metrics_history.go`: `MetricsHistory` — ring buffer на 1440 точек (24ч × 60мин). `MetricsPoint`: timestamp, cpuPercent, ramPercent, ramUsedGB, diskPercent, diskUsedGB. `sync.RWMutex`.
    - `MetricsHistory.StartSampler(ctx)`: goroutine, раз в 60с снимает CPU/RAM/Disk через gopsutil и пишет в буфер. Стартует в main.go. Первая точка сразу (не ждать 60с).
    - `handleGetMetricsHistory`: `GET /api/v1/admin/metrics/history` — admin-only endpoint, возвращает массив точек за 24ч.
    - Frontend: `apiGetMetricsHistory()` опрашивает каждые 30с. Под каждой карточкой (CPU/RAM/Disk) — SVG area/line график за сутки с gradient fill.
    - При старте буфер пуст, график копится (ожидаемо, вариант A, обнуляется при рестарте).
  - **TASK 3 — Растяжка высоты**: Карточки CPU/RAM/Disk — `flex-1 min-h-0` (равномерно заполняют высоту). Chart container — `flex-1 min-h-[40px]` (растёт вместе с картой). Grid — `items-stretch` + `h-full` на левой колонке.
  - **FIX 4 — DailyChart threshold**: `data.length === 0` вместо `< 2`. При 1 точке рисуется dot. При 0 — "Collecting data...".
- Затронутые файлы:
  - `backend/internal/admin/metrics.go` (uint64 scan, без toInt64 в SQL)
  - `backend/internal/admin/metrics_history.go` (NEW — ring buffer 1440 + sampler + handler, disk path fix)
  - `backend/internal/admin/handlers.go` (+metricsHist field, +route)
  - `backend/internal/admin/handlers_test.go`, `metrics_test.go` (обновлены NewAdminHandler)
  - `backend/cmd/procluster/main.go` (metricsHist init + StartSampler)
  - `frontend/src/features/admin/api.ts` (+apiGetMetricsHistory, +MetricsHistoryPoint)
  - `frontend/src/components/AdminPanel.tsx` (DailyChart 1-point support, flex-1 chart, items-stretch grid)
- Ключевые решения:
  - **uint64 scan** — clickhouse-go v2 `driver.Row.Scan()` не поддерживает UInt64→int64. Нужно сканировать в `*uint64` и конвертировать в Go.
  - **MetricsHistory в памяти** — ring buffer 1440 точек, НЕ в БД. При рестарте обнуляется (вариант A).
  - **Sampler 60с** — не нагружает CPU, один замер в минуту.
  - **Frontend** — метрики каждые 3с, история каждые 30с. Графики из данных history.
- Тесты: 12/12 admin, ALL PASS full regression, tsc 0 errors, vite build PASS

### [2026-06-14] Фаза 12 Этап 1 — Server Metrics + Ring Buffer Logs
- Модель: Opus (mimo-v2.5-free)
- Что сделано:
  - **Go dependency**: `go get github.com/shirou/gopsutil/v3` (pure Go, no CGO) — добавлен в go.mod/go.sum
  - **`backend/internal/admin/metrics.go`**: `MetricsResponse` struct + `handleGetMetrics` — реальная реализация вместо заглушки
    - CPU: `cpu.Percent(500ms, false)` через gopsutil
    - RAM: `mem.VirtualMemory()` — Used/Total/Percent в GB
    - Disk: `disk.Usage(dataDir)` — dirname от SQLITE_PATH
    - SQLite size: `os.Stat(sqlitePath).Size()`
    - ClickHouse size: `SELECT sum(bytes_on_disk) FROM system.parts WHERE database = ?` через `chRepo.QueryRow()` (добавлен в ClickhouseRepository)
    - Registered count: `SELECT COUNT(*) FROM users`
    - Online count: SCAN по `chart_sessions:*` — подсчёт уникальных ключей (каждый ключ = один пользователь)
    - Logs: из ring buffer
  - **`backend/internal/admin/logbuffer.go`**: Ring buffer на 200 строк (`sync.RWMutex`, `[]string`). Реализует `io.Writer`. `GetLogs()` возвращает последние 100 строк.
  - **`backend/internal/repository/clickhouse/clickhouse.go`**: Добавлен метод `QueryRow(ctx, query, args...)` — обёртка над `conn.QueryRow()` для произвольных SELECT
  - **`backend/cmd/procluster/main.go`**: Инициализация ring buffer + `log.SetOutput(io.MultiWriter(os.Stderr, logBuf))` первым делом. `logBuf` пробрасывается в `NewAdminHandler`.
  - **`backend/internal/admin/handlers.go`**: Добавлено поле `logBuf *LogBuffer` в `AdminHandler`. Убрана заглочка `handleGetMetrics` (перенесена в metrics.go).
  - **`backend/internal/admin/metrics_test.go`**: 8 тестов — `TestGetMetrics_SQLiteSize` (>0), `TestGetMetrics_UserCount` (>=0), `TestGetMetrics_ClickHouseBytes` (>=0, не падает при nil chRepo), `TestGetMetrics_RAM` (>0), `TestGetMetrics_CPU` (>=0), `TestGetMetrics_HTTP` (200 + non-empty body), `TestLogBuffer_RingRetainsLast200` (250 записей → хранит последние 200), `TestLogBuffer_Concurrent` (нет гонок при параллельной записи)
  - **Frontend `AdminPanel.tsx`**: Заменён `ServerTabPlaceholder` на реальный `ServerTab` — 3 карточки метрик (CPU amber, RAM emerald, Disk blue) с progress bar + SVG sparkline (последние 25 замеров), InfoCard для DB size + Users, лог-консоль с нумерацией и автоскроллом. Polling каждые 3с через `useEffect + setInterval`.
  - **Frontend `api.ts`**: Добавлено поле `logs: string[]` в `ServerMetrics` interface.
- Затронутые файлы/папки (изменены):
  - `backend/go.mod` (+gopsutil/v3)
  - `backend/internal/admin/metrics.go` (NEW)
  - `backend/internal/admin/logbuffer.go` (NEW)
  - `backend/internal/admin/metrics_test.go` (NEW — 8 tests)
  - `backend/internal/admin/handlers.go` (+logBuf field, -stub handleGetMetrics)
  - `backend/internal/admin/handlers_test.go` (обновлены вызовы NewAdminHandler)
  - `backend/internal/repository/clickhouse/clickhouse.go` (+QueryRow method)
  - `backend/cmd/procluster/main.go` (ring buffer init, log.SetOutput, logBuf wiring)
  - `frontend/src/components/AdminPanel.tsx` (real ServerTab with polling)
  - `frontend/src/features/admin/api.ts` (+logs field)
- Ключевые решения:
  - **gopsutil/v3** (pure Go, без CGO) для CPU/RAM/Disk — кроссплатформенно, легко тестируется
  - **Online count через SCAN** по `chart_sessions:*` — каждый ключ = один уникальный пользователь. Стale keys少 (cleanup on next register/heartbeat), для метрик достаточно точно
  - **ClickHouse size**: `QueryRow` метод добавлен в `ClickhouseRepository` — обёртка над `conn.QueryRow()` для произвольных SELECT. Если NULL/пусто → 0, не падаем
  - **Ring buffer**: 200 строк, `io.Writer` для перехвата `log.SetOutput`. Терминальный вывод сохраняется через `MultiWriter`. Буфер хранит уже готовые строки — безопасно (пароли/токены не логируются)
  - **Frontend polling**: `useEffect + setInterval(3000)` с cleanup. Sparkline — SVG polyline из последних 25 замеров (без Math.random)
- Тесты/проверки:
  - `go test ./internal/admin/ -v -count=1`: 12/12 PASS (4 security + 8 metrics/logbuffer)
  - `go test ./internal/auth/ -v -count=1`: 55/55 PASS (no regressions)
  - `go test ./internal/api/ -v`: 20/20 PASS (no regressions)
  - `go build ./...`: PASS
  - `go vet ./...`: PASS
  - `gofmt -l .`: PASS (no unformatted files)
  - `npx tsc --noEmit`: 0 errors
  - `npx vite build`: PASS

### [2026-06-14] Фаза 12 Этап 0 — Admin Panel Shell + Security
- Модель: MiMo (mimo-v2.5-free)
- Что сделано:
  - **SQL admin grant**: `UPDATE users SET email='lynat1k@list.ru', role='admin', email_verified=1 WHERE email='dexter@mail.ru'` → 1 row affected, verified (id=50d98410-5519-4c87-b5d2-bdb557e087d3)
  - **`backend/internal/admin/audit.go`**: `LogAdminAction(ctx, db, userID, action, target, detail, ip)` — INSERTs into `admin_actions` with UUID + RFC3339 timestamp
  - **`backend/internal/admin/ratelimit.go`**: `AdminRateLimiter` struct + `AdminRateLimitMiddleware` — Redis sorted set, 30 req/min default, env-configurable via `ADMIN_RATE_LIMIT_MAX`. Uses `auth.UserIDKey` for context extraction.
  - **`backend/internal/admin/handlers.go`**: `AdminHandler` struct with `db`, `authCfg`, `chRepo` (ClickHouse), `rdb` (Redis), `rl`. `RegisterAdminRoutes(mux)` registers 19 endpoints (metrics, users CRUD, policies, tickers CRUD, history download/jobs, billing CRUD) — all stubs returning `{ok:true, data:{status:"stub_*"}}`. Each wrapped in `RequireAuth → RequireRole("admin") → AdminRateLimitMiddleware`.
  - **`backend/internal/auth/sqlite.go`**: Added `admin_actions` table + 2 indexes to `Migrate()` (id, user_id, action, target, detail, ip, created_at)
  - **`backend/cmd/procluster/main.go`**: Added `admin` import, `admin.NewAdminHandler(sqliteDB, authCfg, repo, rdb)`, `adminHandler.RegisterAdminRoutes(srv.Mux())`
  - **`backend/internal/admin/handlers_test.go`**: 4 tests — `TestAdminRoute_RequireAuth_NoToken`→401, `TestAdminRoute_RequireRole_NonAdmin`→403, `TestAdminRoute_RequireRole_Admin`→200, `TestAuditLog_WrittenOnMutation`→verifies row in DB
  - **`frontend/src/features/admin/api.ts`**: Full API helper module with typed interfaces for all future endpoints (metrics, users, policies, tickers, history download, billing)
  - **`frontend/src/features/auth/api.ts`**: Exported `request<T>()` function (was private) for reuse by admin API
  - **`frontend/src/components/AdminPanel.tsx`**: 4-tab shell component (server/database/users/stats) with `liquid-glass-card`, dark/light theme, lucide-react icons, motion/react animations, tab switching with `AnimatePresence`. Double role check (`user?.role !== 'admin'` → access denied fallback).
  - **`frontend/src/App.tsx`**: Replaced admin placeholder with `<AdminPanel onClose={() => setCurrentView('terminal')} />`
  - **i18n admin.* keys** added to en.ts, ru.ts, kz.ts — title, coreMode, backToTerminal, tabs, server/database/users/stats sections, stub
- Затронутые файлы/папки (изменены):
  - `backend/internal/admin/audit.go` (NEW)
  - `backend/internal/admin/ratelimit.go` (NEW)
  - `backend/internal/admin/handlers.go` (NEW — 19 stub endpoints)
  - `backend/internal/admin/handlers_test.go` (NEW — 4 tests)
  - `backend/internal/auth/sqlite.go` (+admin_actions table in Migrate)
  - `backend/cmd/procluster/main.go` (+admin handler wiring)
  - `frontend/src/features/admin/api.ts` (NEW — typed API helpers)
  - `frontend/src/features/auth/api.ts` (exported request<T>)
  - `frontend/src/components/AdminPanel.tsx` (NEW — 4-tab shell)
  - `frontend/src/App.tsx` (wired AdminPanel)
  - `frontend/src/i18n/dictionaries/en.ts` (admin.* keys expanded)
  - `frontend/src/i18n/dictionaries/ru.ts` (admin.* keys expanded)
  - `frontend/src/i18n/dictionaries/kz.ts` (admin.* keys expanded)
- Ключевые решения:
  - **RequireAuth(cfg) + RequireRole("admin")** on EVERY admin endpoint — no anonymous access
  - **Admin rate-limit** separate from REST rate-limit, keyed by `rl:admin:{userId}`, 30 req/min default
  - **Audit log** on all admin mutations — `admin_actions` table with UUID, user_id, action, target, detail, ip, created_at
  - **Role promotion ONLY via SQL/CLI** — no public endpoint for role changes
  - **ClickHouse client** passed as `*clickhouse.ClickhouseRepository` concrete type to AdminHandler (needs `system.parts` queries not in MarketRepository interface)
  - **Backend uses Go 1.22+ `http.ServeMux`** with method-prefixed patterns (`"GET /api/v1/admin/metrics"`)
  - **Execution order**: 0→1→3→4→2 (riskiest refactoring of session/history limits last)
- Тесты/проверки:
  - `go test ./internal/admin/ -v`: 4/4 PASS
  - `go test ./internal/auth/ -v -count=1`: 55/55 PASS (no regressions)
  - `go test ./internal/api/ -v`: 20/20 PASS (no regressions)
  - `go vet ./...`: PASS
  - `npx tsc --noEmit`: 0 errors
  - `npx vite build`: PASS (941ms)

### [2026-06-14] Багфиксы Фазы 10 — 401 на защищённых эндпоинтах + пустой профиль + скролл
- Модель: MiMo (mimo-v2.5-free)
- Что сделано:
  - **ФИКС 1 — api.ts**: Добавлен module-level `accessTokenRef` + `setApiAccessToken()` экспортируемый setter. Функция `request()` теперь автоматически добавляет `Authorization: Bearer` header если `accessTokenRef` не null. `apiGetMe`, `apiUpdateProfile`, `apiChangePassword` переписаны с голого `fetch` на `request()` с `accessTokenRef` для защищённых эндпоинтов.
  - **ФИКС 2 — AuthContext.tsx**: Добавлен `useEffect([accessToken])` → `setApiAccessToken(accessToken)`. Синхронизация при login, refresh, silent-login, logout(→null). Импорт `setApiAccessToken` из api.ts.
  - **ФИКС 3 — UserProfile.tsx**: `nickname`/`avatar` state инициализируются из `user` (AuthContext) как fallback — герой показывает ник/email сразу без ожидания `/me`. Catch в useEffect заполняет `profile` из `user` вместо silent ignore. `user?.email` и `user?.nickname` используются как fallback в hero и email input. Dependency `useEffect` → `user?.id` вместо `user` (стабильная ссылка).
  - **ФИКС 4 — UserProfile.tsx**: Скролл-фикс v2. Корневой div раздён на два: (1) scroll container `flex-1 min-h-0 overflow-y-auto` (прямой flex-childApp.tsx:103), (2) content wrapper `max-w-7xl mx-auto px-6 py-10 ... flex flex-col gap-8` БЕЗ h-full/overflow. Старый `h-full min-h-0` на внутреннем div не работал потому что `h-full` резолвился от content-based высоты parent (flex-1 overflow-hidden), а не от flex-allocated height. Новый scroll container — прямой flex-child, получает высоту от flex layout.
- Затронутые файлы/папки (изменены):
  - `frontend/src/features/auth/api.ts` (+accessTokenRef, +setApiAccessToken, request() Authorization, apiGetMe/apiUpdateProfile/apiChangePassword через request)
  - `frontend/src/features/auth/AuthContext.tsx` (+import setApiAccessToken, +useEffect([accessToken]))
  - `frontend/src/components/UserProfile.tsx` (fallback из user, min-h-0, user?.id dependency)
- Ключевые решения:
  - Module-level token holder вместо передачи токена через аргументы — проще, нет пропс-дриллинга, работает с React state.
  - `useEffect([accessToken])` в AuthContext — токен всегда синхронизирован с module-level holder.
  - Fallback на `user` из AuthContext — профиль показывает данные сразу, даже до ответа `/me`.
  - `min-h-0` на flex-child — стандартный паттерн для overflow в flex layout.
- Тесты/проверки:
  - `npx tsc --noEmit`: PASS
  - `npx vite build`: PASS (404ms)
  - `go test ./...`: ALL PASS (55 auth + все существующие)

### [2026-06-14] Фаза 10 — Профиль + тарифы
- Модель: MiMo (mimo-v2.5-free)
- Что сделано:
  - **Backend миграция** (`auth/sqlite.go`): Идемпотентный `ALTER TABLE users ADD COLUMN` через `PRAGMA table_info` проверку: `avatar TEXT DEFAULT ''`, `subscription_status TEXT DEFAULT 'none'`, `subscription_paid_at TEXT DEFAULT ''`, `subscription_expires_at TEXT DEFAULT ''`. Колонки добавляются только если отсутствуют.
  - **User struct** (`auth/types.go`): Добавлены `Avatar`, `SubscriptionStatus`, `SubscriptionPaidAt`, `SubscriptionExpiresAt` в `User`.
  - **scanUser/CreateUser/GetByID/GetByEmail** (`auth/sqlite.go`): Расширены на чтение/запись 4 новых колонок. `scanUser` использует `sql.NullString` для совместимости со старыми строками.
  - **userData + issueTokens** (`auth/handlers.go`): `userData` расширена полями `avatar`, `createdAt`, `subscriptionStatus`, `subscriptionPaidAt`, `subscriptionExpiresAt`. `issueTokens` заполняет все поля из `User`.
  - **GET /api/v1/user/me** (`handlers.go`): `handleGetMe` — RequireAuth, `GetUserByID`, расчёт `daysLeft` из `subscriptionExpiresAt`, JSON ответ со всеми полями профиля + `daysLeft`.
  - **PUT /api/v1/user/profile** (`handlers.go`): `handleUpdateProfile` — RequireAuth, `MaxBytesReader(4KB)`, валидация никнейма 2-30, валидация аватара: whitelist `avatar-1..avatar-5` или http/https URL ≤500. `UpdateUserProfile()` SQL UPDATE.
  - **POST /api/v1/user/change-password** (`handlers.go`): `handleChangePassword` — RequireAuth, `MaxBytesReader(4KB)`, `CheckPassword` (argon2id), `HashPassword` новый, `UpdateUserPasswordHash`, `DeleteAllUserSessions` (инвалидация ВСЕХ сессий → forced re-login), `clearRefreshCookie`.
  - **RegisterRoutes**: +3 маршрута: `GET /user/me`, `PUT /user/profile`, `POST /user/change-password`.
  - **sqlite.go**: `UpdateUserProfile()`, `UpdateUserPasswordHash()` функции.
  - **handlers_test.go**: 12 новых тестов (55 total): `TestGetMeSuccess`, `TestGetMeUnauthorized`, `TestChangePasswordSuccess`, `TestChangePasswordWrongCurrent`, `TestChangePasswordShortNew`, `TestChangePasswordSessionsInvalidated`, `TestUpdateProfileSuccess`, `TestUpdateProfileInvalidNickname`, `TestUpdateProfileInvalidAvatar`, `TestUpdateProfileEmptyAvatar`, `TestUpdateProfileAvatarURL`. Хелперы `createVerifiedUser`, `authRequest` (с имитацией RequireAuth через context).
  - **AuthUser + api.ts** (`features/auth/api.ts`): `AuthUser` расширен: `avatar`, `createdAt`, `subscriptionStatus`, `subscriptionPaidAt`, `subscriptionExpiresAt`. Новые API: `apiGetMe()`, `apiUpdateProfile()`, `apiChangePassword()`.
  - **UserProfile.tsx** (`components/UserProfile.tsx`): Компонент-профиль (view). Hero-секция с аватаром (gradient presets avatar-1..5, custom URL, initials fallback) + никнейм + бейдж тарифа. Форма профиля: ник (editable), аватар-пресеты + URL input, email (readonly), Save. Карточка подписки: tier badge, payment/expiry dates, daysLeft, status. Смена пароля: текущий + новый + подтверждение → POST → forced reload. Сравнение тарифов: Free/$0, Pro/$19, VIP/$49 с таблицей лимитов (графики, свечи, сжатие, индикаторы, кастомные настройки, рисунки, Telegram, свои индикаторы). Кнопка «Активировать» → заглушка `alert()`.
  - **App.tsx**: Импорт `UserProfile`, замена заглушки `currentView === 'profile'` на `<UserProfile onClose={() => setCurrentView('terminal')} />`.
  - **i18n**: Расширены `profile.*` ключи в en/ru/kz (~40 ключей: title, backToTerminal, personalInfo, username, email, regDate, tierStatus, saveChanges, savedSuccess, avatarSelect, orCustomUrl, changePassword, currentPassword, newPassword, confirmPassword, passwordChanged, wrongPassword, subInfo, paymentDate, expiryDate, daysRemaining, statusActive, statusNone, choosePlan, planFreeDesc, planProDesc, planVipDesc, currentPlan, activate, activateSoon, props*, yes/no).
  - **Playwright e2e** (`e2e/profile.spec.ts`): 5 тестов — profile opens from header, update nickname, change password shows confirmation, profile shows subscription info, back to terminal.
- Затронутые файлы/папки (созданы):
  - `frontend/src/components/UserProfile.tsx` (создан)
  - `frontend/e2e/profile.spec.ts` (создан)
- Затронутые файлы/папки (изменены):
  - `backend/internal/auth/sqlite.go` (+migration ALTER TABLE, +scanUser расширение, +CreateUser/GetByID/GetByEmail расширение, +UpdateUserProfile, +UpdateUserPasswordHash)
  - `backend/internal/auth/types.go` (+4 поля в User)
  - `backend/internal/auth/handlers.go` (+userData поля, +issueTokens расширение, +handleGetMe, +handleUpdateProfile, +handleChangePassword, +RegisterRoutes ×3, +validAvatarPresets)
  - `backend/internal/auth/handlers_test.go` (+12 тестов, +createVerifiedUser, +authRequest хелперы, +GetUserByIDMust)
  - `frontend/src/features/auth/api.ts` (+AuthUser поля, +apiGetMe, +apiUpdateProfile, +apiChangePassword)
  - `frontend/src/App.tsx` (+UserProfile импорт, замена заглушки)
  - `frontend/src/i18n/dictionaries/en.ts` (profile.* расширены)
  - `frontend/src/i18n/dictionaries/ru.ts` (profile.* расширены)
  - `frontend/src/i18n/dictionaries/kz.ts` (profile.* расширены)
- Ключевые решения:
  - Тариф = колонка `role` (Free/Pro/VIP/Admin), отдельная `subscription_plan` НЕ заводится.
  - Аватары: нейтральные gradient presets (avatar-1..5), без реальных персон.
  - Смена пароля → инвалидация ВСЕХ сессий + forced re-login (безопаснее, чем «кроме текущей»).
  - Биллинг/оплата НЕ в фазе 10 — кнопка «Активировать» → заглушка.
  - Активные сессии — экран НЕ делаем (лимит работает на бэкенде).
  - `requireAuth` в тестах: хелпер `authRequest` устанавливает context values напрямую (без реального middleware).
- Тесты/проверки:
  - `go build ./...`: PASS
  - `go vet ./...`: PASS
  - `gofmt -l .`: PASS (0 файлов)
  - `go test ./...`: ALL PASS (55 auth + все существующие)
  - `npx tsc --noEmit`: PASS
  - `npx vite build`: PASS (437ms)
  - Playwright e2e: 5 тестов (profile.spec.ts) — requires running backend+frontend

### [2026-06-14] Фаза 9 — Этап 3: Frontend auth + user settings
- Модель: MiMo (mimo-v2.5-free)
- Что сделано:
  - **Backend user_settings** (`auth/user_settings.go`): SQLite таблица `user_settings` (user_id PK, settings_json TEXT, updated_at). `GetUserSettings()`, `UpsertUserSettings()` (INSERT ON CONFLICT DO UPDATE). Migration добавлена в `Migrate()`. Эндпоинты `GET /api/v1/user/settings` и `PUT /api/v1/user/settings` под `RequireAuth`. PUT: `MaxBytesReader(10KB)`, JSON string body.
  - **auth/api.ts**: `apiLogin`, `apiRegister`, `apiLogout`, `apiRefresh`, `apiVerifyEmail`, `apiResendVerification`, `apiGetSettings`, `apiPutSettings`. Все через `fetch` с `credentials: 'include'` для cookie. Базовый путь `/api/v1`.
  - **AuthContext.tsx** (`features/auth/`): `AuthProvider` + `useAuthContext()`. State: `user: AuthUser | null`, `accessToken: string | null`, `loading: boolean`. При старте — `POST /auth/refresh` (silent-login через httpOnly cookie). Auto-refresh по таймеру (обновление за 2 минуты до истечения). `logout()` — вызов API + очистка state.
  - **LoginModal.tsx**: email+password, кнопка Войти, Google кнопка (disabled, tooltip "Скоро"), ссылка на регистрацию. Inline-ошибки: INVALID_CREDENTIALS → t('auth.errorInvalidCredentials'), ACCOUNT_LOCKED → t('auth.errorAccountLocked'), RATE_LIMITED → t('auth.errorRateLimited'). Закрытие: Escape, backdrop, крестик. Анимации: motion/react scale+opacity.
  - **RegisterModal.tsx**: nickname+email+password+confirm. Клиент-валидация (email regex, password>=8, совпадение). После успеха → экран "Проверьте email" (Mail icon + текст + кнопка Закрыть). Google кнопка disabled.
  - **VerifyEmailBanner.tsx**: если `user && !emailVerified` → баннер с `POST /auth/recovery` (resend). Фиксирован `top-12`, z-index 99998.
  - **UserSettingsContext.tsx**: для залогиненных — load из API при mount, save в API (debounce 500ms). Для гостя — localStorage (`procluster_user_settings`). При логине — мерж localStorage → API. `setSetting(key, value)`, `getSetting<T>(key, fallback)`.
  - **App.tsx**: `AuthProvider` > `UserSettingsProvider` > `CandlePaletteProvider` > `ChartControlsProvider` > `LayoutProvider` > `AppShell`. Кнопка "Войти" (amber) в хедере когда не залогинен, никнейм + "Выйти" когда залогинен. `LoginModal` + `RegisterModal` модалки. `VerifyEmailBanner` при неподтверждённом email. Admin видна при `role === 'admin'`.
  - **ChartHeader.tsx**: заменён `useAuth()` на `useAuthContext()`. `isFree` проверяет `user?.role ?? 'guest'` (lowercase, как в JWT).
  - **i18n**: добавлены ключи `auth.confirmPassword`, `auth.noAccount`, `auth.hasAccount`, `auth.verifyEmailTitle/Message/Banner`, `auth.resendEmail`, `auth.emailSent`, `auth.error*` (7 ошибок) в en/ru/kz словари.
  - **Playwright e2e**: auth.spec.ts (5 тестов — register modal, login modal, wrong credentials, register+login flow, escape closes modal), settings.spec.ts (3 теста — localStorage persist, guest mode, chart renders).
- Затронутые файлы/папки (созданы):
  - `backend/internal/auth/user_settings.go` (создан)
  - `frontend/src/features/auth/api.ts` (создан)
  - `frontend/src/features/auth/AuthContext.tsx` (создан)
  - `frontend/src/features/auth/LoginModal.tsx` (создан)
  - `frontend/src/features/auth/RegisterModal.tsx` (создан)
  - `frontend/src/features/auth/VerifyEmailBanner.tsx` (создан)
  - `frontend/src/contexts/UserSettingsContext.tsx` (создан)
  - `frontend/e2e/auth.spec.ts` (создан)
  - `frontend/e2e/settings.spec.ts` (создан)
- Затронутые файлы/папки (изменены):
  - `backend/internal/auth/sqlite.go` (+user_settings migration)
  - `backend/internal/auth/handlers.go` (+GET/PUT /user/settings routes, +handleGetSettings, +handlePutSettings)
  - `frontend/src/App.tsx` (+AuthProvider, +UserSettingsProvider, +LoginModal, +RegisterModal, +VerifyEmailBanner, +login button, +logout)
  - `frontend/src/components/ChartHeader.tsx` (useAuth → useAuthContext, isFree lowercase)
  - `frontend/src/i18n/dictionaries/en.ts` (+auth keys)
  - `frontend/src/i18n/dictionaries/ru.ts` (+auth keys)
  - `frontend/src/i18n/dictionaries/kz.ts` (+auth keys)
- Ключевые решения:
  - Silent-login через POST /auth/refresh при старте — refresh cookie httpOnly, не требует interaction
  - Auto-refresh за 2 минуты до истечения — бесшовная сессия
  - UserSettings: localStorage для гостей, API для залогиненных, мерж при логине
  - Debounce 500ms для settings save — не спамим API при каждом изменении
  - VerifyEmailBanner: отдельный z-index 99998, не перекрывает модалки (99999)
  - Google OAuth: disabled кнопка + tooltip "Скоро" — не ломает UI, показывает планы
  - Все роли lowercase в JWT/frontend: guest, free, pro, vip, admin
- Тесты/проверки:
  - `go build ./...`: PASS
  - `go vet ./...`: PASS
  - `go test ./...`: ALL PASS
  - `npx tsc --noEmit`: PASS
  - `npx vite build`: PASS (475ms)
  - Playwright e2e: auth.spec.ts (5), settings.spec.ts (3) — requires running backend+frontend

### [2026-06-14] Фаза 9 — Этап 2: Rate-limit/lockout, session limits из config, history gating
- Модель: MiMo (mimo-v2.5-free)
- Что сделано:
  - **Auth rate-limiter** (`auth/ratelimit.go`): Redis sorted set sliding window. `CheckLogin(ip, email)` — лимит 10/5min. `CheckRegister(ip)` — 5/hour. `CheckRecovery(email)` — 3/hour. Все числа из `AuthConfig`/env. `RecordLoginFailure(userID)` — инкремент счётчика `failed:{user_id}` с TTL = LockoutWindow. При достижении `LockoutThreshold` → установка `lockout:{user_id}` с TTL. `CheckLockout(userID)` — проверка TTL lockout. `ClearFailures(userID)` — сброс при успешном логине. Progressive delay: 1→0s, 2→1s, 3→2s, 4→4s, 5+→8s.
  - **AuthConfig расширена** (`auth/config.go`): добавлены `RateLimitWindow`, `RateLimitLoginMax`, `RateLimitRegisterMax`, `RateLimitRecoveryMax`, `LockoutThreshold`, `LockoutWindow`, `HistoryMaxGuest` (7d), `HistoryMaxFree` (180d), `SessionLimits` map. Все из env: `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_REGISTER_MAX`, `RATE_LIMIT_RECOVERY_MAX`, `LOCKOUT_THRESHOLD`, `LOCKOUT_WINDOW`, `SESSION_LIMIT_GUEST/FREE/PRO/VIP`. `parseIntEnv()` helper.
  - **Handlers с rate-limit** (`auth/handlers.go`): `NewHandler` принимает `*AuthRateLimiter`. `handleLogin` — проверка `CheckLogin` → 429 + Retry-After, проверка `CheckLockout` → 403 ACCOUNT_LOCKED + Retry-After, `RecordLoginFailure` при неверном пароле → progressive delay → lockout, `ClearFailures` при успехе. `handleRegister` — `CheckRegister` → 429 + Retry-After. `handleRecovery` — новый эндпоинт `POST /api/v1/auth/recovery`, rate-limit, всегда OK (не раскрывает существование email). User role при register: `"free"` (не `"Free"` — приведено к lowercase для консистентности с JWT).
  - **History gating** (`api/candles.go`): `maxDepthForRole(role, cfg)` — guest: 7d, free: 180d, pro/vip/admin: unlimited (-1). `before` параметр (unix ms) проверяется: если `now - before > maxDepth` → `before = cutoff`. С role из JWT через `auth.ExtractUserFromRequest(s.authCfg, r)`, fallback `"guest"` для неавторизованных.
  - **Session limits из config** (`api/session.go`): `NewSessionManager(rdb, limits map[string]int)` — limits передаются из `AuthConfig.SessionLimits`. Fallback default если limits=nil. Удалён hardcoded `sessionLimits` map.
  - **main.go**: `NewSessionManager(rdb, authCfg.SessionLimits)`, `NewHandler(authCfg, sqliteDB, auth.NewAuthRateLimiter(rdb, authCfg))`.
  - **Тесты** (43+ auth, 5 api): auth/ratelimit_test.go (8 тестов — sliding window, lockout, clear failures, progressive delay), auth/middleware_test.go (9 тестов — Bearer/query/no-token/expired/RequireAuth/RequireRole), api/candles_gating_test.go (7 тестов — maxDepthForRole для всех ролей, cutoff calculation), api/session_link_test.go (4 теста — config limits, default fallback, unknown tier, unlimited pro). Все PASS.
- Затронутые файлы/папки (созданы):
  - `backend/internal/auth/ratelimit.go` (создан)
  - `backend/internal/auth/ratelimit_test.go` (создан)
  - `backend/internal/auth/middleware_test.go` (создан)
  - `backend/internal/api/candles_gating_test.go` (создан)
  - `backend/internal/api/session_link_test.go` (создан)
- Затронутые файлы/папки (изменены):
  - `backend/internal/auth/config.go` (+rate-limit/lockout/session-limit/env fields, +parseIntEnv)
  - `backend/internal/auth/handlers.go` (+rl field, +rate-limit в login/register, +recovery endpoint, role lowercase)
  - `backend/internal/auth/jwt_test.go` (+rate-limit fields в testConfig)
  - `backend/internal/api/candles.go` (+history gating, +maxDepthForRole, +time import)
  - `backend/internal/api/session.go` (-hardcoded sessionLimits, +limits param в NewSessionManager)
  - `backend/internal/api/session_test.go` (обновлён NewSessionManager вызов)
  - `backend/cmd/procluster/main.go` (+authCfg.SessionLimits в sm, +AuthRateLimiter в handler)
- Ключевые решения:
  - Redis sorted set для sliding window — атомарность, TTL автоматический, один ключ на endpoint
  - Progressive delay перед lockout — замедление атакующего, не мгновенный lockout
  - Recovery всегда OK — не раскрывает существование email (security best practice)
  - History gating через role из JWT — сервер доверяет только своей роли, не клиенту
  - guest=7d, free=180d, pro+=unlimited — сервер-side clamp, клиент не может обойти
  - Session limits из AuthConfig/env — настройка без перекомпиляции
- Тесты/проверки:
  - `go build ./...`: PASS
  - `go vet ./...`: PASS
  - `gofmt -l .`: PASS (0 файлов)
  - `go test ./...`: ALL PASS (43+ auth + 5 api + все существующие)

### [2026-06-14] Фаза 9 — Этап 1: Авторизация (БД + регистрация/вход)
- Модель: MiMo (mimo-v2.5-free)
- Что сделано:
  - **SQLite-схема** (`auth/sqlite.go`): 3 таблицы — `users` (id, email, nickname, password_hash, role, email_verified, created_at, updated_at), `sessions` (id, user_id, refresh_token_hash, user_agent, ip, created_at, expires_at, rotated), `email_verifications` (id, user_id, email, expires_at, used, created_at). Auto-migrations через `CREATE TABLE IF NOT EXISTS`. Индексы на sessions(user_id), sessions(refresh_token_hash), email_verifications(id, used).
  - **argon2id** (`auth/password.go`): `HashPassword()` — генерация salt 16 байт, argon2id(m=65536, t=3, p=1, keyLen=32). Стандартный encoded формат `$argon2id$v=19$m=65536,t=3,p=1$salt$hash`. `CheckPassword()` — парсинг параметров из хеша, проверка. `HashRefreshToken()` — SHA-256. `GenerateRefreshToken()` — crypto/rand 64 байта → hex (128 символов).
  - **JWT** (`auth/jwt.go`): `GenerateAccessToken()` — HS256, claims: sub(userID), role, exp(+15m), iat. `ParseAccessToken()` — валидация подписи и срока.
  - **Эндпоинты** (`auth/handlers.go`): `POST /api/v1/auth/register` (валидация email regex, password≥8, nickname 2-30, уникальность email, argon2id hash, issuing tokens, email verification в лог). `POST /api/v1/auth/login` (проверка email_verified, одинаковое сообщение "invalid email or password" для неверных данных). `POST /api/v1/auth/logout` (чтение refresh-cookie, удаление session). `POST /api/v1/auth/refresh` (ротация: пометка старого refresh rotated=1, выдача нового + new cookie; reuse detection: обнаружение rotated session → удаление всех сессий пользователя). `GET /api/v1/auth/verify-email?token=` (проверка expiry + used, установка email_verified=1). `POST /api/v1/auth/google` + `GET /api/v1/auth/google/callback` (заглушки 501 NOT_IMPLEMENTED).
  - **Email** (`auth/email.go`): интерфейс `EmailSender` с методом `SendVerification(ctx, to, verifyURL)`. Реализация `LogEmailSender` (печатает в log) за фиче-флагом `EMAIL_MODE=log`. `SMTPEmailSender` — заглушка.
  - **OAuth** (`auth/oauth.go`): интерфейс `OAuthProvider` + `StubOAuthProvider` + `GoogleOAuthProvider` (заглушка за `GOOGLE_OAUTH_ENABLED=false`).
  - **Middleware** (`auth/middleware.go`): `RequireAuth(cfg)` — парсинг JWT из `Authorization: Bearer` header → context.Value(userID, role). `RequireRole(roles...)` — проверка роли. `ExtractUserFromRequest()` — единая функция для извлечения user из JWT (access token только через Authorization header или query ?token= для WS).
  - **UserIDExtractor** (`api/hub.go`): `extractUserID()` заменён на `Server.extractUserID()` — парсинг JWT из Authorization header → реальный userId+role. Fallback на guest (IP-based) для неавторизованных. WS-клиенты получают `userRole` при подключении.
  - **SessionManager** (`api/hub.go`): `handleChartSubscribe` — хардкод `"free"` заменён на `c.userRole` из JWT. Реальная роль тарифа используется для лимита графических сессий.
  - **api/server.go**: `Server` получил поле `authCfg` + `mux`, метод `Mux()` для регистрации auth-маршрутов. CORS расширен на `POST, OPTIONS` + `Authorization` + `Access-Control-Allow-Credentials`.
  - **main.go**: Инициализация SQLite через `auth.OpenSQLite()` + `auth.Migrate()`, `auth.LoadAuthConfig()`, `auth.NewHandler()` + `RegisterRoutes()`.
  - **.env.example**: Добавлены JWT_SECRET, ACCESS_TOKEN_TTL=15m, REFRESH_TOKEN_TTL=720h, EMAIL_MODE=log, GOOGLE_OAUTH_ENABLED=false, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, COOKIE_DOMAIN=localhost, COOKIE_SECURE=false.
  - **Vite dev-proxy**: `frontend/vite.config.ts` — `/api` и `/ws` проксируются на localhost:8080 с `changeOrigin: true` для same-origin cookie в dev.
  - **Тесты** (33 теста): password_test (7), jwt_test (5), sqlite_test (6), handlers_test (15) — register/login/refresh-rotation/reuse-detection/logout/verify-email + duplicate/wrong-password/unverified/expired/used/invalid/body-too-large/empty. Все PASS.
- Затронутые файлы/папки (созданы):
  - `backend/internal/auth/` (создан: types.go, config.go, sqlite.go, password.go, jwt.go, handlers.go, email.go, oauth.go, middleware.go)
  - `backend/internal/auth/password_test.go` (создан)
  - `backend/internal/auth/jwt_test.go` (создан)
  - `backend/internal/auth/sqlite_test.go` (создан)
  - `backend/internal/auth/handlers_test.go` (создан)
- Затронутые файлы/папки (изменены):
  - `backend/internal/api/server.go` (+authCfg, +mux, +Mux(), +CORS POST/Authorization/Credentials)
  - `backend/internal/api/hub.go` (+auth import, +userRole в Client, +extractUserID через JWT, +userRole в handleChartSubscribe)
  - `backend/cmd/procluster/main.go` (+SQLite init, +auth wiring)
  - `backend/go.mod` (+golang-jwt/jwt/v5, +golang.org/x/crypto, +modernc.org/sqlite)
  - `.env.example` (+auth vars)
  - `frontend/vite.config.ts` (+changeOrigin)
  - `docs/DECISIONS.md` (+2 ADR: серверные сессии, Vite dev-proxy)
- Ключевые решения:
  - modernc.org/sqlite (pure Go) вместо mattn/go-sqlite3 (CGO) — кросс-платформенная сборка
  - Access JWT в памяти фронта, refresh в httpOnly cookie — максимум безопасности (нет CSRF для access)
  - Soft-delete (rotated=1) вместо hard-delete при ротации refresh — обнаружение reuse + инвалидация всех сессий
  - Правило access-vs-refresh: только access для авторизации, refresh ТОЛЬКО для /auth/refresh
- Тесты/проверки:
  - `go build ./...`: PASS
  - `go vet ./...`: PASS
  - `gofmt -l .`: PASS (0 файлов)
  - `go test ./...`: ALL PASS (33 auth + все существующие)

### [2026-06-14] Фаза 8 — DOMSidebar визуал по дизайн-референсу
- Модель: Sonnet
- Что сделано:
  - **FearGreedPanel.tsx** — полная переработка визуала по дизайн-референсу. SVG-спидометр: градиентная дуга (red→orange→yellow→green), needle-стрелка, плавающий score-bubble. Bitcoin-логотип, sentiment label (Ext. Fear / Fear / Neutral / Greed / Ext. Greed), Score. Footer: `alternative.me` + дата обновления. Данные — реальные из API (`FNGData`). Math.random/walk НЕ перенесён.
  - **OrderBookTable.tsx** — полная переработка. 2 колонки (Size | Price) вместо 3. Asks: `askSize > 0`, sorted high→low сверху. Bids: `bidSize > 0`, sorted high→low снизу. Mid-row: крупная amber-строка `lastPrice` (30px font, glow text-shadow) строго по центру. Depth bar: горизонтальная полоса от левого края, non-linear opacity `0.03 + pow(ratio, 1.3) * 0.72`. Wall detection: `volumeRatio > 0.45` → glow + крупный шрифт. Фильтрация:严格 askSize>0 / bidSize>0, пропуск нулевых уровней. maxVolume единый на весь стакан (asks+bids).
  - **DOMSidebar/index.tsx** — `w-64` → `w-[264px]`, убран лишний `p-2` обёртки FearGreedPanel.
- Не перенесено из референса (подтверждено):
  - ❌ Симулятор торговли (limitOrders, matching engine, balance, position, market buy/sell, log)
  - ❌ Math.random F&G walk — F&G из реального API `/api/v1/fng`
  - ❌ handleRowPriceClick, handleMarketBuy/Sell, cancelLimitOrder
- Затронутые файлы:
  - `frontend/src/components/DOMSidebar/FearGreedPanel.tsx` (полная перезапись)
  - `frontend/src/components/DOMSidebar/OrderBookTable.tsx` (полная перезапись)
  - `frontend/src/components/DOMSidebar/index.tsx` (width, padding)
- Проверки:
  - npx tsc --noEmit: PASS
  - npx vite build: PASS (387ms)
  - Playwright скриншот futures: PASS — F&G SVG gauge, asks/amber mid/bids, depth bars, wall detection
  - Playwright скриншот spot: PASS — тот же визуал, другой lastPrice, spot levels

### [2026-06-14] Фаза 8 — FIX: мультирыночный aggregator + spot ingest + @aggTrade для обоих рынков
- Модель: Sonnet
- Что сделано:
  - **model.Trade**: добавлены поля `Market string` и `Symbol string`. Ingest worker заполняет `trade.Market = string(w.market)` и `trade.Symbol = w.symbol` перед отправкой в tradesCh.
  - **Aggregator мультирыночный**: `Run()` ведёт `map[string]*candleState` по ключу `BookKey(symbol, market)`. Каждый symbol:market имеет свои буферы (currentCandleOpen, live, lastUpdateTime). `processTrade()` берёт symbol/market из `trade.Symbol`/`trade.Market`. `FlushCandle()` вызывается для каждого активного symbol:market по границе минуты. Live-данные futures → clusters_futures, spot → clusters_spot (через `tableForMarket(market)`).
  - **Ingest URL**: оба рынка используют `@aggTrade`. Futures: `wss://fstream.binance.com/ws/btcusdt@aggTrade`. Spot: `wss://stream.binance.com:9443/ws/btcusdt@aggTrade`. Парсер: `tradeID = msg.AggregateTradeID` для обоих рынков.
  - **Spot ingest worker**: добавлен в main.go рядом с futures, тот же `tradesCh`. Спот-трейды идут в aggregator → `ob.SetLastPrice(trade.Price)` для spot OrderBook → LiveDOMBroadcaster/snapshotter不再跳过 BTCUSDT:spot.
  - **Тесты**: TestParseSpotTrade обновлён — event `"aggTrade"` с полем `"a"` вместо `"trade"` с `"t"`.
- Затронутые файлы:
  - `backend/internal/model/model.go` (+Market, +Symbol в Trade)
  - `backend/internal/ingest/ingest.go` (+trade.Market/Symbol, spot URL @aggTrade)
  - `backend/internal/ingest/parser.go` (tradeID = AggregateTradeID для обоих)
  - `backend/internal/ingest/ingest_test.go` (TestParseSpotTrade: aggTrade event)
  - `backend/internal/aggregator/aggregator.go` (полная перезапись Run/processTrade: multi-market states map)
  - `backend/cmd/procluster/main.go` (+spotWorker)
- Ключевые решения:
  - model.Trade несёт Market/Symbol — aggregator резолвит OrderBook и конфиг без хардкода
  - candleState per symbol:market — изоляция буферов, spot/futures не путаются
  - @aggTrade для spot: единый формат сообщения, парсер не нуждается в различии
- Тесты: go build/vet/gofmt PASS, go test ./... ALL PASS.

### [2026-06-14] Фаза 8 — FIX: lastPrice в OrderBook питается из aggregator trade-потока
- Модель: Sonnet
- Что сделано:
  - **Корень бага**: `OrderBook.lastPrice` был всегда `0` — `SetLastPrice()` вызывался только в тестах. `LiveDOMBroadcaster.broadcastAll()` пропускал все тики из-за `centerPrice <= 0`. Depth-события Binance `@depth` не содержат цену трейда (только лимитные ордера).
  - **Фикс**: добавлен интерфейс `LastPriceSetter` в aggregator + поле `orderBooks map[string]LastPriceSetter`. Метод `SetOrderBooks()` передаёт общий `map[string]*depth.OrderBook` из main.go. В `processTrade()`, при каждом трейде, вызывается `ob.SetLastPrice(trade.Price)` для соответствующего OrderBook. Ключ `BookKey(symbol, market)` унифицирован (`"BTCUSDT:futures"`).
  - **Wiring**: в main.go создаётся `aggOrderBooks` (копия указателей из `orderBooks`) и передаётся через `agg.SetOrderBooks(aggOrderBooks)`. Тот же инстанс `*depth.OrderBook`, что используется в depth-sync, snapshotter, livedom.
  - **Диагностические логи** `[livedom-debug]` удалены.
- Затронутые файлы:
  - `backend/internal/aggregator/aggregator.go` (+LastPriceSetter interface, +orderBooks field, +SetOrderBooks, +BookKey, +SetLastPrice call в processTrade)
  - `backend/cmd/procluster/main.go` (+aggOrderBooks wiring)
  - `backend/internal/depth/livedom.go` (-debug logs, -tickCnt)
- Тесты: go build/vet/gofmt PASS, go test ./... ALL PASS.
- Ключевое решение: depth @depth stream НЕ содержит цену трейда (только лимитные ордера). lastPrice питается из aggregator trade-потока (aggTrade/@trade).

### [2026-06-14] Фаза 8 — Стакан DOM + Fear&Greed + Снапшоты
- Модель: Opus (depth-sync + snapshotter), Sonnet (UI стакана)
- Что сделано:
  - **Depth-sync (backend)**: `depth/orderbook.go` — OrderBook в памяти с `sync.RWMutex`. Depth-горутина пишет, snapshotter/liveDOM читают. Методы: `SnapshotFromREST`, `ApplyFuturesUpdate` (pu-цепочка), `ApplySpotUpdate` (U==prev_u+1), `GetAggregatedLevels` (±5% от цены, base-сжатие, TRUNCATE). `depth/sync.go` — DepthSync: REST snapshot `limit=1000`, WS `@depth` stream, автоматический reconnect с exponential backoff (1s→30s). Futures: `U<=lastUpdateId && u>=lastUpdateId`, далее `pu==prev_u`. Spot: `U<=lastUpdateId+1 && u>=lastUpdateId+1`, далее `U==prev_u+1`.
  - **DOM-снапшоты (backend)**: `depth/snapshotter.go` — слушает `CandleCloseCh` от aggregator для futures (каждую минуту). Spot: таймер `minute%15==0 && second==0` (нет live 15m candle close). Агрегация ±5% от `lastPrice` по `baseStep` (BTC futures 2.5$, spot 5$). TRUNCATE до 1 знака. Запись в `clusters_futures_dom`/`clusters_spot_dom`.
  - **Live DOM (backend)**: `depth/livedom.go` — WS push `dom_update` раз в секунду. Фильтрация ±5% ПЕРЕД отправкой (не 1000 уровней). Channel key `dom:{symbol}:{market}`. REST `/api/v1/fng` из Redis кэша.
  - **Fear & Greed (backend)**: `fng/fetcher.go` — `alternative.me/api/fng/?limit=1`. Кэш в Redis hash `fng:current` с TTL 24h. Фетч каждые 60 минут. Graceful fallback на кэш при недоступности источника.
  - **Aggregator changes**: `CandleCloseCh` канал + `SetCandleCloseCh()`. Сигнал `CandleCloseSignal` отправляется после `FlushCandle` (non-blocking select).
  - **Repository**: `InsertDOMSnapshotBatch` параметризован по `table` (был хардкод `clusters_futures_dom`).
  - **Symbol config**: `config/symbols.go` — единый конфиг символов (PriceTick, BaseLevel, SnapInterval, DOMTable). Убран хардкод в aggregator.
  - **API**: `api/dom.go` — REST `GET /api/v1/fng` + WS `dom_subscribe`/`dom_unsubscribe`. Client получил поле `domSubscribed`.
  - **Frontend**: `DOMSidebar` — панель справа от графика. FearGreedPanel (индекс 0-100, цветовая полоса), OrderBookTable (bid/ask строки ±5%, горизонтальные бары объёмов, авто-центрирование через 1с). Сворачивание в край (кнопка «/»), при сворачивании график растягивается. Привязка к `activeSlot` (symbol/market).
  - **i18n**: ключи `fng.*`, `dom.*` добавлены в en/ru/kz словари.
  - **Unit-тесты**: 12 тестов — SnapshotFromREST, ApplyFuturesUpdate, FuturesPUMismatch, FuturesDeleteLevel, ApplySpotUpdate, SpotUSequenceMismatch, GetAggregatedLevelsPercentRange, GetAggregatedLevelsTruncation, GetAggregatedLevelsAggregation, Clear, SetGetLastPrice, InvalidPriceIgnored. Все PASS.
- Затронутые файлы/папки:
  - `backend/internal/depth/` (создан: orderbook.go, sync.go, snapshotter.go, livedom.go, orderbook_test.go)
  - `backend/internal/fng/` (создан: fetcher.go)
  - `backend/internal/config/` (создан: symbols.go)
  - `backend/internal/api/` (создан: dom.go; изменён: server.go, hub.go)
  - `backend/internal/aggregator/aggregator.go` (+CandleCloseCh, +CandleCloseSignal, +SetCandleCloseCh)
  - `backend/internal/repository/repository.go` (InsertDOMSnapshotBatch +table)
  - `backend/internal/repository/clickhouse/clickhouse.go` (+table param)
  - `backend/internal/repository/clickhouse/clickhouse_test.go` (обновлён вызов)
  - `backend/cmd/procluster/main.go` (подключены depth-sync, snapshotter, livedom, fng)
  - `frontend/src/types/dom.ts` (создан)
  - `frontend/src/hooks/useDOM.ts` (создан)
  - `frontend/src/components/DOMSidebar/` (создан: index.tsx, FearGreedPanel.tsx, OrderBookTable.tsx)
  - `frontend/src/App.tsx` (+DOMSidebar в terminal view)
  - `frontend/src/i18n/dictionaries/{en,ru,kz}.ts` (+fng.*, dom.*)
- Ключевые решения:
  - sync.RWMutex для OrderBook — depth пишет, snapshotter/liveDOM читают, contention минимальный (2 reads/сек)
  - Snapshot timing: futures по CandleCloseCh от aggregator, spot по таймеру (minute%15==0)
  - Live DOM: WS push 1/сек, не REST polling — экономия трафика, ±5% фильтрация перед отправкой
  - F&G: fetch каждые 60 мин, cache TTL 24h, fallback на кэш
  - Symbol config: единый `config/symbols.go` вместо хардкода в нескольких местах
- Тесты/проверки:
  - go build ./...: PASS
  - go vet ./...: PASS
  - gofmt -l .: PASS (0 файлов)
  - go test ./internal/depth/: PASS (12 тестов)
  - go test ./internal/aggregation/: PASS (14 тестов)
  - go test ./internal/history/: PASS
  - go test ./internal/api/: PASS
  - TypeScript compilation: PASS (npx tsc --noEmit)
  - Vite build: PASS (454ms)

### [2026-06-13] Фаза 7 — Layouts: фикс 3 багов dual-mode
- Модель: Sonnet (mimo-auto)
- Что сделано:
  - **Bug #1 (Независимость графиков)**: `ChartControlsContext` переписан на slots-архитектуру. Новый интерфейс: `slots: [ChartSlot, ChartSlot]` — каждый slot хранит свои symbol/market/timeframe/candleMode/palette/volumeMode/compression. `activeSlot: 0|1` — какой график управляет шапка. Сеттеры (`setSymbol`, `setMarket` и т.д.) работают с `slots[activeSlot]`. `getSlot(i)` — чтение конкретного слота. Миграция legacy localStorage: если в `procluster_chart_controls` старый формат (один slot), мигрирует в `slots: [legacy, default]`.
  - **Bug #1 (Шапка)**: `ChartHeader` читает `getSlot(activeSlot)` вместо прямых `symbol/market/...`. Palette change передаёт `activeSlot` в `CandlePaletteContext.setActivePalette()`. Добавлен slot selector (кнопки "1"/"2") — visible в dual-mode, переключает `activeSlot`.
  - **Bug #1 (App.tsx)**: `getSlot(0)` → ChartPanel[0], `getSlot(1)` → ChartPanel[1]. Контейнер панели: `onClick={() => setActiveSlot(i)}` + amber ring highlight (`ring-1 ring-amber-500/40`) для активного графика.
  - **Bug #2+3 (Canvas containment)**: `ChartPanel.tsx` — добавлен `position: relative` на containerRef div (`className="relative w-full h-full"`). Без `position: relative` axis canvas и cluster text overlay (оба `position: absolute`) "убегали" к ближайшему positioned-предку (`absolute inset-0 flex` в App.tsx), и оба графика рисовали оси в одном контейнере (0,0 общего предка). Теперь каждый axis/text canvas строго внутри своей панели.
  - **Bug #2 (Размеры осей)**: ResizeObserver в ChartPanel корректно передаёт `width/height`自己的 контейнера в `engine.resize()` → `renderer.resize()` → `axisRenderer.resize()` + `scales.updateSize()`. Каждый Engine получает размеры своей панели, не первого/общего.
  - **Playwright**: 9/9 PASS. Новые тесты: slot selector switching, independent charts (different TF), axes containment (panels don't overlap).
- Затронутые файлы/папки:
  - frontend/src/contexts/ChartControlsContext.tsx (переписан: slots + activeSlot + getSlot + legacy migration)
  - frontend/src/App.tsx (getSlot(0)/getSlot(1), onClick→setActiveSlot, amber ring highlight)
  - frontend/src/components/ChartHeader.tsx (read from getSlot(activeSlot), palette sync with activeSlot, slot selector "1"/"2")
  - frontend/src/components/ChartPanel.tsx (+position: relative на containerRef)
  - frontend/e2e/layout.spec.ts (9 тестов, +3 новые)
- Ключевые решения:
  - Slots-архитектура вместо отдельного контекста на каждую панель — меньше providers, единая точка управления
  - Legacy migration в loadSaved() — обратная совместимость со старым localStorage
  - `position: relative` на containerRef — minimal fix, корневая причина bugs #2+#3
  - `getSlot(i)` API — чистое разделение: шапка читает activeSlot, App.tsx читает конкретный slot
- Тесты/проверки:
  - TypeScript compilation: PASS
  - Vite build: PASS (606ms)
  - Playwright e2e: 9/9 PASS (36.2s)
  - Independent charts: 1m vs 4h показывают разные данные ✓
  - Axes contained: каждый panel有自己的 price axis, time axis не налезает ✓
  - Slot selector: переключает activeSlot, шапка применяет к нужному графику ✓
  - Legacy localStorage: миграция из старого формата ✓

### [2026-06-13] Фаза 7 — Рабочие пространства / Layouts
- Модель: Sonnet (mimo-auto)
- Что сделано:
  - **LayoutContext**: `LayoutProvider` + `useLayout()` хук. State: `layoutMode` (single/horizontal/vertical), `splitRatio` (0.1–0.9, default 0.5). Сохранение в localStorage. Хук `onCrosshairMove` (empty callback) + `setCrosshairCallback` для будущей синхронизации курсора между графиками.
  - **Splitter**: компонент с drag-обработкой (mousedown → mousemove → mouseup). Визуал: 5px линия с подсветкой при hover (amber-500/30). cursor-col-resize для горизонтального layout, cursor-row-resize для вертикального. Глобальные стили cursor/userSelect на body при drag.
  - **ChartPanel**: новый компонент-обёртка для отдельного экземпляра Engine. Идентичен ChartContainer, но использует `ResizeObserver` вместо `window resize` — корректный resize при изменении размера панели. Cleanup: engine.destroy() при unmount, observer.disconnect().
  - **App.tsx**: рефакторинг — `LayoutProvider` оборачивает `AppShell`. Три режима: single (один ChartContainer на всю область), horizontal (два ChartPanel + vertical Splitter, flex row), vertical (два ChartPanel + horizontal Splitter, flex col). Splitter drag обновляет splitRatio через LayoutContext. resize engine через ResizeObserver в ChartPanel.
  - **ChartHeader**: добавлен layout switcher (9-й элемент) — 3 кнопки с SVG-иконками (SingleChartIcon, HorizontalSplitIcon, VerticalSplitIcon). Подсветка активного режима amber. data-testid для e2e тестов.
  - **LayoutIcons.tsx**: Simple SVG иконки для 3 режимов layout (1 chart, 2 horizontal, 2 vertical).
  - **i18n**: добавлены ключи `chart.layout`, `chart.layoutSingle`, `chart.layoutHorizontal`, `chart.layoutVertical` в en/ru/kz словари.
  - **Playwright e2e**: 6 тестов — single chart fills area, horizontal split + splitter visible, vertical split + splitter visible, drag splitter changes proportions, switch back to single removes splitter, layout persists in localStorage. Все PASS.
- Затронутые файлы/папки:
  - frontend/src/contexts/LayoutContext.tsx (создан)
  - frontend/src/components/Splitter.tsx (создан)
  - frontend/src/components/ChartPanel.tsx (создан)
  - frontend/src/components/icons/LayoutIcons.tsx (создан)
  - frontend/src/components/ChartHeader.tsx (+layout switcher, +data-testid)
  - frontend/src/App.tsx (рефакторинг: LayoutProvider, 3 режима layout)
  - frontend/src/i18n/dictionaries/en.ts (+layout ключи)
  - frontend/src/i18n/dictionaries/ru.ts (+layout ключи)
  - frontend/src/i18n/dictionaries/kz.ts (+layout ключи)
  - frontend/e2e/layout.spec.ts (создан — 6 тестов)
  - frontend/playwright.config.ts (создан)
- Ключевые решения:
  - Layout на уровне React-компонентов, не внутри chart-engine (правило из CHART_ENGINE.md)
  - ResizeObserver вместо window resize — корректный resize при splitter drag
  - ChartPanel как отдельный компонент (не дублировать ChartContainer) — чище для dual mode
  - splitRatio в localStorage — persistent между сессиями
  - onCrosshairMove хук заложен, но НЕ реализован (по спеке — позже)
  - StrictMode отключён (из фазы 6b) — ручной cleanup engine.destroy() + observer.disconnect()
- Открытые TODO для следующих фаз:
  - **Синхронизация курсора** между графиками (onCrosshairMove) — отдельная задача
  - **Независимые controls** для второго графика (symbol/tf/mode per chart) — нужен per-slot ChartControls
  - **DOM sidebar** — стакан свёрнут → график растягивается (ResizeObserver уже готов)
- Тесты/проверки:
  - TypeScript compilation: PASS
  - Vite build: PASS (357ms)
  - Playwright e2e: 6/6 PASS (20.2s)
  - Single chart: fills full area ✓
  - Horizontal split: two charts + vertical splitter ✓
  - Vertical split: two charts + horizontal splitter ✓
  - Drag splitter: proportions change ✓
  - Layout persistence: survives reload ✓
  - Engine cleanup: destroy() on unmount, no leaks ✓

### [2026-06-13] Фаза 6c — Роллап 15m/30m + исправления API + загрузка спот данных
- Модель: MiMo (mimo-free)
- Что сделано:
  - **Rollup добавлен 15m/30m**: `AlignToTimeframe` добавлены case `"15m"` и `"30m"` (truncate minute до 15/30 границы). `Rollup()` теперь генерирует `["15m", "30m", "1h", "4h", "1d"]` вместо `["1h", "4h", "1d"]`.
  - **API validTimeframes**: добавлен `"30m": true` (был пропущен).
  - **GetLatestCandles bug**: хардкодил `clusters_futures` — spot данные были невидимы. **Фикс**: добавлен параметр `market string` → `tableForMarket(market)`. Добавлен `before *int64` → серверная фильтрация `WHERE candle_open < toDateTime64(?, 3)` вместо client-side.
  - **Interface changed**: `GetLatestCandles(ctx, symbol, timeframe, market, limit, before)` — обновлены все callers (repository, api, test, e2etest).
  - **Loader Stats**: добавлены `Candles15m`, `Candles30m` в Stats struct + summary output.
  - **Загружены данные**: BTCUSDT spot Jun 1-12 — 18,656,142 trades, 409,641 rows (15m: 67926, 30m: 48482, 1h: 34755, 4h: 18662, 1d: 10725).
  - **Frontend**: spot timeframes `['15m', '30m', '1h', '4h']` — уже настроены корректно (нет 1m/1d для спота).
- Затронутые файлы/папки:
  - backend/internal/aggregation/rollup.go (+15m/+30m AlignToTimeframe, Rollup)
  - backend/internal/api/candles.go (+30m validTimeframes, market+before в GetLatestCandles)
  - backend/internal/repository/repository.go (interface GetLatestCandles +market, +before)
  - backend/internal/repository/clickhouse/clickhouse.go (table by market, before filter)
  - backend/internal/repository/clickhouse/clickhouse_test.go (обновлён вызов)
  - backend/internal/history/loader.go (+Candles15m, +Candles30m, switch)
  - backend/cmd/loader/main.go (summary 15m/30m)
  - backend/cmd/e2etest/main.go (обновлён вызов)
- Ключевые решения:
  - 15m/30m rollup из 1m данных — единый путь для live и history
  - GetLatestCandles с market параметром — проще, чем два метода
  - Server-side before фильтр — корректная пагинация через ClickHouse
- Тесты/проверки:
  - go build/vet/test: ALL PASS
  - API: 15m/30m spot candles доступны через before параметр ✅
  - ClickHouse: 6 timeframes (15m, 30m, 1h, 4h, 1d, 1m) ✅

### [2026-06-13] Фаза 6c — Фикс: Canvas lifecycle при смене ТФ (chart freeze)
- Модель: MiMo (mimo-free)
- Что сделано:
  - **Корень бага**: при смене timeframe useEffect cleanup вызывал `engine.destroy()`, но `AxisRenderer.destroy()` и `ClusterTextOverlay` не удаляли свои canvas из DOM. `app.destroy(true)` в PixiJS v8 ломается (v7 API) → обёрнуто в try-catch → canvas тоже не удалялся. При `new Engine().init()` добавлялись новые 3 canvas, но `container.querySelector('canvas')!` находил **старый** мёртвый canvas (axis/cluster overlay с `pointer-events: none`) → InteractionManager вешал обработчики на него → drag/zoom не работали → chart frozen. После F5 контейнер чистый → работает.
  - **Renderer.ts**: добавлено `pixiCanvas` поле + `getPixiCanvas()` метод. `init()` сохраняет ссылку на `this.app.canvas`. `destroy()` удаляет все canvas из DOM (`pixiCanvas.remove()`, вызов `clusterTextOverlay.destroy()`). `app.destroy()` вызывается без аргумента (v8-совместимо).
  - **Engine.ts**: `init()` использует `this.renderer.getPixiCanvas()!` вместо `container.querySelector('canvas')!` — гарантированно привязывает InteractionManager к актуальному canvas.
  - **AxisRenderer.ts**: `destroy()` теперь вызывает `this.canvas.remove()` (вместо комментария `// Canvas is garbage collected`).
  - **ClusterTextOverlay.ts**: добавлен `destroy()` метод с `this.canvas.remove()`.
  - **ChartContainer.tsx**: `fetchClustersBatch` убран из deps useEffect (через `fetchClustersRef`) — предотвращает двойной destroy+init при смене ТФ (useCallback deps `[symbol, timeframe]` менялись вместе с timeframe).
- Затронутые файлы/папки:
  - frontend/src/chart-engine/Renderer.ts (+pixiCanvas, +getPixiCanvas, fix init/destroy, v8 app.destroy)
  - frontend/src/chart-engine/Engine.ts (renderer.getPixiCanvas() вместо querySelector)
  - frontend/src/chart-engine/renderers/AxisRenderer.ts (destroy: canvas.remove())
  - frontend/src/chart-engine/renderers/ClusterTextOverlay.ts (+destroy: canvas.remove())
  - frontend/src/components/ChartContainer.tsx (fetchClustersRef, deps без fetchClustersBatch)
- Ключевые решения:
  - Хранить ссылку на PixiJS canvas в Renderer, не искать через querySelector — гарантированно правильный canvas
  - Все canvas удаляются вручную через .remove() при destroy — нет мёртвых canvas в DOM
  - app.destroy() без аргументов (v8 API) — removeView не нужен, canvas удаляем сами
  - fetchClustersBatch через ref — не триггерит двойной init при смене ТФ
- Тесты/проверки:
  - TypeScript compilation: PASS (npx tsc --noEmit)
  - Vite build: PASS (423ms)
  - After TF switch: ровно 3 canvas в container (pixi + clusterText + axis), не больше
  - Drag/zoom работают сразу после смены ТФ без F5

### [2026-06-13] Фаза 6c — Фикс: candleIntervalMs вместо хардкода 60000 (ВСЕ ТФ)
- Модель: MiMo (mimo-free)
- Что сделано:
  - **Корень бага**: `Scales.timeToScreen()` делил `(timestamp - firstTimestamp) / 60000` — хардкод 1 минуты. Для 1h свечей dataIndex = 60× реального → все свечи рендерятся far right (x=55200 на 1000px chart), viewport недостижим. Живые 1m работали только потому, что 60000 совпадало с реальным интервалом.
  - **Scales.ts**: добавлено поле `candleIntervalMs` (default 60000) + `setCandleInterval(ms)` + `getCandleInterval()`. `timeToScreen()` теперь делит на `this.candleIntervalMs` вместо хардкода.
  - **Engine.ts**: добавлен `TIMEFRAME_INTERVALS` маппинг (1m→60000, 5m→300000, 15m→900000, 30m→1800000, 1h→3600000, 4h→14400000, 1d→86400000 и др.). Метод `setTimeframe(tf)` устанавливает интервал из маппинга. `setData()` вычисляет интервал из первых двух свечей ТОЛЬКО как fallback (если timeframe не был задан через setTimeframe).
  - **ChartContainer.tsx**: вызов `engine.setTimeframe(timeframe)` перед `engine.setData(candles)` — интервал берётся из выбранного ТФ.
  - **AxisRenderer.ts**: `drawTimeAxis()` больше не генерирует фейковые таймстемпы `Date.now() - (1000-i)*60000`. Теперь рисует реальные timestamps из candle data, используя `scales.timeToScreen()` с правильным интервалом.
  - **Renderer.ts**: `renderAxis()` принимает опциональный `candles` параметр, передаёт в AxisRenderer.
  - **prependData viewport fix**: `prependData()` компенсирует сдвиг offsetX — после добавления свечей слева existing candles остаются на месте (shiftPixels = (prevFirstTs - newFirstTs) / candleIntervalMs * spacing).
- Затронутые файлы/папки:
  - frontend/src/chart-engine/Scales.ts (+candleIntervalMs, +setCandleInterval, fix timeToScreen)
  - frontend/src/chart-engine/Engine.ts (+TIMEFRAME_INTERVALS, +setTimeframe, +candleIntervalMs, +timeframeSet, fix setData, fix prependData)
  - frontend/src/chart-engine/Renderer.ts (+candles param in renderAxis)
  - frontend/src/chart-engine/renderers/AxisRenderer.ts (+Candle import, fix drawTimeAxis with real timestamps)
  - frontend/src/components/ChartContainer.tsx (+setTimeframe call)
- Ключевые решения:
  - Интервал свечи берётся из timeframe маппинга (PRIMARY), вычисление из данных — fallback
  - prependData компенсирует offsetX чтобы viewport не прыгал при догрузке истории
  - AxisRenderer рисует time labels из реальных candle timestamps, не фейковых Date.now()
- Тесты/проверки:
  - TypeScript compilation: PASS (npx tsc --noEmit)
  - Vite build: PASS (405ms)
  - Живой WS updateLast: не затронут (не меняет interval)
  - needHistory/prependData: компенсация offsetX предотвращает рывок viewport

### [2026-06-13] Фаза 7 — Downloader: retry, temp file, 404 handling
- Модель: Sonnet (mimo-auto)
- Что сделано:
  - **downloader.go**: полная перезапись. `DownloadToFile(ctx, url, destPath)` — скачивает в temp-файл (а не стримит в zip-reader). Кастомный `http.Client` с `Transport` (DialContext 15s, TLSHandshake 15s, ResponseHeader 30s) без глобального Timeout (убивает долгие загрузки). **Retry**: до 5 попыток с экспоненциальным backoff (1s, 2s, 4s, 8s, 16s) только на сетевые ошибки (connection refused/reset/EOF/wsarecv/i/o timeout). **404**: возвращает `ErrNotFound` — не ретраится, пропускает день. `UnzipFile(zipPath)` — распаковка с диска (не из сети). `TempDir()` — создание tmp-директории с cleanup. `isRetryable(err)` — проверка типа ошибки (net.Error, DNSError, OpError, строки).
  - **loader.go**: `processDay` использует `DownloadToFile` → `UnzipFile` → `ParseCSV`. Temp-файл удаляется после распаковки. `Stats.Skipped` — дни с 404. `Run` обрабатывает `ErrNotFound` → skip + log, продолжает. SUMMARY показывает OK/Skipped/Errors.
  - **cmd/loader/main.go**: обновлён вывод SUMMARY — OK/Skipped/Errors.
- Затронутые файлы/папки:
  - backend/internal/history/downloader.go (полная перезапись)
  - backend/internal/history/loader.go (DownloadToFile + ErrNotFound + Stats.Skipped)
  - backend/cmd/loader/main.go (SUMMARY)
- Ключевые решения:
  - Temp-файл вместо стриминга — обрыв сети не ломает распаковку
  - Retry 5 раз с backoff — для больших zip (>100MB) со unstable connection
  - 404 ≠ ошибка — свежая дата может быть не выложена, пропускаем
  - isRetryable: только сетевые ошибки, НЕ context cancellation/deadline
- Тесты/проверки:
  - go build ./...: PASS
  - go vet ./...: PASS
  - gofmt -l .: PASS
  - go test ./...: ALL PASS

### [2026-06-13] Фаза 7 — Фиксы: clickhouse DB + rollup grouping (БАГИ)
- Модель: MiMo (mimo-auto)
- Что сделано:
  - **Bug 1 (ClickHouse DB)**: `clickhouse.New(ctx, dsn, user, password)` не принимал database → всегда писал в `default`, хотя `.env` содержит `CLICKHOUSE_DB=procluster`. **Фикс**: добавлен параметр `database string` в `clickhouse.New()`, `clickhouse.Options.Auth.Database: database`. Обновлены `cmd/procluster/main.go` (читает `CLICKHOUSE_DB`), `cmd/loader/main.go` (читает `CLICKHOUSE_DB`), `cmd/e2etest/main.go`, `clickhouse_test.go`.
  - **Bug 2 (Rollup grouping)**: `AggregateForTimeframe` группировал только по `PriceLevel` без привязки к границе ТФ. Bucket key = PriceLevel → все 1m свечи одного priceLevel за весь день мёрджились в одну строку. **Фикс**: bucket key = `(AlignToTimeframe(candleOpen, tf), PriceLevel)`. Новая функция `AlignToTimeframe(t, tf)` — 1h: `t.Truncate(time.Hour)`, 4h: `hour/4*4`, 1d: midnight. OHLC: open от earliest 1m, close от latest 1m. Результат сортируется по (CandleOpen, PriceLevel). Исправлен double-counting при создании нового bucket ( volumes обнуляются при создании).
  - **aggregation/rollup_test.go**: 8 тестов — AlignToTimeframe (6 cases), 1m→1h (1 и 2 intervals), 1m→4h (1 block, 6 blocks), 1m→1d, multiple price levels, full Rollup. Все PASS.
  - **csvparser.go**: добавлен `log.Printf("[csv] line 1: header detected, skipping")` при пропуске строки-заголовка.
- Затронутые файлы/папки:
  - backend/internal/repository/clickhouse/clickhouse.go (+database parameter)
  - backend/internal/repository/clickhouse/clickhouse_test.go (+database)
  - backend/internal/aggregation/rollup.go (полная перезапись: AlignToTimeframe, intervalKey, intervalTracker, sort)
  - backend/internal/aggregation/rollup_test.go (создан)
  - backend/cmd/procluster/main.go (+chDB)
  - backend/cmd/loader/main.go (+chDB)
  - backend/cmd/e2etest/main.go (+chDB)
  - backend/internal/history/csvparser.go (header log)
- Ключевые решения:
  - Bucket key = (aligned time, price level) — единственно верный способ группировки rollup
  - Результат AggregateForTimeframe сортируется по (CandleOpen, PriceLevel) — предсказуемый порядок
  - При создании bucket volumes обнуляются, accumulate через += — исключает double-counting
  - aggregator.go:302 вызывает `aggregation.Rollup(rows)` — единый путь для live и history
- Тесты/проверки:
  - go build ./...: PASS
  - go vet ./...: PASS
  - gofmt -l .: PASS
  - go test ./...: ALL PASS (14 aggregation + 8 history + 5 api + clickhouse)

### [2026-06-13] Фаза 7 — CLI-загрузчик исторических тиков (history-loader)
- Модель: MiMo (mimo-auto)
- Что сделано:
  - **aggregation/rollup.go**: извлечены `AggregateForTimeframe()` и `Rollup()` из aggregator.go — единый модуль для live и history. Aggregator и loader вызывают одну функцию.
  - **repository/repository.go + clickhouse.go**: `InsertClusterBatch` теперь принимает `table string` (`clusters_futures`/`clusters_spot`). Добавлен `DeleteClustersByRange(ctx, table, symbol, timeframe, from, to)` — очистка диапазона перед вставкой для идемпотентности.
  - **history/csvparser.go**: парсинг CSV для futures (7 колонок, timestamp мс) и spot (8 колонок, timestamp мкс/1000). `isBuyerMaker` регистронезависимо. Пропуск битых строк с логом, пропуск заголовка.
  - **history/downloader.go**: `Download(ctx, url)` + `StreamUnzip(reader)` — стриминг распаковки через `bytes.NewReader` + `archive/zip`. `BuildURL(market, symbol, date)` — генерация URL для data.binance.vision.
  - **history/loader.go**: пайплайн `Run(ctx, cfg, repo)` — цикл по дням: download → parse → aggregate 1m (CompressTrades) → DELETE диапазона → INSERT батчами по 10000 → rollup 1h/4h/1d → прогресс в stderr. OHLC: open=первый трейд минуты, close=последний.
  - **cmd/loader/main.go**: CLI — флаги `-symbol`, `-market`, `-from`, `-to`. Подключение к ClickHouse из .env, auto-migrations, вывод сводки + SQL-запросы для проверки размера таблиц.
  - **Юнит-тесты**: 8 тестов на парсинг CSV (futures/spot, microseconds, case-insensitive isBuyerMaker, bad lines, header skip, URL generation).
  - **aggregator.go**: обновлён — использует `aggregation.Rollup()` + `tableForMarket()`, удалён дублирующий `aggregateForTimeframe`.
- Затронутые файлы/папки:
  - backend/internal/aggregation/rollup.go (создан)
  - backend/internal/aggregation/aggregation.go (без изменений)
  - backend/internal/history/ (csvparser.go, downloader.go, loader.go, csvparser_test.go — созданы)
  - backend/cmd/loader/main.go (создан)
  - backend/internal/repository/repository.go (InsertClusterBatch + DeleteClustersByRange)
  - backend/internal/repository/clickhouse/clickhouse.go (реализация + удаление ranges)
  - backend/internal/repository/clickhouse/clickhouse_test.go (обновлён вызов)
  - backend/internal/aggregator/aggregator.go (aggregation.Rollup + tableForMarket)
- Ключевые решения:
  - Rollup извлечён в aggregation/rollup.go — единый модуль для live и history (MEMORY.md правило: единый источник правды)
  - Идемпотентность через DELETE перед INSERT (проще ReplacingMergeTree, нет миграции ENGINE)
  - Spot timestamp: microsecond/1000 для мс (data.binance.vision с 2025-01-01 отдаёт мкс)
  - Батчи по 10000 rows для вставки (не построчно)
- Тесты/проверки:
  - go build ./...: PASS
  - gofmt -l .: PASS (0 файлов)
  - go vet ./...: PASS
  - go test ./internal/history/ — PASS (8 тестов)
  - go test ./internal/aggregation/ — PASS (6 тестов)
  - ClickHouse docker запущен: procluster-clickhouse

### [2026-06-13] Фаза 6c — Верхняя панель графика (Header Controls) — ФИКСЫ
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - **Bug 1 (Z-index)**: дропдауны «Тикер» и «Сжатие» открывались ПОД canvas графика (PixiJS canvas создаёт stacking context). **Решение**: React Portal (`Portal.tsx`) через `createPortal` в `document.body` + `position: fixed` по координатам кнопки (`getBoundingClientRect()`). Z-index dropdown = 99999. Dropdowns теперь всегда поверх графика.
  - **Bug 2 (Палитра не работала)**: `ChartHeader.setPalette()` обновлял только `ChartControlsContext`, но `ChartContainer` читал палитру из `CandlePaletteContext` — контексты были разъединены, engine.setPalette() никогда не вызывался при переключении. **Решение**: (1) ChartHeader импортирует `useCandlePalette` и вызывает `setActivePalette(0, p)` при смене палитры; (2) добавлен проп `palette` в ChartContainer; (3) `useEffect(() => engine.setPalette(palette), [palette])` дёргает движок при каждом изменении. Палитра применяется к Japanese и Bars (cluster/footprint используют bid/ask текстовые цвета — отдельная задача).
  - **Portal.tsx**: новый утилитарный компонент, рендерит children через `createPortal` в `document.body`.
- Затронутые файлы/папки:
  - frontend/src/components/Portal.tsx (создан)
  - frontend/src/components/ChartHeader.tsx (порталы для dropdowns, palette sync с CandlePaletteContext)
  - frontend/src/components/ChartContainer.tsx (добавлен проп `palette`, useEffect для engine.setPalette)
  - frontend/src/App.tsx (передаёт `palette` в ChartContainer)
- Ключевые решения:
  - Portal в document.body — единственный надёжный способ обойти stacking context от PixiJS canvas
  - Двойной вызов setPalette (ChartControlsContext + CandlePaletteContext) для синхронизации UI и engine
- Тесты/проверки:
  - TypeScript compilation: PASS
  - Vite build: PASS (365ms)
  - Дропдауны тикера и сжатия: portal в body, z-index 99999 — ПОВЕРХ canvas: ✓
  - IndicatorsModal: уже в body через AnimatePresence — ПОВЕРХ canvas: ✓
  - Палитра Classic/Alternative: setPalette → engine → CandleRenderer/BarRenderer перерисовка: ✓

### [2026-06-13] Фаза 6c — Верхняя панель графика (Header Controls)
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - **ChartControlsContext** (React Context + localStorage): state 8 контролов (symbol, market, timeframe, candleMode, palette, volumeMode, compression, showIndicatorsModal) + синхронизация с движком через engine.* API. Сохранение/восстановление настроек при перезагрузке.
  - **ChartHeader.tsx**: 8 控件 в liquid-glass стиле из design-src: (1) Ticker dropdown, (2) Market SPOT/FUTURES segment, (3) Timeframes (зависят от рынка: futures=1m..4h, spot=15m..4h), (4) Candle type Auto/Japanese/Bars/Footprint/Clusters с иконками, (5) Palette Classic/Alternative с цветовыми индикаторами, (6) Volume mode Bid×Ask/Volume/Delta (скрыт для Japanese/Bars), (7) Compression dropdown (base×k, k=1..10), (8) Indicators button → модалка-заглушка. i18n RU/EN/KZ.
  - **ChartContainer.tsx**: рефакторинг — принимает props (mode, volumeMode, compression) из контекста, инлайн-контролы удалены, engine.* API дёргается через useEffect при изменении пропсов.
  - **App.tsx**: интеграция ChartControlsProvider + ChartHeader над графиком, IndicatorsModal заглушка с motion-анимацией.
  - **i18n**: расширены словари en/ru/kz ключами chart.* (19 ключей: ticker, market, spot, futures, interval, candleType, auto, japanese, bars, footprint, clusters, palette, classic, alternative, volumeData, bidAsk, volume, delta, compression, indicators, upgradeHint).
  - **Gating (заглушка)**: Free/Guest — сжатие только base (1 уровень), остальные уровни disabled с подсказкой "Доступно по подписке Pro". Проверка по useAuth().userRole.
  - **Ticker config**: заглушка массивом (BTCUSDT: baseFutures=25/baseSpot=500, ETHUSDT: 1/10). API позже.
- Затронутые файлы/папки:
  - frontend/src/contexts/ChartControlsContext.tsx (создан)
  - frontend/src/components/ChartHeader.tsx (создан)
  - frontend/src/components/ChartContainer.tsx (рефакторинг)
  - frontend/src/App.tsx (интеграция)
  - frontend/src/i18n/dictionaries/en.ts (расширен)
  - frontend/src/i18n/dictionaries/ru.ts (расширен)
  - frontend/src/i18n/dictionaries/kz.ts (расширен)
- Ключевые решения:
  - React Context вместо zustand (проект уже использует context-паттерн)
  - Сжатие base из конфига тикера, НЕ хардкод
  - Gating по роли на фронте (заглушка), реальная проверка на бэке в фазе 9
  - IndicatorsModal — заглушка, логика Cluster Search в фазе 11
- Тесты/проверки:
  - TypeScript compilation: PASS
  - Vite build: PASS (361ms)
  - Все 8 контролов видны в шапке: ✓
  - Переключение рынка меняет список ТФ: ✓
  - Volume mode скрыт для japanese/bars: ✓
  - Сжатие показывает base×k: ✓
  - Free — только base уровень, остальные disabled: ✓
  - Модалка индикаторов открывается/закрывается: ✓
  - Настройки сохраняются в localStorage и восстанавливаются: ✓

### [2026-06-13] Фаза 6b — Движок: фиксы рендера + имбаланс + авто-режим (ЗАВЕРШЕНА)
- Модель: Opus (mimo-auto)
- Что сделано:
  - **Корень ВСЕХ багов**: React StrictMode double-mount плодил два Engine (6 canvas вместо 3). Первый Engine с japanese-свечами висел под вторым. setVisible/removeChild не работали из-за dual-engine. **Фикс**: StrictMode отключён в main.tsx (легитимно для canvas-движка).
  - **Zoom-якорь (Bug #4)**: Формула `newOffsetX = (screenX + oldOffsetX) * effectiveFactor - screenX` в Viewport.ts. `screenToDataX` удалён.
  - **Тело свечей в кластерах (Bug #1)**: ClusterRenderer/FootprintRenderer: убраны cell.wick и cell.body (залитые прямоугольники). Теперь только текст bid/ask + volume bars.
  - **Бары (Bug #2)**: setVisible() с removeChild/addChild для переключения контейнеров. releaseAll() с try-catch для destroyed Graphics contexts. BarRenderer: scalable ticks `max(3, spacing*0.3)`.
  - **VolumeMode в кластерах (Bug #3)**: ClusterRenderer.setVolumeMode() — bidask/volume/delta. Renderer делегирует в оба рендерера.
  - **Наложение свечей (Bug #5)**: MIN_CANDLE_SPACING=1. bodyWidth = min(floor(spacing*0.8), floor(spacing-1)). maxVisibleCandles=2000.
  - **Авто-режим (Feature #6)**: Engine.resolveAutoMode(visibleCount) — <100→clusters, 100-300→footprint, >300→japanese. Кнопка "Авто" в UI.
  - **Имбаланс >300% (Feature #7)**: Строго диагональный: ask[price]/bid[price-1] > 3.0 → ask #00e5a0, bid[price]/ask[price-1] > 3.0 → bid #ff6090.
  - **Сжатие уровней (Feature #8)**: DataStore.compressLevels(). Engine.setCompression() → ClusterRenderer/FootprintRenderer.
  - **ClusterTextOverlay**: DPI scaling, font cache.
  - **setVisible() архитектура**: removeChild (physically отвязка от stage) + releaseAll() с try-catch в render(). pool.getAllActive() для скрытия pool-объектов.
- Затронутые файлы/папки:
  - frontend/src/main.tsx (StrictMode отключён)
  - frontend/src/chart-engine/Viewport.ts (zoom anchor)
  - frontend/src/chart-engine/Renderer.ts (setVisible delegation, removeAll debug logs)
  - frontend/src/chart-engine/Engine.ts (resolveAutoMode, setCompression active)
  - frontend/src/chart-engine/Scales.ts (MIN_CANDLE_SPACING=1)
  - frontend/src/chart-engine/config.ts (maxVisibleCandles, autoModeThresholds)
  - frontend/src/chart-engine/DataStore.ts (compressLevels)
  - frontend/src/chart-engine/pool/ObjectPool.ts (getAllActive, try-catch releaseAll)
  - frontend/src/chart-engine/renderers/CandleRenderer.ts (setVisible, body/wick guard)
  - frontend/src/chart-engine/renderers/ClusterRenderer.ts (убран body/wick, volumeMode, compression, imbalance)
  - frontend/src/chart-engine/renderers/FootprintRenderer.ts (убран body/wick, compression, imbalance)
  - frontend/src/chart-engine/renderers/BarRenderer.ts (setVisible, scalable ticks)
  - frontend/src/chart-engine/renderers/ClusterTextOverlay.ts (DPI, font cache)
  - frontend/src/components/ChartContainer.tsx (auto mode button, volume mode in clusters)
- Ключевые решения (→ DECISIONS.md):
  - React.StrictMode отключён из-за конфликта с canvas-движком (double-mount)
  - Zoom-якорь: формула без screenToDataX
  - ClusterRenderer/FootprintRenderer: без body/wick (только текст + volume bars)
  - setVisible: removeChild + try-catch releaseAll
  - Imbalance: строго диагональный (ask[price] vs bid[price-1])
- Открытые TODO для следующей сессии:
  - **Наложение цифр bid/ask друг на друга** — при маломspacing текст перекрывается (нужен layout/offset)
  - **Кластеры обрезаются в нижней половине графика** — японские/бары рисуются на всю высоту, кластеры только верхняя часть (вероятно visBottom=672 хардкод или問題 с priceToScreen в cluster/Footprint renderers)
  - **BitmapText vs Canvas2D** — пересмотр на полном датасете (FPS 100+ сейчас ок, но 14000 блоков не тестировались)
  - **StrictMode отключён глобально** — риск: теряем StrictMode-проверки в dev (дублирование эффектов, утечки памяти). Нужно: ре-включить StrictMode и починить Engine init/cleanup корректно (ref-guard без cleanup-сброса)
  - **Overlay2D** (crosshair, плашки цены/времени, текущая цена) — фаза 6c
  - **UI-переключатель сжатия** — API готов, UI нет
- Тесты/проверки:
  - TypeScript compilation: PASS
  - Vite build: PASS
  - Кластеры без тел свечей: ✓
  - Бары = OHLC-бары: ✓
  - Volume/Delta переключение: ✓
  - Zoom anchor фиксирует точку: ✓
  - Авто-режим переключает на порогах: ✓
  - Имбаланс >300% подсвечен: ✓
  - FPS 100+: ✓
  - Нет ошибок в консоли: ✓

### [2026-06-12] Фаза 6a — Кластеры / Футпринт / Бары + clusters-batch API
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - **ClusterRenderer**: PixiJS Graphics для body/wick + Canvas2D ClusterTextOverlay для bid/ask текста
  - **FootprintRenderer**: как ClusterRenderer + горизонтальные бары объёма (volume/delta/bidask)
  - **BarRenderer**: OHLC-бары (wick + open/close тики)
  - **Canvas2D ClusterTextOverlay**: отдельный Canvas2D слой для текста кластеров ( bid зелёный / ask красный )
  - **Renderer**: делегирование по режимам (clusters/footprint/bars/japanese), releaseAll всех пулов при смене режима
  - **Engine**: setMode(), setVolumeMode(), setCompression(), setClusterData/setClusterDataBatch
  - **DataStore**: clusterMap (timestamp → levels[]), setClusterDataBatch, preserveLevels в updateLast (WS не теряет уровни)
  - **Backend clusters-batch**: `GET /api/v1/candles/{symbol}/clusters-batch?candleOpens=...` (max 100), GetClustersBatch в репозитории (OR-условия для DateTime64)
  - **Backend CandleUpdate**: расширен полями levels []CandleLevel (bid/ask на каждом priceLevel из Redis)
  - **Batch-загрузка**: чанки по 100, параллелизм 3, кэш в DataStore.clusterMap, дебаунс 500мс на viewport change
  - **Режим при переключении**: handleModeChange грузит кластеры для видимого диапазона
  - **Viewport**: anchor-zoom (data-координата под курсором фиксируется ДО зума, offset корректируется ПОСЛЕ), clampScaleX (мин. spacing 2px)
  - **CandleRenderer**: динамическая ширина тела = spacing × (1 - gap), gap=0.2
  - **Scales**: getCandleSpacing(), clampScaleX() с ограничением мин. масштаба
  - **PixiJS deprecation fix**: fill(color, alpha) → fill({ color, alpha }) везде
  - **InteractionManager**: mouse tracking (mouseX, mouseY, isHovering, onMouseMove callback)
  - **UI**: панель Japanese/Кластеры/Футпринт/Бары + Bid×Ask/Volume/Delta
- Затронутые файлы/папки:
  - frontend/src/chart-engine/ (Engine, Renderer, Viewport, DataStore, Scales, config.ts, fonts.ts, renderers/*, overlay/)
  - frontend/src/components/ChartContainer.tsx
  - backend/internal/api/ (server.go, candles.go — clusters-batch endpoint)
  - backend/internal/repository/repository.go (GetClustersBatch interface)
  - backend/internal/repository/clickhouse/clickhouse.go (GetClustersBatch impl)
  - backend/internal/aggregator/aggregator.go (CandleLevel, levels в CandleUpdate, readLevelsFromRedis)
- Ключевые решения (→ DECISIONS.md):
  - BitmapText → Canvas2D ClusterTextOverlay (временное, требует пересмотра на полном датасете)
  - ClickHouse IN (?) с []time.Time не работает → OR-условия для DateTime64
  - open_price/close_price не нужны в clusters-batch (Decimal scan fail)
  - Only visible levels: visTop/visBottom clipped to viewport, не полная candle body
- Открытые вопросы / TODO для 6b:
  - Кластеры/футпринт рисуются ПОВЕРХ тел японских свечей — в этих режимах candle body не должен отображаться
  - Bars-режим не работает (BarRenderer есть, но не рисует — проверить делегацию)
  - Зум-якорь: смещение влево при колесе/CTRL+колесо ещё не починен (anchor-zoom математика)
  - Наложение японских свечей при горизонтальном сжатии + ограничение мин. зума
  - BitmapText→Canvas2D: ПРОТИВОРЕЧИТ CHART_ENGINE.md/DECISIONS.md — пересмотреть на полном датасете (~14000 блоков)
  - Авто-режим (<100→clusters, 100-300→footprint, >300→japanese) — в 6b
  - Имбаланс >300% подсветка — в 6b
  - Overlay2D (crosshair, плашки цены/времени, текущая цена) — в 6c
- Тесты/проверки:
  - clusters-batch: 200 с уровнями (price_level, bid_volume, ask_volume) ✓
  - Кластеры с bid/ask на BTCUSDT: цифры видны ✓
  - Переключение Japanese/Кластеры/Футпринт/Бары ✓
  - 60 FPS при пане/зуме на кластерном виде ✓
  - TypeScript compilation: PASS
  - Vite build: PASS (269ms)
  - Go build: PASS

### [2026-06-12] Фаза 5 — Движок графика: каркас + японские свечи + live pipeline
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - **Движок графика** в frontend/src/chart-engine/: Engine, Renderer, Viewport, DataStore, Scales, InteractionManager, CandleRenderer, AxisRenderer, ObjectPool
  - **Object pooling**: 1000 предвыделенных Graphics объектов, zero allocations в render loop
  - **Only visible rendering**: DataStore хранит тысячи, Renderer рисует только видимые 300-500
  - **Японские свечи**: direct draw (clear+rect+fill), bull green / bear red, альтернативная палитра
  - **Управление**: колесо→zoom к указателю, SHIFT+колесо→вертикальная растяжка, CTRL+колесо→горизонтальная растяжка, drag→пан
  - **Canvas2D слой** для осей и сетки (AxisRenderer)
  - **React интеграция**: ChartContainer компонент с fetch + WS
  - **Vite-прокси**: /api → localhost:8080, /ws → ws://localhost:8080
  - **.env автозагрузка**: добавлен godotenv в backend
  - **Ingest подключён в main.go**: goroutine ingest.New("BTCUSDT", MarketFutures, tradesCh) → agg.Run(ctx, tradesCh)
  - **OHLC fix**: колонки open_price/close_price в clusters_* (migration 005), first/last по trade time
  - **Live WS-обновления**: CandleUpdate с полным OHLC, троттлинг 200мс, running High/Low в Redis
  - **Баги исправлены**: мусорные свечи price>=90000 удалены, костыль OHLC (Open=Low/Close=High) заменён
- Затронутые файлы/папки:
  - frontend/src/chart-engine/ (Engine, Renderer, Viewport, DataStore, Scales, renderers/, interaction/, pool/)
  - frontend/src/components/ChartContainer.tsx
  - frontend/src/App.tsx, frontend/vite.config.ts
  - backend/cmd/procluster/main.go (ingest + updatesCh wiring)
  - backend/internal/aggregator/aggregator.go (first/last price, running OHLC, throttled updates)
  - backend/internal/model/model.go (ClusterRow + OpenPrice/ClosePrice)
  - backend/internal/repository/clickhouse/clickhouse.go (INSERT + SELECT с open_price/close_price)
  - backend/internal/repository/clickhouse/migrations/005_add_ohlc.sql
  - docs/DATA_MODEL.md, docs/DECISIONS.md, docs/CHART_ENGINE.md
- Ключевые решения:
  - Колонки open_price/close_price в clusters_* (проще, без JOIN)
  - Direct draw в CandleRenderer вместо shared GraphicsContext (PixiJS v8 совместимость)
  - Троттлинг WS-обновлений 200мс (не каждый трейд)
  - Vite-прокси для dev (чище CORS)
- Открытые вопросы / TODO для следующих фаз:
  - Spot ingest: aggregator хардкодит "BTCUSDT/futures", нужен мульти-маркет
  - Ingest не запускает gap fill (fillGap не вызывается из Run)
  - Точность свечей vs другие терминалы (mobchart, exocharts)
- Тесты/проверки:
  - Live candles с Binance: Open≠Low, Close≠High ✓
  - TradesCount > 0 (реальные трейды) ✓
  - REST API: 200 с корректными OHLC ✓
  - Live WS-обновления: последняя свеча обновляется в реальном времени ✓
  - TypeScript compilation: PASS
  - Build: PASS

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

### [2026-06-12] Фаза 5 — Движок графика: каркас + японские свечи
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - Создан изолированный движок графика в frontend/src/chart-engine/
  - Модули: Engine, Renderer (PixiJS WebGL + Canvas2D), Viewport, DataStore, Scales, InteractionManager
  - Object pooling для Graphics (1000 предвыделенных объектов, zero allocations в render loop)
  - Только видимые свечи рендерятся (300-500 из тысяч в DataStore)
  - Японские свечи: bull (зелёный) / bear (красный), альтернативная палитра (белый/серый)
  - Управление: колесо→zoom к указателю, SHIFT+колесо→вертикальная растяжка, CTRL+колесо→горизонтальная растяжка, drag→пан
  - Canvas2D слой для осей и сетки
  - React интеграция: ChartContainer компонент
  - Заготовка панели инструментов рисования (placeholder)
- Затронутые файлы/папки:
  - frontend/src/chart-engine/ (Engine, Renderer, Viewport, DataStore, Scales, renderers/, interaction/, pool/)
  - frontend/src/components/ChartContainer.tsx
  - frontend/src/App.tsx
  - docs/PROGRESS.md
  - docs/DECISIONS.md
  - docs/CHART_ENGINE.md
- Ключевые решения:
  - Движок изолирован от UI — никаких импортов React внутри chart-engine/
  - Object pooling: 1000 Graphics объектов предвыделены, переиспользуются
  - Only visible rendering: DataStore хранит тысячи, Renderer рисует 300-500
  - Canvas2D для текста (оси, сетка), WebGL для геометрии (свечи)
- Открытые вопросы / TODO для следующих фаз:
  - Фаза 6: Футпринт/кластеры/имбаланс
  - Фаза 7: Инструменты рисования
  - Интеграция с REST API для загрузки истории
  - Интеграция с WS для live-обновлений
- Тесты/проверки:
  - TypeScript compilation: PASS
  - Build: PASS

### [2026-06-12] Фаза 4 — REST API + WebSocket hub + лимит сессий
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - REST API: GET /api/v1/candles (параметры symbol, market, timeframe, limit, before) с Redis-кэшем (последние ~700) + ClickHouse fallback
  - GET /api/v1/candles/{symbol}/clusters/{candleOpen} — кластеры по свече
  - Единый JSON-контракт ответа: {ok, data, error{code, message}}
  - Лимиты пагинации: limit 1..500, before — unix毫秒 timestamp
  - HTTP-сервер с middleware: CORS, security headers, recovery
  - Rate limiting: per-IP через Redis sorted set (REST 60/min, WS 5/min)
  - WebSocket hub: подписка по (symbol, market, timeframe), рассылка candle_update, heartbeat, unregister
  - Redis session limit: Sorted Set `chart_sessions:{userId}`, Lua-атомарный скрипт проверки+регистрации
  - Политика last-wins: новая сессия вытесняет старейшую, вытесненная получает session_evicted
  - Heartbeat каждые 10с, порог протухания 30с
  - Лимиты per тариф: Free=1, Pro=2, VIP=2, Admin=-1 (без лимита)
  - Интерфейс userId-заглушки: extractUserID (query param или IP-based guest)
  - Агрегатор расширен каналом UpdatesCh для broadcast в WS hub
  - Cache: убран хардкод "futures" в ключах — market теперь параметр
  - Тесты: TestSessionLimit_NoRaceOverflow (N=50, limit=1), LastWins, Heartbeat, RemoveSession, HeartbeatExpiry — все PASS
  - Зависимости: добавлен miniredis/v2 для тестов
- Затронутые файлы/папки:
  - backend/internal/api/ (server.go, candles.go, hub.go, session.go, stream.go, ratelimit.go, session_test.go)
  - backend/internal/aggregator/aggregator.go (добавлен UpdatesCh + SetUpdatesCh)
  - backend/internal/cache/cache.go (убран хардкод market)
  - backend/cmd/procluster/main.go (полная wiring: Redis, CH, Cache, Aggregator, SessionManager, RateLimiters, Server)
  - backend/go.mod, backend/go.sum
- Ключевые решения:
  - HTTP без фреймворков (стандартный net/http + ServeMux) — минимум зависимостей
  - Session limit: Lua-скрипт атомарно очищает протухшие + проверяет лимит + регистрирует/вытесняет
  - WS-контракт: session_active/session_evicted/session_rejected (сервер→клиент), chart_subscribe/heartbeat/chart_unsubscribe (клиент→сервер)
  - userId-заглушка: query param или IP-based guest ID, реальная auth в фазе 9
- Открытые вопросы / TODO для следующих фаз:
  - Фаза 5-6: Движок графика (PixiJS WebGL)
  - Фаза 9: Реальная авторизация (JWT + UserIDExtractor)
  - Multi-symbol/multi-market: убрать хардкод BTCUSDT в aggregator
  - Тесты с -race: требуют gcc/CGO (не доступно на текущей машине)
- Тесты/проверки:
  - go test ./internal/api/ — PASS (5 тестов)
  - go test ./internal/aggregation/ — PASS
  - go test ./internal/ingest/ — PASS
  - go test ./internal/repository/clickhouse/ — PASS
  - go build ./... — OK
  - gofmt -l . — OK
  - go vet ./... — OK
  - **go test -race НЕ запускался локально** (Windows без CGO/gcc). Обязательно прогнать в CI на Linux (фаза 14). До тех пор -race не считать пройденным.

### [2026-06-12] Фаза 3 — Ingest + Aggregator realtime + Rollup
- Модель: MiMoCode (mimo-auto)
- Что сделано:
  - Создан ingest-воркер: WS клиент (gorilla/websocket) с реконнектом (exponential backoff 1s→30s)
  - Два парсера WS: futures (@aggTrade, поле `a`) и spot (@trade, поле `t`) → единый model.Trade
  - Gap filler: REST дозапрос пропущенных трейдов (futures /fapi/v1/aggTrades, spot /api/v3/historicalTrades)
  - Валидация входящих данных: price>0, qty>0, tradeId>lastId, time within 10s
  - Aggregator: hot aggregation текущей 1m свечи в Redis (hash: priceLevel→"bid,ask")
  - Rollup worker: при закрытии 1m дописывает готовые строки 1h/4h/1d в те же таблицы ClickHouse (суммирование + TRUNCATE на финале)
  - Cache: Redis sorted set для 700 свечей по (symbol, timeframe, market)
  - Добавлены зависимости: go-redis/v9, gorilla/websocket
- Затронутые файлы/папки:
  - backend/internal/ingest/ (client.go, parser.go, gapfill.go, ingest.go, ingest_test.go)
  - backend/internal/aggregator/ (aggregator.go)
  - backend/internal/cache/ (cache.go)
  - backend/go.mod, backend/go.sum
- Ключевые решения:
  - Spot: @trade (индивидуальные), Futures: @aggTrade (единственный доступный источник Binance)
  - isBuyerMaker: true→SELL/ASK, false→BUY/BID — единообразно для обоих
  - Rollup: суммирование по priceLevel, TRUNCATE один раз на финале
  - DATA_MODEL.md обновлён: исправлена интерпретация isBuyerMaker, уточнён источник трейдов
- Открытые вопросы / TODO для следующих фаз:
  - Фаза 4: REST API + WebSocket hub (live-рассылка клиентам)
  - Фаза 5-6: Движок графика (PixiJS WebGL)
  - Интеграция aggregator с cmd/procluster/main.go (запуск воркеров)
- Тесты/проверки:
  - go test ./internal/aggregation/ — PASS
  - go test ./internal/ingest/ — PASS (парсинг futures/spot, валидация, side interpretation)
  - go test ./internal/repository/clickhouse/ — PASS
  - go build ./... — OK
  - gofmt -l . — OK
  - go vet ./... — OK

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

### [2026-06-14] Фаза 12 Этап 3: Ticker Registry + Default Compressions + History-Loader Binance Vision
- Модель: Opus (mimo-v2.5-free)
- Что сделано:
  - **Ticker Registry**: `admin/tickers.go` — CRUD (AddTicker, GetTickerByID, ListTickers, UpdateTicker, DeleteTicker), ValidateTicker (regex, uniqueness, priceTick>0, compression>0), SeedDefaultTickers (BTCUSDT), SymbolConfigsFromTickers ([]Ticker→map[string]SymbolConfig), boolToInt/intToBool helpers.
  - **Default Compressions**: `admin/compressions.go` — CRUD (GetDefaultCompressions, UpsertDefaultCompression, UpsertDefaultCompressionsBatch), ValidateCompressionMultiplier (multiplier ≥ base compression of ticker for market), SeedDefaultCompressions (BTCUSDT: futures 1m=25/5m=25/15m=50/30m=50/1h=100/4h=100, spot 15m=500/30m=500/1h=1000/4h=1000).
  - **History-Loader Binance Vision**: `admin/historyloader.go` — DownloadJob struct, HistoryClickHouse interface (avoid import cycle), JobRegistry (SQLite-backed, survives restarts), StartDownload goroutine (non-blocking), downloadWorker (download zip → unzip → parse CSV → aggregate 1m via CompressTrades → Rollup → idempotent insert via DeleteClustersByRange+InsertClusterBatch), progress/ETA per day, status tracking.
  - **Handlers**: `admin/handlers.go` — Replaced 6 stubs (handleAddTicker, handleGetTickers, handleUpdateTicker, handleDeleteTicker, handleStartDownload, handleGetJobs, handleGetJobStatus) with real implementations. Added handleGetCompressions + handleUpsertCompressions + routes.
  - **SQLite migrations**: `auth/sqlite.go` — Added tickers, default_compressions, download_jobs tables to Migrate().
  - **main.go refactor**: SeedDefaultTickers/SeedDefaultCompressions on startup, load tickers from DB via ListTickers, SymbolConfigsFromTickers, ingest workers in loop over DB tickers (no more hardcoded BTCUSDT).
  - **Frontend**: DatabaseTab with 3-column layout (TickerBlock: list+add+edit+delete, CompressionBlock: grid of multipliers per market/timeframe, HistoryBlock: download form + jobs list with progress).
  - **Frontend api.ts**: DefaultCompression interface + apiGetCompressions + apiUpsertCompressions.
  - **Frontend i18n**: 30+ database.* keys added to en.ts, ru.ts, kz.ts.
- Затронутые файлы:
  - `backend/internal/admin/tickers.go` (NEW)
  - `backend/internal/admin/compressions.go` (NEW)
  - `backend/internal/admin/historyloader.go` (NEW)
  - `backend/internal/admin/handlers.go` (rewritten stubs → real)
  - `backend/internal/auth/sqlite.go` (new tables in Migrate)
  - `backend/cmd/procluster/main.go` (ticker loop, seed)
  - `frontend/src/features/admin/api.ts` (compression types)
  - `frontend/src/components/AdminPanel.tsx` (DatabaseTab)
  - `frontend/src/i18n/dictionaries/en.ts, ru.ts, kz.ts` (database.* keys)
- Ключевые решения:
  - Variant A для тикеров: изменения生效 после рестарта сервера.
  - Default compressions хранятся в SQLite (глобальные, не привязаны к пользователям). Тарифные лимиты — Этап 2.
  - HistoryClickHouse interface для historyloader — избегает import cycle.
  - Задачи загрузки хранятся в SQLite (download_jobs) — выживают после рестарта.
  - CSV формат: aggTradeId,price,quantity,firstTradeId,lastTradeId,timestamp,isBuyerMaker.
- Тесты/проверки: `go build`, `go vet`, `go test ./...` — all pass. `tsc --noEmit` — clean. `vite build` — success.

## 2026-06-21 — DOM глубина: полная книга через diff-stream

- Цель: стакан с шагом $10 (и любым из 8 уровней) с реальной глубиной ±5% от цены.
  Раньше глубина была ограничена ~$100 от середины из-за двух ошибок в синхронизации
  и REST-лимита spot.
- Корневые причины:
  1. Snapshot фетчился ДО WS subscribe → между ними терялись апдейты → постоянные ресинки
     → накопленная далёкая глубина сбрасывалась на каждом ресинке.
  2. В pending replay не фильтровались stale события (futures `u<lastUpdateId`,
     spot `u<lastUpdateId+1`) — их применение ломало sequence для следующих валидных.
  3. Spot REST запрашивался с `limit=1000` при потолке Binance 5000.
- Фикс:
  - `depth/sync.go` — переписан `connectAndSync`: dial WS первым → горутина буферизует
    в `pending` → параллельно `fetchSnapshot` → drainPending(stale-drop, find first,
    ApplyFirstEvent для первого, normal validate для остатка). Spot REST `limit=5000`.
    Конфигурируемая частота diff-stream через env `DEPTH_WS_RATE_MS` (дефолт 100,
    с клампом по правилам каждого рынка).
  - `depth/orderbook.go` — добавлены `ApplyFirstEvent` (без валидации sequence — для
    первого event после snapshot), `Prune(centerPrice, pctRange)` (защита RAM от
    бесконечного роста книги), `Stats() BookStats` (диагностика).
  - `depth/livedom.go` — добавлены pruneTicker 30s (Prune до ±10%) и logTicker 60s
    (`[depth-stats]` лог с bids/asks/range/coverage). Выходной 1-сек ticker (вывод на
    фронт) НЕ ТРОНУТ — пользователь явно зафиксировал что входная и выходная частоты
    разные.
  - WS subscribe протокол — точно по Binance docs (свёрено через WebFetch отдельно
    futures и spot). Подробно в `docs/DOM_SPEC.md::Local order book maintenance`.
- Не тронуто: `ApplyFuturesUpdate`/`ApplySpotUpdate` (sequence validation), `GetAggregatedLevels`
  (±5% фильтр + `floor(price/baseStep)*baseStep`), `Snapshotter` (улучшение прилетает
  автоматически — он использует ту же книгу), фронтенд.
- Затронутые файлы:
  - `backend/internal/depth/sync.go` (rewrite connectAndSync)
  - `backend/internal/depth/orderbook.go` (+ApplyFirstEvent, +Prune, +Stats, +BookStats)
  - `backend/internal/depth/livedom.go` (+pruneTicker, +logTicker, +pruneAll, +logStats)
  - `backend/internal/depth/orderbook_test.go` (+3 теста)
  - `docs/DOM_SPEC.md` (+раздел Local order book maintenance)
- Smoke test после рестарта: spot snapshot bids=5000 asks=5000, futures bids=1000
  asks=1000, 0 sequence mismatch, 0 session ended за первые 5 минут.
- TODO:
  - На VPS прогнать `go test -race ./internal/depth/...` (на Windows нет cgo/gcc).
  - Через 30+ минут проверить рост coverage в логе `[depth-stats]`. Критерий: для
    futures coverage стабильно растёт от ~0.1% и достигает ≥1.5% за час.
  - При наблюдении регулярных `sequence mismatch` (>5/час) откатить sync.go и копать дальше.

## 2026-06-21 (continued) — DOM regression: книга замёрзшая на snapshot

После прошлой записи юзер запустил `procluster.exe` у себя и увидел: futures
bids/asks=1000 (ровно REST limit), range замёрз 4+ замера подряд. Spot тоже
держался на snapshot (range=[63018..65129] весь час — я этого не заметил в
прошлой верификации). Два независимых бага в `depth/sync.go`:

1. **Spot WS payload дропался 100%**: single-stream URL `/ws/<stream>` шлёт
   `depthUpdate` плоско, а `sync.go` парсил в `WSMessage{stream, data}`. `Unmarshal`
   успешно с `Data` zero-value (`Symbol=""`), все ивенты дропались symbol-фильтром.
2. **Futures first event после snapshot не обрабатывался**: когда `drainPending` не
   находил first в `pending` (например все 4 буферных события stale), сразу шёл в
   streaming, и первое streaming event попадало в `processEvent` → `ApplyFuturesUpdate`
   валидирует `pu == lastUpd`, что невозможно для первого ивента после snapshot →
   `sequence mismatch` → reconnect → новый snapshot → та же история. Backoff в `Run`
   глушил лог `session ended` визуально.

Фикс (commit cd606fb):
- `parseDepthMessage` пробует wrapper, потом flat — обе формы.
- Futures WS URL → single-stream (`/ws/<stream>`) для единообразия со spot.
- Флаг `needsFirstApply` после snapshot: первое streaming event через
  `ApplyFirstEvent` если drain не нашёл first.
- `[depth-debug]` логи и step-trace под env `DEPTH_DEBUG=1` (off в проде).

Verified live (90с после рестарта у юзера):
- futures `applied=485, drop_sym=0, range=[63340..65319]`, coverage=±1.54%.
- spot `applied=490, drop_sym=0, range=[63333..65238]`, coverage=±1.60%.
- Оба растут в направлении ±10% prune window.

Note: ошибся в прошлой верификации — судил по coverage% не глядя на эволюцию
`range`. Замёрзший snapshot выглядел как "стабильная книга" потому что
центр (lastPrice) обновлялся отдельно через `aggregator`. Урок: смотреть на
динамику `range=[X..Y]`, не только на coverage%.

## 2026-06-22 — Bug-fix: ctrl+wheel horizontal-zoom anchor (рывок + смещение)

Юзер: при ctrl+колесо график (а) слабо дёргается и возвращается; (б) при сильном
зуме уезжает и якорь под курсором не держится. Shift+колесо (vertical) корректен —
эталон.

**Диагностика** (вся — без правок репо, поверх runtime):
- Wheel-handler [ClusterChart.tsx:848-996](frontend/src/chart2d/ClusterChart.tsx:848).
- Чтения формулы якоря уже атомарны и из refs (`candleWidthRef.current`,
  `container.scrollLeft`) — throttled state в hot-path не читался.
- ОДНА корневая причина для обоих симптомов: в wheel-ветках (ctrl + combo) был
  только нижний кламп `nextScrollLeft = Math.max(0, ...)`, без верхнего. При
  zoom-out новый `scrollWidth` сжимается, расчётное `nextScrollLeft` превышает
  `(newScrollWidth - clientWidth)`. DOM при `container.scrollLeft = X` молча
  кламп-ает значение, а наш `setVisibleScrollLeftSync(X)` пишет в ref/state
  НЕЗАКЛАМПЛЕННОЕ значение. ε-расхождение → следующий tick onScroll re-syncит
  ref с зажатого DOM → видимый «возврат». На сильном зуме разница большая →
  визуально полное смещение.
- Вторичный фактор: wheel-handler не звал `scheduleDraw()` сразу — рассчитывал
  на React-commit useLayoutEffect или на async scroll-event. Между этими точками
  браузер мог запейнтить старый canvas на новой scroll-позиции контейнера → вспышка.

**Фикс** (commit на procluster sub-modulей, файл `frontend/src/chart2d/ClusterChart.tsx`):
- Ctrl-ветка (~917-928): добавлен `containerClientWidth` + `maxScroll` + `clampedScrollLeft`
  по реальной ширине нового спейсера. В DOM/ref/state пишется ОДНО зажатое значение.
- Combo-ветка (~957-968): идентичная правка.
- Конец `handleWheel` (~999): добавлен явный `scheduleDraw()` — paint в том же
  кадре что и wheel-event.

Образец клампа взят из time-scale-drag [ClusterChart.tsx:2556-2558](frontend/src/chart2d/ClusterChart.tsx:2556),
где эта же модель уже работает корректно.

**Verify**:
- `npx tsc --noEmit` ✓
- `npx vite build` ✓ (593 мс)
- Юзеру проверить руками: слабый/сильный ctrl-зум, точка под курсором держится,
  нет рывка-возврата; shift и combo wheel — без регрессий; обычный скролл, drag-pan,
  crosshair, дозагрузка истории, live-WS-тик — без регрессий; FPS scroll держит ~77.

Не тронуто: rAF/dirty-flag (S2), crosshair/overlay (S1), anti-jump prependScrollRef,
shift-зум, onScroll, drag-pan, time-scale-drag.

## 2026-06-22 — Fix #2: candleWidthRef как единственный синхронный writer (race condition)

Фикс 0287969 (верхний clamp + явный scheduleDraw) **дефект НЕ устранил**.
Реальная пачка ctrl+wheel с физической мыши (dtMs 27-40 мс) поймала прыжок якоря
на ~20 свечей. Diagnostic-логи (`[ctrl-zoom]`, `[cw-sync]`) показали:

```
n=31  cwAfter=18.9233
[cw-sync] delta=-1.4017   ← useEffect[525] синкает ref ← state со СТАРЫМ closure
n=32  cwBefore=17.5216    ← stale: ref откатился на шаг назад
       idxBefore: 337.4 → 357.5 (+20 свечей)
... 28 мс ...
[cw-sync] delta=+1.4017   ← возвращает к актуальному 18.9233
```

При `dtMs > 200 мс` (медленная мышь) `delta` всегда 0 — дефекта нет.

**Корневая причина**: `useEffect(() => { candleWidthRef.current = candleWidth; }, [candleWidth])`
был асинхронным мостом state → ref. В React 18 при burst-commits очередь
эффектов обрабатывается с **closure-captured** значениями каждого commit'а.
Эффект из старого commit'а пишет в ref устаревшее значение между двумя
wheel-событиями → wheel читает stale → формула якоря строится от неверного
candleWidth → прыжок индекса.

**Фикс** (commit на procluster sub-module, файл `frontend/src/chart2d/ClusterChart.tsx`):
- Удалён `useEffect [candleWidth]` (525-527) — больше нет асинхронного writer'а ref'а.
- В каждом из **7 call-site'ов** `setCandleWidth` ref пишется СИНХРОННО, ДО `setCandleWidth`:
  - wheel ctrl (~949), wheel combo (~1017): переупорядочено (ref ВЫШЕ set).
  - auto-fit (~1092, isComboChange only): добавлен парный ref-write.
  - `handleZoom` (~1148): functional update заменён на чтение через ref.
  - `handleResetZoom` (~1174, ~1177): парные ref-write для обеих веток.
  - time-scale-drag (~2608): парный ref-write.

Теперь `candleWidthRef` — единственный источник правды в hot-path; state
catch-up на следующем React-commit'е через `useLayoutEffect`, который
ре-собирает `drawRef`. Сквозной grep: внешних читателей, зависящих от
state-ref divergence, нет (один outlier `startCandleWidthRef.current = candleWidth;`
на L1493 — read STATE на time-scale mousedown — оставлен как follow-up, риск
низкий: drag и wheel-burst редко одновременны).

**Verify**:
- `npx tsc --noEmit` ✓
- `npx vite build` ✓
- Юзеру: после фикса в логах cwBefore[k+1] === cwAfter[k] всегда; idx
  под курсором не прыгает на N свечей; HMR на :5182 подхватит автоматически.

**Не тронуто в этом коммите**: формула якоря, верхний clamp (0287969),
S2 rAF/dirty-flag, S1 crosshair, anti-jump prepend, shift-зум, drag-pan,
onScroll, time-scale читалка на L1493. Проблема рассинхрона paint
(мерцание) — отдельный коммит, если останется после fix #2.

## 2026-06-22 — Fix #3: синхронная отрисовка при ctrl-зуме (мерцание)

После fix #2 прыжок якоря устранён, но **визуальное мерцание сбоку** при
быстром ctrl+wheel zoom-out **осталось**. Diagnostic-логи `[draw-tick]`
показали задержку между `container.scrollLeft = X` (sync) и следующим
draw'ом (отложен в rAF через `scheduleDraw`): **100-455 мс**. Всё это время
браузер показывал старый canvas на новой scroll-позиции контейнера → виден
сдвиг сбоку.

**Фикс** (commit на procluster sub-module, `frontend/src/chart2d/ClusterChart.tsx`):

1. **Shadow в drawRef body** (~2675, сразу после `visibleScrollLeft` shadow):
   - `candleWidth = candleWidthRef.current` + derivatives (`candleSpacing`,
     `candleWidthSpacing`, `indexToX`, `scrollWidth`) — 5 локальных `const`.
   - Паттерн идентичен `const visibleScrollLeft = visibleScrollLeftRef.current`
     на L2672 (S3 fix).
   - Все 70+ usages этих имён внутри drawRef резолвятся на shadow (JS scope).

2. **Sync `drawRef.current()` в ctrl-ветке** (~949, после
   `setVisibleScrollLeftSync`):
   - Синхронный paint в том же wheel-тике после согласованной записи
     (`candleWidthRef`, `setCandleWidth`, `container.scrollLeft`,
     `setVisibleScrollLeftSync`).
   - Кадр сразу консистентен (ref-shadow + новый scrollLeft).
   - `scheduleDraw()` в конце handleWheel оставлен — он нужен для combo/shift
     веток, post-commit useLayoutEffect (второй кадр со state-catch-up),
     scroll/WS-тиков.

**Покрытие**: shadow покрывает прямую отрисовку candles/grid/footprint/scroll-границ.

**Known limitation (follow-up по необходимости)**: outer-scope memo'и,
зависящие от state `candleWidth` (через `useMemo` deps), на sync-кадре дают
cache-hit со **STALE** значениями. Конкретно:
- `cumulativeDeltaPoints` (CVD coords, L2316-2319): точки CVD на 1 кадр
  могут отставать от свеч (≤16 мс, против прежних 100-455 мс — улучшение в
  ~28 раз). На rAF-после-commit'а memo пересчитывается, CVD выравнивается.
- `zoomedCvdMax/Min/Range/cvdCenterVal` (L2355): CVD-scale тот же кадр stale.
- `isDetailedMode` (L1216-1219, derived от state): edge-case вокруг
  candleWidth=15 — sync-кадр и rAF-кадр могут быть в разных режимах. Внутри
  одного режима — без эффекта.

Если CVD-отставание окажется визуально заметным — fix через `flushSync` или
ref-refactor CVD memo'ев (отдельный коммит).

**Цена**: 2 draw'а на одно wheel-событие в ctrl-ветке (~3-6 мс/draw ×2 =
~6-12 мс). При burst dtMs=30 мс — <40% бюджета, приемлемо.

**Verify**:
- `npx tsc --noEmit` ✓
- `npx vite build` ✓ (721 мс)
- Юзеру: мерцание сбоку при ctrl+wheel zoom-out должно исчезнуть; задержка
  `[draw-tick]` после `[ctrl-zoom]` ≈ 0 мс (sync) + один второй rAF-tick.

Не тронуто: combo wheel, shift, scheduleDraw (для прочих путей), формула
якоря, верхний clamp, fix #2 SoT, anti-jump prepend, drag-pan, onScroll.

## 2026-06-22 — Зум-история закрыта: 3 фикса + cleanup

ctrl+wheel зум (горизонтальный) — серия рывков, прыжков якоря и мерцания —
полностью устранена тремя атомарными фиксами + cleanup:

| commit | проблема | решение |
|---|---|---|
| `0287969` | рывок-возврат + полное смещение при сильном зум-out | верхний clamp `nextScrollLeft` по новой ширине spacer'а в обеих wheel-ветках; явный `scheduleDraw()` в конце handleWheel |
| `c3c74f8` (Fix #1 / SoT) | прыжок якоря на ~20 свечей при быстрой пачке (dtMs<40 мс) — useEffect[525] откатывал `candleWidthRef` со stale closure-state | удалён asynchronous useEffect, ref-write добавлен СИНХРОННО ДО `setCandleWidth` в 7 call-site'ах |
| `3394377` (Fix #3) | мерцание сбоку: задержка 100-455 мс между sync `container.scrollLeft = X` и rAF draw'ом | (a) shadow `candleWidth`/`candleSpacing`/`candleWidthSpacing`/`indexToX`/`scrollWidth` от ref в drawRef body; (b) sync `drawRef.current()` в ctrl-ветке после согласованной записи |

**Диагностическая инструментовка** (`[ctrl-zoom]`, `[draw-tick]`, `[cw-sync]`)
жила только в working tree, в git **никогда не коммитилась**. После
подтверждения работы фиксов удалена локально.

**Known limitation** (follow-up по необходимости): outer-scope `useMemo`,
зависящие от state `candleWidth` (CVD-точки на L2316, CVD-scale на L2355,
`isDetailedMode` на L1216), на sync-кадре дают stale-cache → CVD/режим
могут отставать **на 1 кадр** (≤16 мс). Раньше отставали 100-455 мс,
улучшение ~28×. Если визуально заметно — фикс через `flushSync` или
ref-refactor CVD memo'ев отдельным коммитом.

**Outlier** для time-scale-drag: `startCandleWidthRef.current = candleWidth` на
L1493 читает STATE на mousedown. Drag сразу после wheel'а до commit'а получит
stale baseline. Drag + wheel-burst редко одновременны, риск низкий — оставлен
follow-up'ом.

Замеры (синтетический wheel-burst через Chrome DevTools MCP + реальная
мышь в браузере пользователя):
- per-tick anchor drift ≤ 0.5 px (DOM pixel-rounding), кумулятив за 8-16
  шагов ≤ 1.7 px (визуально невидимо).
- задержка sync-draw vs scheduleDraw: ~0 мс vs 100-455 мс (улучшение ~25-1000×).
- prevRef vs cwBefore[k+1] = совпадают (fix #1 подтверждён).
- FPS scroll ~77 не просел.

Зум закрыт. Дальнейшие задачи — отдельные.

---

## 2026-06-22 — Per-key indicators (Phase 15, Feature 1)

Привязка индикаторов к ключу `symbol + market + timeframe` с серверным
хранением, локальным кэшем-страховкой, опцией "на все ТФ" через маркер
`timeframe='*'`, и админскими дефолтами через 5-уровневый каскад:
user-tf → user-all-tf → admin-tf → admin-all-tf → system.

### Backend
- Миграция Phase 15 в `internal/auth/sqlite.go:299-323`: таблицы
  `user_indicators` и `admin_indicator_defaults` (PK на `(user_id?, symbol, market, timeframe)`).
- CRUD + резолвер каскада в новом `internal/auth/indicators.go`:
  `Get/Upsert/Delete/MergeAddUserIndicator`, `Get/List/Upsert/Delete AdminIndicatorDefault`,
  `ResolveIndicators` с обязательным `ORDER BY prio LIMIT 1` (UNION ALL в SQLite
  без ORDER не гарантирует порядок).
- HTTP-эндпоинты в `internal/auth/indicators_handlers.go`:
  - `GET  /api/v1/user/indicators` — auth-optional, гость видит только admin-*.
  - `PUT  /api/v1/user/indicators` — auth, mode=replace|merge-add.
  - `DELETE /api/v1/user/indicators` — auth, снимает override.
  - `PUT  /api/v1/user/settings/favorite-indicators` — атомарный merge
    `favoriteIndicatorIds` в `user_settings.settings_json` через транзакцию SQLite.
  - Канонизация на входе: symbol→UPPER, market/tf→lower, валидация
    против `TIMEFRAMES_BY_MARKET ∪ {'*'}`.
- Админские эндпоинты в новом `internal/admin/indicator_defaults.go`:
  - `GET  /api/v1/admin/indicator-defaults?symbol=X` — список всех (market, tf).
  - `PUT  /api/v1/admin/indicator-defaults` — replace; `RequireRole("admin")`.
  - `DELETE /api/v1/admin/indicator-defaults` — удалить запись.
- `SetUserSettingsField` в `internal/auth/user_settings.go` — общий
  read-modify-write для одного поля в JSON-блобе настроек (использует
  favorites; не затирает другие поля блоба).
- Тесты: 5 unit (CRUD + resolver + favorites-merge) + 5 integration
  через httptest mux (cascade через HTTP, нормализация регистра,
  merge-add idempotent, DELETE→каскад, валидация). Все зелёные.

### Frontend
- Новый каталог `frontend/src/features/indicators/`:
  - `types.ts` — `StoredIndicator`, `IndicatorsSource`, `ALL_TF_MARKER`,
    схема localStorage v3.
  - `api.ts` — HTTP-клиент (fetch/put/mergeAdd/delete + favorites).
  - `storage.ts` — канонизация ключа, `hydrate/dehydrateForSave` с
    passthrough неизвестных id, миграция legacy `procluster_indicators_v2`
    в одну `scope=all-tf` row (старый ключ переименован, не удалён).
  - `IndicatorsStorageContext.tsx` — Provider с in-memory `Map<comboKey,Entry>`,
    lazy-load + stale-while-revalidate, write-through в localStorage,
    обработка login/logout через `useEffect` на `user?.id`, hooks
    `useIndicatorsStorage` и `useIndicatorsForKey`.
  - старый `useIndicators.ts` удалён.
- `App.tsx` — `IndicatorsStorageProvider` в дереве; `useIndicatorsForKey` для
  slot 0/1 (per-slot indicators); 6 рендер-мест ChartContainer2 принимают
  свои per-slot indicators/handlers; IndicatorsModal привязан к активному
  слоту.
- `IndicatorsModal.tsx` — source badge (3 текста: admin/system,
  user-all-tf, user-tf без бэйджа); чекбокс "Применять ко всем ТФ" в
  footer; на Apply newly-activated индикаторы записываются и в scope=all-tf
  через `addToAllTimeframes`.
- `AdminPanel.tsx` — `AdminIndicatorDefaultsBlock` в Settings tab:
  список дефолтов для введённого symbol, Delete на каждой row,
  "Сохранить из графика" (per-tf или all-tf) для активного слота.

### Файлы
**Backend:**
- `backend/internal/auth/sqlite.go` (изменён)
- `backend/internal/auth/indicators.go` (новый)
- `backend/internal/auth/indicators_handlers.go` (новый)
- `backend/internal/auth/indicators_test.go` (новый)
- `backend/internal/auth/indicators_handlers_test.go` (новый)
- `backend/internal/auth/handlers.go` (RegisterRoutes patch)
- `backend/internal/auth/user_settings.go` (SetUserSettingsField)
- `backend/internal/admin/indicator_defaults.go` (новый)
- `backend/internal/admin/handlers.go` (RegisterAdminRoutes patch)

**Frontend:**
- `frontend/src/features/indicators/types.ts` (новый)
- `frontend/src/features/indicators/api.ts` (новый)
- `frontend/src/features/indicators/storage.ts` (новый)
- `frontend/src/features/indicators/IndicatorsStorageContext.tsx` (новый)
- `frontend/src/features/indicators/useIndicators.ts` (УДАЛЁН)
- `frontend/src/features/admin/api.ts` (расширен)
- `frontend/src/App.tsx` (изменён)
- `frontend/src/components/IndicatorsModal.tsx` (изменён)
- `frontend/src/components/AdminPanel.tsx` (расширен)

### TODO
- Live-apply настроек (Фича 2): сейчас onChange кладёт в draft, Apply
  пишет в storage; для live нужен дополнительный путь `applyImmediate`
  → `saveForKey` без закрытия модалки. Требует мемоизации
  IndicatorsModal (Фича 4) ради производительности.
- Пресеты (Фича 3): отдельная таблица `indicator_presets` + UI
  save/load/toggle-default в IndicatorsModal.
- WS-инвалидация админ-дефолтов на клиенте: сейчас юзер увидит
  обновлённый админ-дефолт только при следующем GET (по TTL 5мин или
  смене ТФ).
- BroadcastChannel sync между вкладками (две вкладки на одной паре
  не видят друг друга до переключения ТФ).
- "Удалить со всех ТФ" UI (сейчас удаление работает только для
  текущего ТФ; пользователь вручную обходит ТФ).

---

## 2026-06-26 — Тоггл «Скрыть числа в кластерах» (per symbol+market)

Новый сеттинг `clusterHideNumbers_<symbol>` зеркалит `clusterAbbreviate_`: ключ
вида `{ [market]: boolean }`, сохраняется через UserSettingsContext (сервер для
авторизованных, localStorage для гостей). По умолчанию выключен. При включении
гейт `hideFootprintNumbers` обрывает отрисовку цифр в ячейках футпринта/кластеров
до форматирования — ячейки и обводка остаются. Авто-скрытие при >70 свечей
сохранено. Если включены оба тоггла («сокращение» + «скрыть») — «скрыть»
побеждает (гейт раньше форматирования).

UI-тоггл добавлен в выпадающее меню «Настройки графика» сразу после блока
«Сокращение чисел». Тексты на RU/EN/KZ:
- RU: «Скрыть числа в кластерах» / «Не показывать цифры внутри ячеек»
- EN: «Hide cluster numbers» / «Don't show numbers inside cells»
- KZ: «Кластерлердегі сандарды жасыру» / «Ұяшықтардағы сандарды көрсетпеу»

### Файлы
- `frontend/src/chart2d/ChartContainer2.tsx` — добавлены state+handler по
  паттерну abbreviateNumbers, проброс в ClusterChartAdapter.
- `frontend/src/chart2d/ClusterChartAdapter.tsx` — пропсы
  `hideClusterNumbers` / `onToggleHideClusterNumbers`, проброс в ClusterChart.
- `frontend/src/chart2d/ClusterChart.tsx` — пропсы, расширение гейта
  `hideFootprintNumbers = visibleCandlesCount > 70 || hideClusterNumbers`,
  новый UI-блок свитча.
- `frontend/src/contexts/UserSettingsContext.tsx` — добавлен префикс
  `clusterHideNumbers_` в server-priority merge при логине.

### Verification
- `npx tsc --noEmit` — без ошибок.
- `npx vite build` — успешно (2933 modules, 641ms).
- dev-сервер стартовал (vite 8.0.16, порт 5174) без HMR-ошибок; остановлен.

### TODO
- Ручная проверка в браузере: тоггл виден/работает на режимах
  футпринт+кластеры, состояние сохраняется после F5 (LS для гостя,
  сервер для логина), раздельность futures/spot.

---

## 2026-06-26 — Админка: кнопка «Подтянуть» tick size из Binance exchangeInfo

В блоке «Добавление и сжатие новых монет» рядом с полем «Символ» появилась
кнопка «Подтянуть». По клику дёргает Binance exchangeInfo (spot + USD-M
futures) и автозаполняет поля «Мин. тик (Spot)» и «Мин. тик (Futures)».
Ручной ввод этих полей сохранён — кнопка только подставляет значения,
юзер может перебить.

Поведение по рынкам:
- Symbol есть на обоих рынках (BTCUSDT, SOLUSDT) → оба поля заполняются.
- Symbol есть только на одном рынке → второе поле остаётся как было,
  показывается жёлтое сообщение «Spot|Futures: не найдено на Binance».
- Symbol не существует (FAKEUSDT) → оба поля без изменений, сообщение
  «не найдено на Binance».
- Сетевая ошибка / гео-блок api.binance.com → серверный 502
  BINANCE_UNAVAILABLE, на UI показывается «Ошибка запроса к Binance: …».
  Локально работает через прокси юзера (HTTPS_PROXY/ALL_PROXY) — клиент
  собран с `http.ProxyFromEnvironment`.

### Бэкенд
- `backend/internal/binance/exchangeinfo.go` (новый) — пакет с
  `TickInfo{SpotTick,SpotFound,FuturesTick,FuturesFound}` и
  `FetchTickSizes(ctx, symbol)`. Spot: `GET api.binance.com/api/v3/exchangeInfo?symbol=...`,
  HTTP 400 → SpotFound=false (символа нет на споте, не ошибка). Futures:
  `GET fapi.binance.com/fapi/v1/exchangeInfo` (полный список ~1-2 МБ, фильтр
  по symbol на клиенте). Из обоих ответов берётся `PRICE_FILTER.tickSize`.
  Транспорт: `Proxy: http.ProxyFromEnvironment`, общий таймаут 10 сек.
  Если оба запроса упали по сети — возвращается error; если хотя бы один
  ответил — TickInfo с тем, что нашли. Кэш не делал (кнопка жмётся редко).
- `backend/internal/admin/handlers.go` — добавлен импорт пакета binance,
  обработчик `handleBinanceTickerInfo` (GET `/api/v1/admin/tickers/binance-info?symbol=...`),
  валидация symbol через существующий `symbolRe = ^[A-Z0-9]{2,10}$`,
  сетевая ошибка → 502 `BINANCE_UNAVAILABLE`. Маршрут зарегистрирован в
  `RegisterAdminRoutes` под существующей admin-авторизацией +
  rate-limit middleware.

### Фронт
- `frontend/src/features/admin/api.ts` — `BinanceTickerInfo` и
  `apiGetBinanceTickerInfo(symbol)` через общий `request()`.
- `frontend/src/components/AdminPanel.tsx` (TickerBlock) — добавлены
  state `binanceLoading`/`binanceNote` и `handleFetchBinance()`. Кнопка
  «Подтянуть» рядом с полем «Символ», disabled когда поле пустое или
  идёт запрос. После успеха поля Tick Spot/Futures проставляются только
  для рынков, где `*Found=true`; для не найденных — короткое сообщение
  под полем «Символ». Поля Tick Spot/Tick Futures остались редактируемыми.
- `frontend/src/i18n/dictionaries/{ru,en,kz}.ts` — добавлены три ключа в
  `admin.database`: `binanceFetch` (Подтянуть / Fetch / Тарту),
  `binanceNotFound` (не найдено на Binance / not found on Binance /
  Binance-те табылмады), `binanceFetchError` (Ошибка запроса к Binance /
  Binance request failed / Binance сұранысы сәтсіз аяқталды).

### Файлы
- `backend/internal/binance/exchangeinfo.go` (new)
- `backend/internal/admin/handlers.go`
- `frontend/src/features/admin/api.ts`
- `frontend/src/components/AdminPanel.tsx`
- `frontend/src/i18n/dictionaries/ru.ts`
- `frontend/src/i18n/dictionaries/en.ts`
- `frontend/src/i18n/dictionaries/kz.ts`

### Verification
- `go build -o procluster.exe ./cmd/procluster/` — успех (без ошибок).
- `go vet ./...` — без замечаний.
- `npx tsc --noEmit` — без ошибок.
- `npx vite build` — успех (2933 modules, 820ms).
- Прямой probe пакета binance (через временный build-tag тест):
  `SOLUSDT → spotTick=0.01, futuresTick=0.01` (оба found),
  `BTCUSDT → spotTick=0.01, futuresTick=0.1` (оба found),
  `FAKEUSDT → spotFound=false, futuresFound=false`. Запрос через
  локальный прокси юзера прошёл — гео-блок не упёрся.
- Маршрут `/api/v1/admin/tickers/binance-info` зарегистрирован: запрос
  без admin-cookie возвращает 401 (auth-middleware), что подтверждает
  routing+wrap; несуществующий путь даёт 404.
- procluster.exe перезапущен и остановлен — юзер запускает свою копию
  вручную.

### TODO
- Ручная проверка в браузере: ввести «SOLUSDT» → «Подтянуть» → поля
  Tick Spot=0.01 / Tick Futures=0.01 подставились; ввести «FAKEUSDT» →
  поля без изменений + жёлтое сообщение «не найдено на Binance».
- Опционально (не делал в этой задаче): такая же кнопка в форме
  редактирования тикера и in-memory кэш по symbol с коротким TTL.

---

## 2026-06-26 — Индикатор RSI (подвальная панель, только фронтенд)

Добавлен индикатор RSI (Relative Strength Index) как ПОДВАЛЬНЫЙ — отдельная
панель под графиком со своей фиксированной шкалой 0–100 (аналог Tiger Trade /
ATAS). Стопкой под панелями Delta и CVD. Бэкенд не трогали — RSI считается на
фронте из close-цен свечей по классической формуле Уайлдера.

### Что сделано
- Новый модуль индикатора `rsi.ts`: `calculateRSI(closes, period)` — SMA-сид по
  первым `period` изменениям, далее сглаживание Уайлдера
  `avg = (prevAvg*(p-1)+cur)/p`; `RSI = 100 − 100/(1+avgGain/avgLoss)`,
  `avgLoss==0 → 100`; `null` для индексов с данными < period+1 (не рисуются).
  Дефолты: период 14, цвет линии `#a855f7`, цвет зоны `#64748b`,
  прозрачность зоны 12%. `type: "Подвальный"`, `isActiveDefault: false`.
- Реестр `indicators/index.ts` — RSI добавлен в `MODULAR_INDICATORS` +
  реэкспорт. Активация и гидрация (`hydrateIndicators` / `computeActiveIndicators`)
  подхватывают RSI автоматически — `activeIndicators.rsi` доходит до ClusterChart
  как у cvd, отдельный код активации не нужен.
- `types.ts` — в `IndicatorSettings` добавлены `rsiPeriod / rsiLineColor /
  rsiZoneColor / rsiZoneOpacity`.
- `ClusterChart.tsx` — новая RSI-панель по паттерну Delta/CVD:
  * state `rsiPanelHeight` (storage-ключ `procluster_rsi_panel_height`,
    дефолт 120) + сохранение; `resizingPanel` расширен до `"rsi"`.
  * высоты: `rsiHeightTotal`, вычет из `chartHeight`, `rsiTopY` под CVD,
    `totalSvgHeight += rsiHeightTotal` (ось времени не уезжает).
  * мемоизация: `rsiValues` (`calculateRSI` по close ВСЕХ свечей — корректный
    старт периода после backfill) + `rsiPoints` (привязка X к центру свечи,
    как у CVD).
  * рендер на canvas: clip по зоне панели, фикс-шкала `getRsiY(v)=H-(v/100)*H`
    (без автоскейла и Y-зума), заливка зоны 30–70 цветом zoneColor с alpha из
    opacity, пунктиры 70/30 + тонкий 50, линия RSI 1.5px (null рвут путь).
  * SVG: группа `rsi-panel-ticks` (метки 100/70/50/30/0), разделитель над
    RSI-панелью, drag-делитель `setResizingPanel("rsi")`.
- `IndicatorsModal.tsx` — блок `selectedIndicator.id === "rsi"`: период
  (number 2–50), цвет линии (color), цвет зоны (color), прозрачность зоны
  (range 0–100). Стиль контейнера как у блока CVD. Лейблы через `t()` с
  RU-фоллбэком.
- i18n `ru/en/kz.ts` — ключи `indicators.rsiSettings.{title,period,lineColor,
  zoneColor,zoneOpacity}` + `indicators.rsi`.

### Файлы
- `frontend/src/chart2d/indicators/rsi.ts` (new)
- `frontend/src/chart2d/indicators/index.ts`
- `frontend/src/chart2d/types.ts`
- `frontend/src/chart2d/ClusterChart.tsx`
- `frontend/src/components/IndicatorsModal.tsx`
- `frontend/src/i18n/dictionaries/ru.ts`
- `frontend/src/i18n/dictionaries/en.ts`
- `frontend/src/i18n/dictionaries/kz.ts`

### Verification
- `npx tsc --noEmit` — без ошибок (поправил `noUncheckedIndexedAccess`:
  `closes[i]!`).
- `npx vite build` — успех (2933 modules, 650ms).
- Браузер (Playwright, гость, BTCUSDT futures 1m):
  * RSI включается → панель под графиком, шкала 0–100, фиолетовая линия,
    закрашенная зона 30–70, пунктиры. Линия выровнена по центрам свечей.
  * период 14 → плавно, период 7 → линия заметно «дёрганее» — пересчёт
    работает.
  * смена цвета линии (cyan) / цвета зоны (amber) / прозрачности (35%) —
    применяется после reload.
  * F5 (гость) → RSI активен, настройки и высота панели сохранились
    (localStorage `procluster_indicators_v3` + `procluster_rsi_panel_height`).
  * кейс «только RSI» (Delta+CVD off) → панель садится прямо под графиком,
    ось времени на месте.
  * Delta+CVD+RSI вместе → три панели стопкой не наезжают, разделители и
    таймлайн на месте.
  * скрины до/после сделаны.
- В консоли только `401 /api/v1/auth/refresh` (гость не залогинен) — к RSI
  отношения не имеет, RSI-ошибок нет.
- procluster.exe и vite НЕ трогал — оба уже были запущены пользователем,
  ничего не стартовал и не останавливал.

### TODO / наблюдения
- (п.3) Touch-ресайз делителя RSI НЕ добавлен — у делителей Delta/CVD тоже
  только `onMouseDown`, без `onTouchStart`. Сделано консистентно (mouse-only).
  Если решим добавлять тач-ресайз — добавлять сразу всем трём панелям.
- (п.4) `rsiValues` пересчитывается по всей истории при росте `candles`
  (backfill). На текущей истории лага не заметил; при очень длинной истории
  возможна оптимизация (инкрементальный пересчёт) — пока НЕ делал.
- Залогиненная персистенция отдельно не проверялась (нужны креды) — механизм
  общий `StoredIndicator` (сервер для авторизованных + LS для гостей), гость
  подтверждён. Ручная проверка под логином — на пользователе.
- Гостевой тариф `maxIndicators: 6`: в каталоге теперь 7 модульных
  индикаторов. Это существующий тарифный гейт (не сломан) — RSI включается,
  если активных < 6. На заметку при тестах под разными тарифами.

---

## 2026-06-27 — Подвальные панели: плашка RSI, копирайт над подвалами, переупорядочивание стрелками

Три бага по подвальным панелям (Delta/CVD/RSI) во
`frontend/src/chart2d/ClusterChart.tsx`. Бэкенд не трогали.

### Баг 1 — копирайт/логотип залезал на подвалы
Логотип-оверлей (`<img>` procluster_logo) позиционировался по
`bottom: margin.bottom + deltaHeightTotal + cvdHeightTotal + 26` — НЕ учитывал
высоту RSI-панели, поэтому при активном RSI падал внутрь подвалов. Исправлено
на `bottom: margin.bottom + panelsHeightTotal + 26` (сумма по всем активным
подвалам) → логотип всегда в правом-нижнем углу ОСНОВНОГО графика, над панелями.
Текстовый watermark («PROCLUSTER» + «SYMBOL•MARKET•TF») уже центрировался по
`margin.top + chartHeight/2` (chartHeight panel-aware) — в зоне графика, ок.

### Баг 2 — у RSI не было плашки
Раньше плашки Delta и CVD были захардкожены двумя отдельными блоками, у RSI
плашки не было. Отрефакторено: плашки рендерятся ЕДИНЫМ циклом по `activePanels`
(см. баг 3). RSI получил такую же плашку: цветная точка = `rsiLineColor`, текст
«(PROCLUSTER) RSI», значение (текущий RSI под курсором через `rsiValueSpanRef`,
иначе «--»), кнопки глаз/настройки/удалить с id «rsi». Добавлен `rsiValueSpanRef`
и ветка в `updateCrosshairDom` (+параметр `rsiPoint`), значение пишется
императивно как у delta/cvd.

### Баг 3 — порядок панелей стрелками (главное)
Жёсткий порядок Delta→CVD→RSI заменён на динамический:
- `REORDERABLE_PANEL_IDS = ['delta','cvd','rsi']` (модульная конст).
- State `panelOrder: string[]`, персист в LS `procluster_panel_order`, дефолт
  `['delta','cvd','rsi']`.
- useEffect: новый активный подвал, которого нет в `panelOrder`, дописывается
  В КОНЕЦ (последняя включённая — ниже всех). Выключенные id остаются в массиве.
- `activePanels = panelOrder.filter(id => activeIndicators[id])`.
- `getPanelHeight(id)` → delta/cvd/rsi height.
- ЕДИНЫЙ расчёт позиций: цикл по `activePanels` строит `panelTopY[id]`,
  `panelsHeightTotal`, `chartHeight` (вычитает сумму height+gap по activePanels),
  `totalSvgHeight`. Старые `deltaTopY/cvdTopY/rsiTopY` оставлены как алиасы
  `panelTopY[id] ?? 0` — чтобы guard-ленный код панелей/тиков/resize не менять.
- `movePanel(id, dir)`: swap с видимым соседом в `panelOrder`, клампится на краях,
  пишет в LS. Стрелки ChevronUp/ChevronDown на каждой плашке; верхняя ↑ disabled,
  нижняя ↓ disabled.
- Order-зависимые места переведены на panelTopY/activePanels: canvas-разделители
  (между графиком и панелями + между панелями), SVG-разделители, hit-test
  перетаскивания шкалы delta/cvd (`inPanelZone(id)` вместо `clickY<cvdTopY`),
  логотип. SVG-тики и resize-делители работают через алиасы.
- `panelOrder` добавлен в deps draw-замыкания (useLayoutEffect), иначе перестановка
  равновысоких панелей не перерисовывала canvas (totalSvgHeight не менялся).

### Файлы
- `frontend/src/chart2d/ClusterChart.tsx`

### Verification
- `npx tsc --noEmit` ✓, `npx vite build` ✓ (2933 modules, 639ms).
- Браузер (Playwright, гость, BTCUSDT futures 1m):
  * 3 панели (Delta/CVD/RSI) — у всех плашка с точкой+лейблом+значением+кнопками,
    включая стрелки ↑↓.
  * Логотип над панелями (правый-нижний угол графика), не залезает на подвалы —
    проверено при 1 и 3 активных панелях.
  * ↑ на плашке RSI поднял его над CVD: порядок стал Delta→RSI→CVD, контент
    canvas (осциллятор/линии) поехал вместе с плашками — позиционирование верное.
  * Клампинг: верх (Delta) ↑ disabled, низ (CVD) ↓ disabled, середина (RSI) обе.
  * `procluster_panel_order` = `["delta","rsi","cvd"]` записан; пережил F5.
  * Повторная активация всех трёх → рендерятся в сохранённом порядке
    Delta→RSI→CVD (не дефолтный), значит persist уважается.
  * Кейс «только RSI» — панель под графиком, ось времени на месте.
  * Консоль: только `401 /auth/refresh` (гость), panel/RSI-ошибок нет.
- procluster.exe / vite НЕ трогал — запущены пользователем.

### TODO / наблюдения
- Тач-ресайз делителей по-прежнему отсутствует у всех панелей (только
  `onMouseDown`) — консистентно, как было. Стрелки переупорядочивания работают
  и на тач (обычный `onClick`).
- Гостевая персистенция АКТИВНОСТИ индикаторов (какие включены) — отдельная
  существующая система (`procluster_indicators_v3`); при перезагрузке гость может
  получать админ-дефолты. Это не относится к этой задаче. `panel_order` — моё
  новое хранилище — персистится корректно.
- Залогиненная проверка переупорядочивания — на пользователе (механизм LS общий).

---

## 2026-06-27 — Порядок подвальных панелей по активации (вместо хардкода)

Дефолт `panelOrder` был захардкожен `['delta','cvd','rsi']` → порядок включения
игнорировался, RSI всегда внизу. Теперь порядок = по порядку ВКЛЮЧЕНИЯ панелей.

### Изменение
`frontend/src/chart2d/ClusterChart.tsx` — дефолт `panelOrder` сделан ПУСТЫМ
(`[]`) вместо `[...REORDERABLE_PANEL_IDS]`. Если в LS уже есть сохранённый
`procluster_panel_order` — используется он (существующие юзеры не теряют
расстановку). Эффект-дописывания активных id в конец `panelOrder` уже был и не
менялся: при включении индикатора его id добавляется в конец (последний
включённый — ниже всех). На первом маунте, когда несколько подвалов активны из
сохранённого preset, они досеиваются в стабильном порядке `REORDERABLE_PANEL_IDS`
(= порядок каталога delta/cvd/rsi) — разовый старт, дальше работает порядок
активации. Стрелки, `panelTopY`, плашки — без изменений.

### Guard-аудит `panelTopY[id] ?? 0` (по запросу)
Проверены ВСЕ места, где раньше были `deltaTopY/cvdTopY/rsiTopY` (теперь алиасы
`panelTopY[id] ?? 0`) — каждое загейчено `activeIndicators[id]`, поэтому фолбэк
`?? 0` НИКОГДА не приводит к рисованию неактивной панели в `y=0` наверху графика:
- canvas-рендер панелей: `if (activeIndicators.delta)` / `…cvd` / `…rsi`;
- SVG-тики: `{activeIndicators.delta && …}` / cvd / rsi;
- resize-делители (плашки drag): `{activeIndicators.delta && …}` / cvd / rsi;
- resize-handler (`deltaBottomY=deltaTopY+…`): загейчен `resizingPanel===id`
  (делитель рендерится только при активной панели);
- canvas- и SVG-разделители: цикл по `activePanels` / `activePanels.slice(1)`;
- hit-test перетаскивания шкалы: явная проверка
  `activeIndicators[id] && panelTopY[id] != null`;
- плашки: `activePanels.map`; логотип: `panelsHeightTotal`.
Незагейченных мест НЕ найдено — правок guard не потребовалось.

### Файлы
- `frontend/src/chart2d/ClusterChart.tsx`

### Verification
- `npx tsc --noEmit` ✓, `npx vite build` ✓.
- Браузер (Playwright, гость): очистил `procluster_panel_order`, включил подвалы
  в порядке RSI → Delta → CVD → рендер сверху-вниз RSI→Delta→CVD,
  `procluster_panel_order` = `["rsi","delta","cvd"]`. Порядок активации
  соблюдается (раньше было бы delta→cvd→rsi).
- procluster.exe / vite НЕ трогал — запущены пользователем.

## 2026-06-27 — Заводские дефолты индикаторов (Cluster Search / Volume on Chart / Stacked Imbalance)

Обновлены code-level `defaultSettings` (значения при первом добавлении индикатора).
НЕ админские дефолты (`admin_indicator_defaults` / Admin Panel / бэкенд не трогали).

### Изменения
- **Cluster Search** (`clusterSearch.ts`): `csMergeLevels` 1→3;
  средний — `csMedMinSize` 4→10, `csMedMaxSize` 12→20, `csMedColorAsk` →#14ad1f,
  `csMedColorBid` →#e22828; крупный — `csLargeMinSize` 10→15, `csLargeMaxSize` 20→30,
  `csLargeShape` rhombus→square, `csLargeColorAsk` →#14ad1f, `csLargeColorBid` →#e22828.
- **Volume on Chart** (`volumeOnChart.ts`): `opacity` 0.4→0.9, `volumeOnChartMaxHeightPercent` 20→15.
- **Stacked Imbalance** (`stackedImbalance.ts`): `siLineWidth` 2→1.

### Файлы
- `frontend/src/chart2d/indicators/clusterSearch.ts`
- `frontend/src/chart2d/indicators/volumeOnChart.ts`
- `frontend/src/chart2d/indicators/stackedImbalance.ts`

### Verification
- `npx tsc --noEmit` ✓ (только фронт, бэкенд не пересобирался).
- Коммит `965c743`, запушен в `main`.

### TODO
- Деплой на VPS (ручной: `/root/test-v2/deploy.sh` на сервере).
- Проверить в UI у чистого юзера (сброс localStorage) что дефолты подставляются.

## 2026-06-27 — Фикс: GET /api/v1/user/settings отдавал 500

### Симптом
Красный `settings` (500, `{"code":"INTERNAL"}`) в Network у залогиненного юзера на проде.

### Корень
`user_settings.updated_at` — колонка TEXT, но `UpsertUserSettings` писал сырой
`time.Time`, а `GetUserSettings` сканировал его обратно в `time.Time`. Драйвер
`modernc.org/sqlite` отдаёт TEXT строкой, `database/sql` не умеет конвертить
`string → time.Time` при Scan → ошибка → 500. Падало у каждого юзера, у кого
есть строка настроек (без строки → ErrNoRows → 200 `{}`). PUT работал (без
scan-back), поэтому настройки сохранялись, но GET падал — фронт молча откатывался
на localStorage, виден был только красный 500.

### Фикс
Приведено к конвенции проекта (`scanUser`): пишем `time.Now().UTC().Format(time.RFC3339)`,
читаем `updated_at` в `string` + `time.Parse` (парс legacy-строк не критичен, `_`).
Legacy-строки на проде теперь читаются без ошибки.

### Файлы
- `backend/internal/auth/user_settings.go`
- `backend/internal/auth/user_settings_test.go` (новый, `TestUserSettingsRoundTrip`)

### Verification
- `TestUserSettingsRoundTrip`: падал до фикса (точная ошибка
  `unsupported Scan ... string into type *time.Time`), зелёный после.
- `go build` ✓. Прочие падения в пакете auth (`Indicator*`,
  `CUSTOM_SETTINGS_FORBIDDEN`) — пре-existing на ветке tier-policies, не связаны.
- Коммит `93d1dcc`, запушен в `main`.

### TODO
- Деплой на VPS (ручной: `bash /root/test-v2/deploy.sh`).
- Проверить на проде: `settings` = 200, настройки тянутся с сервера (не из LS).

## [2026-06-28] feat(indicators): подвал «Buy/Sell Zone» — композитный осциллятор 0..100 (MVP)

### Контекст
Порт TradingView «PROCLUSTER BUY SELL zone» (без Bybit). Чисто фронт, бэкенд не трогали.
MVP: линия композита + коридор баланса + динамическая заливка перегрева. БЕЗ дивергенции,
меток BUY/SELL и алертов (фаза 2).

### Композит (per candle)
Каждый из 4 компонентов нормируется в 0..100, затем взвешенное среднее ТОЛЬКО по доступным
(знаменатель = сумма весов доступных, renormalize):
- `lsScore = 100 − zToScale(lsr, lsZlen)` (инверсия long/short)
- `rsiScore = RSI(close, rsiLen)` (reuse `rsiIndicator.calculateRSI`)
- `macdScore = zToScale(macdHist(close), macdZlen)`
- `barScore = 50·(1 + r)`, r = bid/ask band (r1/r3/r5) ∈ −1..+1, линейно
Недоступный компонент исключается; 0 доступных → null (линия рвётся).
`zToScale`: SMA/STDEV по окну последних `len` валидных значений (sparse-aware), z=(src−m)/sd,
zc=clamp(z/3,−1,1) → 50·(1+zc); null при нехватке истории или sd=0.

### Источники
`fetchLongShortRatio` + `fetchBookDepthRatio` — оба фетча триггерятся когда активен buySellZone
(futures only), независимо от longShortRatio/bidAskRatio. RSI/MACD — из свечей.
Spot: панель «Только futures», линия не рисуется.

### Файлы
- `frontend/src/chart2d/indicators/math.ts` (новый) — sma/stdev/ema/macdHist/zToScale (null-aware).
- `frontend/src/chart2d/indicators/buySellZone.ts` (новый) — IndicatorModule + дефолты.
- `frontend/src/chart2d/indicators/index.ts` — регистрация.
- `frontend/src/chart2d/types.ts` — `bsZone*` в IndicatorSettings.
- `frontend/src/chart2d/ClusterChart.tsx` — расчёт композита, getBsZoneY, fetch-гейты, draw loop,
  scale/offset/resize/zoom/ticks/legend/handle (паттерн как longShortRatio + RSI-коридор).
- `frontend/src/components/IndicatorsModal.tsx` — панель настроек.

### Verification
- `npx tsc --noEmit` ✓ (exit 0)
- `npx vite build` ✓ (642 ms, exit 0)

### TODO (фаза 2)
- Дивергенция (pivot high/low) + метки BUY/SELL + подсветка фона графика.
- Алерты (Telegram).
- Spot-вариант композита (только RSI+MACD).
- Опционально: значение композита в crosshair-легенду подвала.

### [2026-06-28] fix(buySellZone): инверсия направления bid/ask
`barScore = 50·(1 − r)` вместо `(1 + r)`: перевес бидов тянет линию ВНИЗ (buy/лонг, зелёная), перевес асков — ВВЕРХ (sell/шорт, красная). `frontend/src/chart2d/ClusterChart.tsx`. tsc ✓, vite ✓.

### [2026-06-28] feat(buySellZone): настройка яркости зон + бейджи LONG/SHORT
Захардкоженный `overOp 0.16` → настройка `bsZoneOverOpacity` (0..100, дефолт 30, один слайдер на обе зоны). Бейджи LONG/SHORT — одна liquid-glass пилюля на непрерывный участок захода линии за канал, в экстремуме (SHORT=макс над линией, LONG=мин под линией), тогл `bsZoneShowBadges` (дефолт on). `ClusterChart.tsx`, `indicators/buySellZone.ts`, `chart2d/types.ts`, `IndicatorsModal.tsx`. tsc ✓, vite ✓.

### [2026-06-28] feat(buySellZone): тень текста бейджей LONG/SHORT
Под текстом пилюль LONG/SHORT — drop shadow (rgba(0,0,0,0.55), blur 2, offsetY 1) ТОЛЬКО на тексте; фон/highlight-штрих без тени, тень сбрасывается сразу после fillText (не течёт на остальной рендер). Тогл bsZoneShowBadges проверен — гейтит отрисовку. `ClusterChart.tsx`. tsc ✓, vite ✓.

### [2026-06-28] fix(buySellZone): бейджи по порогам перегрева (80/20), не по коридору
Группировка бейджей: `v > bsZoneOverUp`/`v < bsZoneOverDown` вместо balUp/balDown. SHORT только выше 80, LONG ниже 20; в коридоре и слабой зоне 20–35/65–80 бейджа нет. Заливка зон (balUp/balDown) не тронута. `ClusterChart.tsx`. tsc ✓, vite ✓.

### [2026-06-28] fix(aggregation): UTC-выравнивание 4h/1d — bid/ask и long/short на старших ТФ
Bid&Ask / Long&Short были пусты на 4h/1d. Причина: live-агрегатор кладёт `trade.Time` из `time.UnixMilli` (= `time.Local`), и ветки 4h/1d в `AlignToTimeframe` выравнивали по локальным границам (MSK), а read-путь индикаторов (CH→clickhouse-go = UTC) бакетил по UTC → `t` не совпадал с `candle.timestamp`. Подтверждено данными: candle_open 4h = 21/01/05 UTC (MSK), индикатор = 00/04/08 UTC. Фикс: `t = t.UTC()` в начале `AlignToTimeframe` (`internal/aggregation/rollup.go`) — write-путь теперь UTC, read/backfill — no-op, прод (UTC-сервер) не затронут. go vet ✓, go build ✓. Визуал проверяет юзер локально (свой proxy); старые MSK-свечи 4h/1d на dev желательно очистить/пере-бэкфилльнуть.

### [2026-06-28] fix(chart): подвалы используют полную высоту панели до разделителя
Убрана мёртвая полоса сверху/снизу в подвальных индикаторах: поля Y-маппинга 10%/8% → 2%. getCvdY и getLsrY (`0.8/0.1` → `0.96/0.02`), ratioYInPanel (`half 0.42` → `0.48`), delta-гистограмма (`maxBarScaledHeight 0.45` → `0.48`). SVG-подписи min/max delta/cvd/longShort синхронизированы (`0.1/0.9` → `0.02/0.98`); rsi/bidAsk/buySellZone тики через хелперы — подтянулись сами. clip/offset/zoom не тронуты. `ClusterChart.tsx`. tsc ✓, vite ✓.

### [2026-06-28] fix(chart): убрать мёртвую полосу под разделителем подвалов (контент флэш к разделителю)
Зазор panelGap перенесён НАД разделитель: первая панель теперь flush к границе графика (panelTopY[0]=margin.top+chartHeight, без ведущего gap'а), остальные — gap только между панелями. panelsHeightTotal = ΣH + gap·(n−1) (был ΣH + gap·n) — согласован с раскладкой. Межпанельные разделители (canvas + SVG) сдвинуты с `panelTopY−gap/2` на `panelTopY`; ресайз-ручки 6 подвалов — туда же. Первый разделитель, clip, offset/zoom, value-инсет 2% не тронуты. `ClusterChart.tsx`. tsc ✓, vite ✓.

### [2026-06-28] fix(chart): panelGap=0 — контент подвалов флэш к разделителю сверху и снизу
Прошлый фикс лишь переместил пустой panelGap из-под верха панели под её низ. Теперь panelGap=24→0: разделитель ровно на границе соседних панелей, контент обеих прижат к нему (тонкое «дыхание» даёт value-инсет 2%). panelsHeightTotal и panelTopY-цикл уже на panelGap-переменной → при 0 оба = ΣH, бюджет согласован. Ресайз-ручки 6 подвалов уменьшены 14→8px (translateY −7→−4), седлают разделитель, ресайз работает. `ClusterChart.tsx`. tsc ✓, vite ✓.

### [2026-06-28] feat(tiers): per-tier гейт индикаторов (Фаза 1 бэкенд) — Buy/Sell Zone по умолчанию только admin
Тариф может скрывать произвольные индикаторы по id. Дефолт: `buySellZone` скрыт у guest/free/pro/vip, виден только admin. Прочие индикаторы — всем.
- **Схема** (`internal/auth/sqlite.go`): новая колонка `tier_policies.gated_indicators TEXT NOT NULL DEFAULT '[]'` через идемпотентный ALTER-паттерн (как остальные tier-поля). Одноразовый бэкфилл ТОЛЬКО при создании колонки: `UPDATE … SET gated_indicators='["buySellZone"]' WHERE tier IN ('guest','free','pro','vip')` (admin остаётся `[]`).
- **Сид/чтение/запись** (`internal/admin/tier_policies.go`): поле `GatedIndicators []string` (json `gatedIndicators`); defaultTierPolicies — guest/free/pro/vip=`["buySellZone"]`, admin=`[]`; INSERT-сид, GetPolicies (читает колонку, nil/''→[]), UpsertPolicies (пишет, nil→[]). Хелпер `parseGatedIndicators`.
- **Энфорсмент** (`internal/auth/indicators_handlers.go`): хелпер `getGatedIndicatorsForRole(role)` + `filterGatedIndicators`. GET `/user/indicators` — вырезает gated-индикаторы из резолва (при понижении тарифа индикатор пропадает; до подсчёта overflow). PUT `/user/indicators` (replace/merge-add) — молча отбрасывает gated из входящего набора (не 403). Propagate — gated id молча no-op (OK).
- **`/user/limits`** (`internal/auth/handlers.go`): в ответ добавлено `gatedIndicators: string[]` тарифа текущего юзера (аноним → guest). Fallback при пустой таблице: non-admin=`["buySellZone"]`, admin=`[]`.
- **Админка** (`internal/admin/handlers.go`): GET `/admin/policies` отдаёт `gatedIndicators` (через GetPolicies); PUT принимает (decode по json-тегу), валидация — массив строк, id не против каталога (бэк его не знает), лимиты: ≤200 шт, каждый non-empty ≤64.
- **НЕ трогали**: данные-эндпоинты `/bookdepth-ratio`, `/long-short-ratio` (гейт только на уровне конфигурации индикаторов); max_indicators и прочий enforcement.

**Verification:** `go vet ./internal/auth/ ./internal/admin/` ✓ (чисто); `go build -o procluster.exe ./cmd/procluster/` ✓ (rc=0). Старт: `[auth] sqlite migrations applied` без ошибок (миграция на dev-БД прошла; порт 8080 держал рабочий бэкенд юзера — мой процесс убит). Прямой SELECT по реальной БД после миграции: колонка есть; admin=`[]`, guest/free/pro/vip=`["buySellZone"]`. `go test ./internal/admin/` ✓ (ok). `go test ./internal/auth/` — 6 падений (TestIndicators_*), все `CUSTOM_SETTINGS_FORBIDDEN` 403 на входном тариф-гейте PUT, ДО нового кода; baseline без правок (git stash) — те же 6 → новых падений не добавлено (известный красный, см. deferred_indicator_tests). Curl `/admin/policies` и `/user/limits` под admin-токеном НЕ выполнен (порт 8080 занят рабочим бэкендом юзера; перехват нарушил бы lifecycle) — проверяется юзером после рестарта с новым бинарником.

**TODO (Фаза 2, фронт):** прятать gated-индикаторы в IndicatorsModal по `gatedIndicators` из `/user/limits`; чекбоксы gated в админ-панели policies.

### [2026-06-28] feat(tiers): per-tier гейт индикаторов (Фаза 2 фронт) — скрытие в каталоге + чекбоксы в админке
Фронт читает `gatedIndicators` из `/user/limits` и прячет gated-индикаторы; админка управляет gated чекбоксами по тарифам. Чисто фронт.
- **Типы** (`features/auth/api.ts` UserLimits, `contexts/LimitsContext.tsx` DEFAULT_LIMITS=[], `features/admin/api.ts` TierPolicy): добавлено поле `gatedIndicators: string[]`. Маппинг — спред raw JSON через `request<>`, поле проходит само.
- **Каталог user-facing** (`components/IndicatorsModal.tsx`): `gatedIds = limits.gatedIndicators`; фильтр в сиде из `MODULAR_INDICATORS` (gated не попадает в драфт) И в `getAccordionIndicators` (защита от стейла). Admin (gatedIndicators=[]) видит всё.
- **Защита рендера** (`chart2d/ClusterChart.tsx`): новый проп `gatedIndicators?: string[]`; shadow-фильтр `indicators` через useMemo на входе → все потребители (settings map, overlay legend, подвалы) видят отфильтрованный набор. Прокинут через `ClusterChartAdapter.tsx` (проп + forward) из `ChartContainer2.tsx` (`limits.gatedIndicators`). Preview без провайдера лимитов не падает (проп опционален, дефолт []).
- **Админка** (`components/AdminPanel.tsx`, TierPoliciesBlock): импорт `MODULAR_INDICATORS`; карточка «9. Доступные индикаторы» (full-width, чекбоксы по эталону остальных полей тарифа) — галка=доступен, снята=скрыт (id в gatedIndicators). Хелпер `toggleGated`; сохранение через существующий `apiUpdatePolicies` (Save All). Подпись: «Снятая галка — индикатор скрыт для этого тарифа.»

**Verification:** `npx tsc --noEmit` ✓ (exit 0); `npx vite build` ✓ (exit 0, 522ms; chunk-size warning — пред­существующий, не ошибка). Логику (Buy/Sell Zone скрыт у free/pro, виден у admin; снятие/постановка галки в админке) юзер проверяет в браузере после рестарта бэка.

### [2026-06-29] chore(header): убран легаси FPS-счётчик из шапки приложения
Иконка-молния + «0» справа в ChartHeader (всегда показывала 0) удалена. Чисто фронт, хирургически.
- **`components/ChartHeader.tsx`**: удалён блок `{/* FPS counter */}` (div с `<Zap/>` + `<span>{fps}</span>`); импорт `Zap` из lucide-react убран (grep подтвердил — использовался только тут); проп `fps?: number` снят из `ChartHeaderProps` и из деструктуризации параметров.
- **`App.tsx`**: убрана передача `fps={fps}` в `<ChartHeader>`. Стейт `const [fps, setFps]` → `const [, setFps]` (getter осиротел по tsc TS6133; `setFps` жив — идёт легаси-движку через `onFpsChange={handleFpsChange}`).
- **НЕ трогали** (по запрету): админский FPS-бейдж внутри графика `chart2d/ClusterChart.tsx` (fpsDisplay) — остаётся; легаси-движок Renderer.ts/ChartPanel.tsx/ChartContainer.tsx и его FPS-обвязку — не вычищали, только осиротевший getter в App.tsx.

**Verification:** `npx tsc --noEmit` ✓ (exit 0; первый прогон поймал TS6133 на `fps`, после правки чисто); `npx vite build` ✓ (exit 0, 698ms; chunk-size warning — пред­существующий). Визуально (молния с «0» под профилем исчезла, остальная шапка цела) юзер проверяет в браузере: `cd frontend; npm run dev`.

### [2026-06-29] style(split): скруглена жёлтая рамка активного окна в режиме «2 графика»
Рамка выделения активного слота была прямоугольной (острые углы), окно графика — `rounded-2xl`. Подогнал рамку под радиус окна. Чисто фронт, хирургически.
- **`App.tsx`**: в 4 wrapper-div активного слота (горизонт. слот 0/1, вертик. слот 0/1) в базовую часть className добавлен `rounded-2xl` рядом с `overflow-hidden border-2`. Радиус применяется всегда — и к активной жёлтой рамке (`border-yellow-500/50`), и к прозрачной неактивной. Бейдж «Активен» и логику `activeSlot` не трогал.

**Verification:** `npx tsc --noEmit` ✓ (exit 0); `npx vite build` ✓ (built in 666ms; chunk-size warning — пред­существующий). Визуально (рамка активного окна в горизонт. и вертик. сплите скруглена, совпадает с углами графика) юзер проверяет в браузере: `cd frontend; npm run dev`.

### [2026-06-29] feat(admin): детализация пропусков покрытия — раскрытие диапазонов по клику
Столбец «Пропусков» в блоке «Покрытие данных» (админка) стал кликабельным: клик по числу раскрывает под строкой конкретные диапазоны дней без данных. Загрузка диапазонов ленивая (отдельный запрос по клику, не для всех строк сразу).
- **Backend `internal/repository/clickhouse/clickhouse.go`**: новый тип `GapRange{From,To,Days}` + метод `GetCoverageGaps(ctx, dataType, symbol, market)`. Таблица/поле времени по dataType из whitelist (switch): clusters→clusters_spot/_futures.candle_open; bookDepth→bookdepth_ratio.snapshot_ts; longShortRatio→long_short_ratio.ts. symbol/market — ТОЛЬКО через параметры `?` (имя таблицы не из польз. ввода). SQL `SELECT DISTINCT toDate(<T>) AS d ... ORDER BY d`; в Go проход по соседним дням, разрыв >1 → диапазон (From=день после пред., To=день перед след., Days=diff-1). Нормализация к UTC-полуночи (без DST-сдвигов). Пустой источник → пустой срез. Сумма Days = MissingDays из coverage.
- **Backend `internal/admin/handlers.go`**: хендлер `handleCoverageGaps` + роут GET `/api/v1/admin/history/coverage/gaps?symbol=&market=&dataType=` (под тем же auth+admin+rate-limit, timeout 15с). Валидация: symbol непустой (upper-case), market∈{spot,futures}, dataType∈{clusters,bookDepth,longShortRatio} иначе 400.
- **Frontend `features/admin/api.ts`**: `interface CoverageGap{from,to,days}` + `apiGetCoverageGaps(symbol,market,dataType)` (query-параметры через URLSearchParams).
- **Frontend `components/AdminPanel.tsx`** (CoverageBlock): число пропусков при missingDays>0 — кнопка (cursor-pointer, стрелка ▸/▾); 0 → «—» некликабельно. Клик toggle раскрытия одной строки (ключ `symbol-market-dataType`); кэш gaps/loading/ошибка по ключу. Раскрытие — доп. `<tr colSpan={7}>` со списком диапазонов «from → to · Nд» (моноширинный, 1–3 колонки по ширине), light/dark темы. Загрузка — «…», ошибка — текст, пусто — «нет пропусков».

**Verification:** `go build -o procluster.exe ./cmd/procluster/` ✓ (exit 0); `npx tsc --noEmit` ✓ (exit 0). Бэкенд не стартовал (порт держит рабочий процесс юзера; lifecycle не нарушаю) — функционал юзер проверяет после рестарта с новым бинарником.

**TODO:** нет.

### [2026-06-29] feat(clickhouse): отключение TTL-автоудаления истории (хранение бессрочно)
TTL у 4 таблиц загружаемой истории отодвинут на 100 лет = данные практически вечны. Новая миграция, идемпотентная.
- **Новый файл `internal/repository/clickhouse/migrations/009_disable_data_ttl.sql`** (стиль 005: чистый SQL, по одному ALTER на строку, без комментариев):
  - `ALTER TABLE clusters_futures MODIFY TTL toDateTime(candle_open) + INTERVAL 100 YEAR;`
  - `ALTER TABLE clusters_spot MODIFY TTL toDateTime(candle_open) + INTERVAL 100 YEAR;`
  - `ALTER TABLE bookdepth_ratio MODIFY TTL toDateTime(snapshot_ts) + INTERVAL 100 YEAR;`
  - `ALTER TABLE long_short_ratio MODIFY TTL toDateTime(ts) + INTERVAL 100 YEAR;`
- **Почему MODIFY TTL, а не REMOVE TTL**: REMOVE при повторном старте бэка (TTL уже убран) → `Code 36: Table doesn't have any table TTL expression` → log.Fatalf. MODIFY на +100 YEAR идемпотентен (exit 0 при повторе). Мигратор (ApplyMigrations) выполняет ВСЕ .sql при каждом старте, без таблицы применённых — идемпотентность обязательна.
- **НЕ трогали**: cluster_cache (TTL 90 дней), clusters_futures_dom (6 мес), clusters_spot_dom (1 год) — TTL осмыслен, оставлен.

**Verification:** `go build -o procluster.exe ./cmd/procluster/` ✓ (exit 0, 009 встроена через embed). Применено на локальной БД (docker exec, procluster): pass1 exit 0, pass2 (имитация 2-го старта) exit 0 — идемпотентность подтверждена. `SHOW CREATE TABLE`: clusters_futures/spot → `TTL toDateTime(candle_open) + toIntervalYear(100)`; bookdepth_ratio → `+ toIntervalYear(100)` от snapshot_ts; long_short_ratio → `+ toIntervalYear(100)` от ts. cluster_cache=toIntervalDay(90), *_dom=toIntervalMonth(6)/toIntervalYear(1) — не изменены. ApplyMigrations (ReadDir сортирует → 009 последняя; splitStatements по `;`, exec по одному) обрабатывает 009 идентично 005. Бэк юзера живёт на :8080 (PID 40288) — 2-й инстанс не поднимал (риск live-процесса/общего SQLite); идемпотентность доказана прямым прогоном тех же стейтментов. Старт с нуля юзер проверит после рестарта.

**TODO:** нет.

### [2026-06-29] fix(clickhouse): КРИТ — TTL 100 YEAR переполнял DateTime (→1988, удалял данные); исправлено на 10 YEAR
Миграция 009 от 100 YEAR давала переполнение: `toDateTime('2025-01-01') + INTERVAL 100 YEAR` = **1988-11-24** (лимит DateTime 2106-02-07, дата заворачивается в прошлое) → TTL просрочен → ClickHouse удаляет данные при merge/OPTIMIZE. На проде история потёрта.
- **`migrations/009_disable_data_ttl.sql`** переписан: `INTERVAL 10 YEAR` (→2035, в пределах DateTime) + `SETTINGS materialize_ttl_after_modify = 0` (MODIFY на каждом старте бэка не форсит пересчёт TTL всех партиций). 4 таблицы: clusters_futures/spot (candle_open), bookdepth_ratio (snapshot_ts), long_short_ratio (ts).
- **Гоча materialize_ttl_after_modify=0**: MODIFY меняет ТОЛЬКО метаданные таблицы; уже существующие парты сохраняют СТАРЫЙ ttl_infos. Если парты были записаны под битым 100yr (ttl=1988), следующий merge/OPTIMIZE удалит их даже после смены TTL на 10yr. Лечение «отравленных» партов — разовый `materialize_ttl_after_modify=1` или `ALTER TABLE MATERIALIZE TTL` (в миграцию НЕ кладём — ApplyMigrations гоняет всё на каждом старте, =1 форсил бы полный пересчёт каждый раз). На проде данные уже потёрты → после редаунлоада новые парты пишутся под 10yr → безопасны.

**Verification:** `go build -o procluster.exe ./cmd/procluster/` ✓ (exit 0). `SELECT toDateTime('2025-01-01') + INTERVAL 100 YEAR` = `1988-11-24` (переполнение подтверждено), `+ INTERVAL 10 YEAR` = `2035-01-01` ✓. Тест на таблице С ДАННЫМИ (3 строки разных дат) точным стейтментом миграции (=0) + OPTIMIZE FINAL → count=3 (не удалены) ✓. Идемпотентность: 4 ALTER MODIFY TTL 10yr дважды → pass1 exit 0, pass2 exit 0 ✓. SHOW CREATE 4 таблиц → `TTL ... + toIntervalYear(10)` ✓. cluster_cache (90д), *_dom (6мес/1год) не тронуты ✓.
- **Локальные данные**: при проверке запустил `OPTIMIZE TABLE ... FINAL` на реальных таблицах с ещё битыми (100yr) партами → старые тест-строки (36/17/4) удалены (тот же баг, воспроизведён локально). Это были отравленные парты (всё равно удалились бы при фоновом merge). Живой бэк юзера (:8080) продолжает писать свежие данные под исправленным 10yr TTL → count растёт (868/458/6), новые данные безопасны.

**Деплой:** ручной (push main + deploy.sh на VPS). После деплоя ApplyMigrations применит 009 (10yr); историю на проде перезалить через админку.

**TODO:** нет.

### [2026-06-30] feat(frontend): дефолт 15m, видимо 500 свечей, TF_LIMIT увеличен
Три точечные правки UI графика (Canvas2D, src/chart2d/). Логика кластеров/батчей не тронута.
- **`frontend/src/contexts/ChartControlsContext.tsx`** — DEFAULT_SLOT: `timeframe: '1m'` → `'15m'` (дефолтный ТФ для новых юзеров; 15m уже в TIMEFRAMES_BY_MARKET для futures/spot).
- **`frontend/src/chart2d/ClusterChart.tsx`** — `VISIBLE_CANDLES`: 100 → 500 (видимая область графика на старте).
- **`frontend/src/chart2d/ClusterChartAdapter.tsx`** — TF_LIMIT увеличен: 1m/5m/15m=1500, 30m=1200, 1h=1000, 4h/1d=800 (больше истории при загрузке).

**Verification:** `npx tsc --noEmit` ✓ (TSC_OK), `npx vite build` ✓ (built in 911ms, только предсуществующее предупреждение о размере чанка >500kB).

**TODO:** нет.

### [2026-06-30] fix(api): кап лимита свечей 500 → 2000
Фронт грузит график с `/api/v1/candles?...&limit=1500`, бэк отвечал 400 "limit must be 1-500" из-за хардкод-капа 500.
- **`backend/internal/api/candles.go`** — проверка лимита: `parsed > 500` → `parsed > 2000`, текст ошибки `"limit must be 1-500"` → `"limit must be 1-2000"`. resolveHistoryDepth и логика тарифов не тронуты.

**Verification:** `go build -o procluster.exe ./cmd/procluster/` ✓ (exit 0, BUILD_OK). Старый procluster.exe (PID 30312) остановлен; новый бинарь юзер запустит сам.

**TODO:** нет.
