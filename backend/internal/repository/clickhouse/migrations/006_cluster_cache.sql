CREATE TABLE IF NOT EXISTS cluster_cache (
    symbol       LowCardinality(String),
    market       LowCardinality(String),
    timeframe    LowCardinality(String),
    candle_open  DateTime64(3),
    price_step   Decimal(18,4),
    price_bucket Decimal(18,2),
    bid_volume   Decimal(38,1),
    ask_volume   Decimal(38,1),
    updated_at   DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(candle_open)
ORDER BY (symbol, market, timeframe, price_step, candle_open, price_bucket)
TTL toDateTime(candle_open) + INTERVAL 90 DAY;
