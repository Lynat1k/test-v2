# Technical Decisions & TODOs

## TODO history-on-scroll polish
При очень быстром скролле 1m возможны микро-дёргания priceRange. Сейчас: priceBounds по visible window + freeze во время prepend + timestamp-anchor + force-retrigger у левого края. Допилить плавность (lerp priceRange / троттлинг) позже. Файлы: ClusterChart.tsx (priceBounds, useLayoutEffect anti-jump), ClusterChartAdapter.tsx (handleNeedHistory).
