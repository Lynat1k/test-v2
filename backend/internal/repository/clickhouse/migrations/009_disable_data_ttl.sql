ALTER TABLE clusters_futures MODIFY TTL toDateTime(candle_open) + INTERVAL 100 YEAR;
ALTER TABLE clusters_spot MODIFY TTL toDateTime(candle_open) + INTERVAL 100 YEAR;
ALTER TABLE bookdepth_ratio MODIFY TTL toDateTime(snapshot_ts) + INTERVAL 100 YEAR;
ALTER TABLE long_short_ratio MODIFY TTL toDateTime(ts) + INTERVAL 100 YEAR;
