-- ==========================================================
-- migrations/005_liuyao_records_add_shensha_notes.sql
--
-- 加 shensha_notes：老師手動補的自由文字
-- 用途：卦身 / 用神 / 神煞（羊刃/驛馬/桃花/貴人/文昌...）
--       這些 hex_data 沒直接算出來，老師事後手動填
--
-- 部署：psql "$DATABASE_URL" -f migrations/005_liuyao_records_add_shensha_notes.sql
-- ==========================================================

ALTER TABLE liuyao_records
  ADD COLUMN IF NOT EXISTS shensha_notes TEXT NOT NULL DEFAULT '';

-- ==========================================================
-- Rollback（用不到就別動）：
--   ALTER TABLE liuyao_records DROP COLUMN shensha_notes;
-- ==========================================================
