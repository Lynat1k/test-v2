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
