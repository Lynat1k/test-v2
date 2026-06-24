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

## Знак дельты (delta sign) — ВАЖНО

Backend (ClickHouse) хранит дельту инвертированной относительно общепринятой
конвенции: `TotalDelta = bid_volume - ask_volume` (т.е. SELL − BUY).
Общепринятая конвенция (ATAS / Tiger Trade / футпринт) — `BUY − SELL`.

Нормализация знака выполняется ОДИН раз в `frontend/src/chart2d/adapter.ts`:

    delta: -raw.TotalDelta,   // инвертируем, чтобы знак совпадал с футпринтом

После этой нормализации поле `candle.delta` уже имеет ПРАВИЛЬНЫЙ знак
(положительная дельта = перевес покупок). Все потребители читают именно его.

ПРАВИЛА для новых индикаторов:
- Дельту брать ТОЛЬКО из `candle.delta` (уже нормализована). НЕ читать
  `raw.TotalDelta` напрямую и НЕ инвертировать повторно.
- Если индикатор считает дельту из ячеек футпринта — использовать
  `cell.ask - cell.bid` (BUY − SELL). Так знак совпадёт с `candle.delta`.
- НИКОГДА не добавляй второй минус «для исправления знака» в cvd.ts,
  volumeOnChart.ts, delta.ts или ClusterChart.tsx — источник уже нормализован
  в adapter.ts. Двойная инверсия = баг.

Эталон знака — дельта футпринта. Crosshair, Delta panel, CVD и Volume-on-chart
должны совпадать с ней по знаку.


## После правок
  npx tsc --noEmit
  npx vite build
