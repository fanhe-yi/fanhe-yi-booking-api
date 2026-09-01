-- migrations/009_web_ai_usage_status.sql
-- Web tools free AI usage reservation status.
-- 部署：psql "$DATABASE_URL" -f migrations/009_web_ai_usage_status.sql

ALTER TABLE web_ai_usage
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'used';

ALTER TABLE web_ai_usage
  ADD COLUMN IF NOT EXISTS error TEXT;

ALTER TABLE web_ai_usage
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

