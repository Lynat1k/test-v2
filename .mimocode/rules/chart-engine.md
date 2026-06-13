---
paths:
  - "frontend/src/chart-engine/**"
---
# Chart engine rules (auto-loaded)
- Только типизированные массивы в hot-path, object pool, без аллокаций в render loop.
- Движок НЕ импортирует UI-компоненты напрямую — только через engine.* API/события.
- Цель 60 FPS; перерисовка по dirty-flag, батчинг draw calls.
- Текст — Canvas2D слой; геометрия — WebGL/PixiJS.
- Детали и контракт: docs/CHART_ENGINE.md.
