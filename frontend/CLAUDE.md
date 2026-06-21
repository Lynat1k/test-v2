# frontend/ — правила (React + TypeScript)

## Движок графика (src/chart2d/)
- Canvas2D (PixiJS/WebGL отложен, см. docs/DECISIONS.md). НЕ TradingView Lightweight Charts.
- Файлы: ClusterChart.tsx (рендер/вьюпорт), adapter.ts (данные, aggregateLevels, mergeLiveUpdate),
  ClusterChartAdapter.tsx (мост React↔движок, WS live).
- Live higher-TF и REST должны давать ИДЕНТИЧНЫЕ cells.
  Формула сжатия: Math.floor(PriceLevel/priceStep)*priceStep — бит-в-бит как REST SQL.
- priceStep должен быть свежим при смене сжатия (через ref / пересоздание колбэка).
- Цель плавность ~60 FPS, без лишних аллокаций в render loop.

## Стиль кода
- TypeScript strict. Дизайн-эталон: https://github.com/Lynat1k/PROCLUSTER3
- Палитра свечей: красный/зелёный и белый/тёмно-серый. Темы dark/light. Языки RU/EN.

## После правок
  npx tsc --noEmit
  npx vite build
