-- ==========================================================
-- migrations/004_liuyao_records_add_editable_fields.sql
--
-- 幫 liuyao_records 加入「老師手動填寫」的 2 個新欄位：
--   - querent_name  占卦者名字（未來以此 group by 分析同一人的多次卜卦）
--   - is_verified   已驗證標籤（未來 filter 分析用）
--
-- （admin_notes 上一版 003 已建立，本 migration 不動）
--
-- 部署：psql "$DATABASE_URL" -f migrations/004_liuyao_records_add_editable_fields.sql
-- ==========================================================

ALTER TABLE liuyao_records
  ADD COLUMN IF NOT EXISTS querent_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_verified  BOOLEAN NOT NULL DEFAULT FALSE;

-- 未來按占卦者查（partial index：只 index 有填的 row，省空間）
CREATE INDEX IF NOT EXISTS idx_liuyao_records_querent
  ON liuyao_records(querent_name)
  WHERE querent_name <> '';

-- 未來 filter 已驗證（partial index：只 index 已驗證 row）
CREATE INDEX IF NOT EXISTS idx_liuyao_records_verified
  ON liuyao_records(is_verified, created_at DESC)
  WHERE is_verified = TRUE;

-- ==========================================================
-- Rollback（用不到就別動）：
--   DROP INDEX IF EXISTS idx_liuyao_records_verified;
--   DROP INDEX IF EXISTS idx_liuyao_records_querent;
--   ALTER TABLE liuyao_records DROP COLUMN is_verified;
--   ALTER TABLE liuyao_records DROP COLUMN querent_name;
-- ==========================================================
