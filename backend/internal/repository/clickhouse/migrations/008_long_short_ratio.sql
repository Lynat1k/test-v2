CREATE TABLE IF NOT EXISTS long_short_ratio (
    symbol LowCardinality(String),
    market LowCardinality(String),
    ts DateTime64(3),
    ratio Decimal(18,4)
) ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (symbol, market, ts)
TTL toDateTime(ts) + INTERVAL 1 YEAR;
