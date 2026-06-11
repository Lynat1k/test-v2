CREATE TABLE IF NOT EXISTS clusters_futures (
    symbol         LowCardinality(String),
    timeframe      LowCardinality(String),
    candle_open    DateTime64(3),
    price_level    Decimal(18,2),
    bid_volume     Decimal(18,1),
    ask_volume     Decimal(18,1),
    delta          Decimal(18,1) MATERIALIZED bid_volume - ask_volume,
    total_volume   Decimal(18,1) MATERIALIZED bid_volume + ask_volume,
    compression    UInt16
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(candle_open)
ORDER BY (symbol, timeframe, candle_open, price_level)
TTL candle_open + INTERVAL 1 YEAR;
