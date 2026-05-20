-- ==============================================
-- Migration 001: fortune_draws
--
-- 占卜抽籤紀錄表（給未來的免費占卜功能用）
--
-- 設計重點：
--   1. 每一次抽籤 = 一 row（append-only）
--   2. 「user X 今天用過 Y 神明嗎？」= 查當天該人該神明且 poem_id IS NOT NULL 的 row
--   3. draw_date 用 DATE 不是 TIMESTAMP（每天 00:00 reset 是「日期」概念，避免時區坑）
--   4. poem_id 可為 NULL：被陰筊擋下時留紀錄但不算用 quota
--   5. 與 user_access（付費 quota）完全平行，互不干擾
--
-- 套用方式：
--   set -a; source .env; set +a
--   psql "$DATABASE_URL" < migrations/001_fortune_draws.sql
--
-- 回滾：
--   見檔案最末 ROLLBACK 註解區塊
-- ==============================================

CREATE TABLE IF NOT EXISTS fortune_draws (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,                 -- LINE userId
  draw_date       DATE NOT NULL,                 -- 台北時區 YYYY-MM-DD
  deity           TEXT NOT NULL,                 -- yuelao / wenchang / guangong / mazu / guanyin / ...
  poem_id         INTEGER,                       -- 抽到第幾支籤；NULL = 陰筊擋下、未抽
  jiao_result     TEXT,                          -- shengjiao / xiaojiao / yinjiao
  question_text   TEXT,                          -- 使用者問題原文
  ai_response     TEXT,                          -- AI 解讀全文
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 主要查詢：quota 判定「user X 今天有沒有抽過 Y 神明」
CREATE INDEX IF NOT EXISTS idx_fortune_draws_user_date
  ON fortune_draws(user_id, draw_date);

-- 分析查詢：「最近哪個神明最熱／哪支籤最多人抽」
CREATE INDEX IF NOT EXISTS idx_fortune_draws_deity_date
  ON fortune_draws(deity, draw_date);

-- ==============================================
-- ROLLBACK（萬一要拿掉，把以下三行的註解拿掉執行）
-- ==============================================
-- DROP INDEX IF EXISTS idx_fortune_draws_user_date;
-- DROP INDEX IF EXISTS idx_fortune_draws_deity_date;
-- DROP TABLE IF EXISTS fortune_draws;
