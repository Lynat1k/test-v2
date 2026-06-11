# PROCLUSTER

Онлайн-сервис кластерных графиков крипто-активов (аналог mobchart.com, exocharts, ATAS).

Кастомный canvas/WebGL движок графика, футпринт/кластера/японские свечи, стакан DOM, индикаторы, авторизация, тарифы.

## Быстрый старт

```bash
# 1. Установить зависимости
go mod tidy
cd frontend && npm install && cd ..

# 2. Скопировать .env
cp .env.example .env

# 3. Запустить backend
go run ./cmd/procluster

# 4. Запустить frontend (отдельный терминал)
cd frontend && npm run dev
```

## Настройка Git hooks

```bash
git config core.hooksPath .githooks
```

## Окружение разработчика

### Backend (Go)
- Go 1.21+
- gopls (LSP для Go)
- goimports (форматирование)

### Frontend (Node.js)
- Node.js 18+
- npm или yarn
- TypeScript Language Server (встроен в VS Code)

### IDE
- VS Code с расширениями:
  - Go (официальное)
  - ESLint
  - Prettier

## Структура проекта

```
procluster/
├── backend/          # Go backend
│   ├── cmd/          # Точка входа
│   └── internal/     # Бизнес-логика
├── frontend/         # React + TypeScript
├── deploy/           # Docker Compose
├── docs/             # Документация
├── scripts/          # Утилиты
├── .githooks/        # Git hooks
└── .github/          # CI/CD
```

## Документация

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — общая архитектура
- [DATA_MODEL.md](docs/DATA_MODEL.md) — схемы ClickHouse
- [CHART_ENGINE.md](docs/CHART_ENGINE.md) — движок графика
- [ROADMAP.md](docs/ROADMAP.md) — мастер-план фаз
