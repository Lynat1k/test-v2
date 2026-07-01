CREATE TABLE IF NOT EXISTS open_interest (
    symbol LowCardinality(String),
    market LowCardinality(String),
    ts DateTime64(3),
    sum_open_interest Decimal(18,1),
    sum_open_interest_value Decimal(18,1)
) ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (symbol, market, ts)
TTL toDateTime(ts) + INTERVAL 1 YEAR;
