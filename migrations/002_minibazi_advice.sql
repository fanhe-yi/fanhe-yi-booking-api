-- ============================================================
-- migrations/002_minibazi_advice.sql
-- 用途：minibazi 命理師審定資料庫（日主 × 出生月支）
-- 設計：詳見 docs/fortune-design.md 的設計思路（雖然檔名是 fortune-design，
--       但該規範裡的「命理師審定資料」概念在這裡實作）
-- ============================================================

CREATE TABLE IF NOT EXISTS minibazi_advice (
  day_stem     CHAR(1) NOT NULL,           -- 甲乙丙丁戊己庚辛壬癸
  month_branch CHAR(1) NOT NULL,           -- 子丑寅卯辰巳午未申酉戌亥
  content      TEXT NOT NULL DEFAULT '',   -- 送 AI 用的自由文字
  notes        TEXT DEFAULT '',            -- 老師內部備註（不送 AI）
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   TEXT,                       -- admin 識別（可留空）
  PRIMARY KEY (day_stem, month_branch)
);

-- 預先 seed 120 個空格（10 天干 × 12 地支），方便 admin UI 直接列出整個矩陣
INSERT INTO minibazi_advice (day_stem, month_branch)
SELECT ds, mb
FROM
  UNNEST(ARRAY['甲','乙','丙','丁','戊','己','庚','辛','壬','癸']) AS ds,
  UNNEST(ARRAY['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥']) AS mb
ON CONFLICT (day_stem, month_branch) DO NOTHING;

-- 驗證 seed 結果
-- SELECT COUNT(*) FROM minibazi_advice;  -- 預期 120

-- ============================================================
-- Rollback（如需移除）
-- ============================================================
-- DROP TABLE minibazi_advice;
