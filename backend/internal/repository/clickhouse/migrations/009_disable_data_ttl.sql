ALTER TABLE clusters_futures MODIFY TTL toDateTime(candle_open) + INTERVAL 10 YEAR SETTINGS materialize_ttl_after_modify = 0;
ALTER TABLE clusters_spot MODIFY TTL toDateTime(candle_open) + INTERVAL 10 YEAR SETTINGS materialize_ttl_after_modify = 0;
ALTER TABLE bookdepth_ratio MODIFY TTL toDateTime(snapshot_ts) + INTERVAL 10 YEAR SETTINGS materialize_ttl_after_modify = 0;
ALTER TABLE long_short_ratio MODIFY TTL toDateTime(ts) + INTERVAL 10 YEAR SETTINGS materialize_ttl_after_modify = 0;
