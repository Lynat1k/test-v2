ALTER TABLE clusters_futures ADD COLUMN IF NOT EXISTS open_price Decimal(18,2) DEFAULT 0;
ALTER TABLE clusters_futures ADD COLUMN IF NOT EXISTS close_price Decimal(18,2) DEFAULT 0;
ALTER TABLE clusters_spot ADD COLUMN IF NOT EXISTS open_price Decimal(18,2) DEFAULT 0;
ALTER TABLE clusters_spot ADD COLUMN IF NOT EXISTS close_price Decimal(18,2) DEFAULT 0;
