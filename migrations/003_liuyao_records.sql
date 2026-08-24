-- ==========================================================
-- migrations/003_liuyao_records.sql
--
-- 目的：持久化每次六爻卜卦的送 AI 前資訊 + AI 回覆
-- 用途：未來 admin 前端可查看／編輯／補心得
--
-- 部署：psql "$DATABASE_URL" -f migrations/003_liuyao_records.sql
-- ==========================================================

CREATE TABLE IF NOT EXISTS liuyao_records (
  id             BIGSERIAL PRIMARY KEY,
  user_id        TEXT NOT NULL,                     -- LINE userId
  gender_text    TEXT DEFAULT '',                   -- 男命 / 女命
  topic_text     TEXT DEFAULT '',                   -- 使用者提問文字
  hex_code       TEXT DEFAULT '',                   -- 使用者輸入的起卦碼（finalCode）
  ganzhi_text    TEXT DEFAULT '',                   -- 干支（例：甲子年，乙丑月...）
  phase_text     TEXT DEFAULT '',                   -- 旺相休囚死 + 月破
  xunkong_text   TEXT DEFAULT '',                   -- 旬空
  six_lines_text TEXT DEFAULT '',                   -- 六爻六條逐行
  hex_data       JSONB,                             -- 原始 hexData 物件（含 ganzhi / xunkong / 六爻結構）
  ai_response    TEXT DEFAULT '',                   -- AI 解卦回傳的完整文字
  admin_notes    TEXT DEFAULT '',                   -- 老師事後補註（本輪 code 不寫入，admin UI 上線後才用）
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 查特定使用者歷史（按時間新到舊）
CREATE INDEX IF NOT EXISTS idx_liuyao_records_user_created
  ON liuyao_records(user_id, created_at DESC);

-- 全站按時間看
CREATE INDEX IF NOT EXISTS idx_liuyao_records_created
  ON liuyao_records(created_at DESC);

-- ==========================================================
-- Rollback（用不到就別動）：
-- DROP TABLE liuyao_records;
-- ==========================================================
