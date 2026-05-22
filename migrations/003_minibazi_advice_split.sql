-- ============================================================
-- migrations/003_minibazi_advice_split.sql
--
-- 用途：minibazi 審定資料改為日主／月令分離設計
-- 取代：migrations/002_minibazi_advice.sql 的 120 格組合表
-- 由來：120 格維護成本高，改成 10+12 兩個獨立維度
--       AI 解讀時同時查兩個表並 inject 兩段資料
-- ============================================================

-- 1) DROP 舊組合表（內容全空，零損失）
DROP TABLE IF EXISTS minibazi_advice;

-- 2) 日主審定資料（10 row）
CREATE TABLE IF NOT EXISTS minibazi_day_stem_advice (
  day_stem    CHAR(1) PRIMARY KEY,         -- 甲乙丙丁戊己庚辛壬癸
  content     TEXT NOT NULL DEFAULT '',    -- 送 AI 用的自由文字
  notes       TEXT DEFAULT '',             -- 老師內部備註（不送 AI）
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT
);

INSERT INTO minibazi_day_stem_advice (day_stem)
SELECT UNNEST(ARRAY['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'])
ON CONFLICT (day_stem) DO NOTHING;

-- 3) 月令審定資料（12 row）
CREATE TABLE IF NOT EXISTS minibazi_month_branch_advice (
  month_branch CHAR(1) PRIMARY KEY,        -- 子丑寅卯辰巳午未申酉戌亥
  content      TEXT NOT NULL DEFAULT '',
  notes        TEXT DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   TEXT
);

INSERT INTO minibazi_month_branch_advice (month_branch)
SELECT UNNEST(ARRAY['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'])
ON CONFLICT (month_branch) DO NOTHING;

-- 驗證：
-- SELECT COUNT(*) FROM minibazi_day_stem_advice;      -- 預期 10
-- SELECT COUNT(*) FROM minibazi_month_branch_advice;  -- 預期 12

-- ============================================================
-- Rollback（如需退回 120 格設計）
-- ============================================================
-- DROP TABLE minibazi_day_stem_advice;
-- DROP TABLE minibazi_month_branch_advice;
-- 然後重跑 002_minibazi_advice.sql
