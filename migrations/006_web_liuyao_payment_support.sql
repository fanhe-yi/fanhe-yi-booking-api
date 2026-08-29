-- ==========================================================
-- migrations/006_web_liuyao_payment_support.sql
--
-- 網頁版六爻 v1：
-- 1) 匿名裝置每日免費限制
-- 2) payment_orders 保存 Web 預約付款上下文
-- 3) liuyao_records 標記來源與 booking 關聯
-- ==========================================================

CREATE TABLE IF NOT EXISTS web_liuyao_usage (
  id             BIGSERIAL PRIMARY KEY,
  visitor_id     TEXT NOT NULL,
  usage_date_tw  DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_liuyao_usage_visitor_day
  ON web_liuyao_usage(visitor_id, usage_date_tw);

CREATE INDEX IF NOT EXISTS idx_web_liuyao_usage_created
  ON web_liuyao_usage(created_at DESC);

ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'line_quota',
  ADD COLUMN IF NOT EXISTS booking_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS meta JSONB;

CREATE INDEX IF NOT EXISTS idx_payment_orders_booking_id
  ON payment_orders(booking_id)
  WHERE booking_id <> '';

ALTER TABLE liuyao_records
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'line_paid',
  ADD COLUMN IF NOT EXISTS booking_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_liuyao_records_source_created
  ON liuyao_records(source, created_at DESC);
