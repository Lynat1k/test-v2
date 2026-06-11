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
