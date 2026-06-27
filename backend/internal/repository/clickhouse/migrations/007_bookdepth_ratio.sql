CREATE TABLE IF NOT EXISTS bookdepth_ratio (
    symbol LowCardinality(String),
    market LowCardinality(String),
    snapshot_ts DateTime64(3),
    bid_1 Decimal(18,1), ask_1 Decimal(18,1),
    bid_3 Decimal(18,1), ask_3 Decimal(18,1),
    bid_5 Decimal(18,1), ask_5 Decimal(18,1)
) ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(snapshot_ts)
ORDER BY (symbol, market, snapshot_ts)
TTL toDateTime(snapshot_ts) + INTERVAL 1 YEAR;
