CREATE TABLE IF NOT EXISTS clusters_spot_dom (
    symbol       LowCardinality(String),
    snapshot_ts  DateTime64(3),
    price_level  Decimal(18,2),
    bid_size     Decimal(18,1),
    ask_size     Decimal(18,1),
    compression  UInt16
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(snapshot_ts)
ORDER BY (symbol, snapshot_ts, price_level)
TTL toDateTime(snapshot_ts) + INTERVAL 1 YEAR;

