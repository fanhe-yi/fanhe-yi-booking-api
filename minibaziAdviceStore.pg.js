/* ==========================================================
   minibaziAdviceStore.pg.js
   用途：minibazi（八字格局解析）「命理師審定資料」DB helper
   設計：分日主、月令兩個維度，各自獨立 table
   依賴：./db.js 的 PG pool
   Schema：見 migrations/003_minibazi_advice_split.sql
========================================================== */

const { pool } = require("./db");

/* ==========================================================
   日主（day_stem）相關
========================================================== */

/* 【AI 用】依日主取出該格內容；空白/不存在 → null */
async function getDayStemAdvice(dayStem) {
  if (!dayStem) return null;
  try {
    const { rows } = await pool.query(
      `SELECT content FROM minibazi_day_stem_advice WHERE day_stem = $1`,
      [dayStem],
    );
    if (!rows[0]) return null;
    const c = String(rows[0].content || "").trim();
    return c || null;
  } catch (err) {
    console.warn(
      "[minibaziAdvice] getDayStemAdvice failed:",
      err?.message || err,
    );
    return null;
  }
}

/* 【Admin 用】列出全部 10 個日主（含 content_len） */
async function listDayStemAll() {
  const { rows } = await pool.query(
    `SELECT day_stem, content, notes, updated_at, updated_by,
            LENGTH(content) AS content_len
       FROM minibazi_day_stem_advice
      ORDER BY day_stem`,
  );
  return rows;
}

/* 【Admin 用】取單一日主完整資料 */
async function getDayStemCell(dayStem) {
  if (!dayStem) return null;
  const { rows } = await pool.query(
    `SELECT * FROM minibazi_day_stem_advice WHERE day_stem = $1`,
    [dayStem],
  );
  return rows[0] || null;
}

/* 【Admin 用】UPSERT 一筆日主資料 */
async function upsertDayStem({ dayStem, content, notes, updatedBy }) {
  if (!dayStem) throw new Error("upsertDayStem: dayStem is required");
  await pool.query(
    `INSERT INTO minibazi_day_stem_advice
       (day_stem, content, notes, updated_at, updated_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (day_stem)
     DO UPDATE SET content    = EXCLUDED.content,
                   notes      = EXCLUDED.notes,
                   updated_at = NOW(),
                   updated_by = EXCLUDED.updated_by`,
    [dayStem, content || "", notes || "", updatedBy || null],
  );
}

/* ==========================================================
   月令（month_branch）相關
========================================================== */

async function getMonthBranchAdvice(monthBranch) {
  if (!monthBranch) return null;
  try {
    const { rows } = await pool.query(
      `SELECT content FROM minibazi_month_branch_advice WHERE month_branch = $1`,
      [monthBranch],
    );
    if (!rows[0]) return null;
    const c = String(rows[0].content || "").trim();
    return c || null;
  } catch (err) {
    console.warn(
      "[minibaziAdvice] getMonthBranchAdvice failed:",
      err?.message || err,
    );
    return null;
  }
}

async function listMonthBranchAll() {
  const { rows } = await pool.query(
    `SELECT month_branch, content, notes, updated_at, updated_by,
            LENGTH(content) AS content_len
       FROM minibazi_month_branch_advice
      ORDER BY month_branch`,
  );
  return rows;
}

async function getMonthBranchCell(monthBranch) {
  if (!monthBranch) return null;
  const { rows } = await pool.query(
    `SELECT * FROM minibazi_month_branch_advice WHERE month_branch = $1`,
    [monthBranch],
  );
  return rows[0] || null;
}

async function upsertMonthBranch({ monthBranch, content, notes, updatedBy }) {
  if (!monthBranch) throw new Error("upsertMonthBranch: monthBranch is required");
  await pool.query(
    `INSERT INTO minibazi_month_branch_advice
       (month_branch, content, notes, updated_at, updated_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (month_branch)
     DO UPDATE SET content    = EXCLUDED.content,
                   notes      = EXCLUDED.notes,
                   updated_at = NOW(),
                   updated_by = EXCLUDED.updated_by`,
    [monthBranch, content || "", notes || "", updatedBy || null],
  );
}

module.exports = {
  // 日主
  getDayStemAdvice,
  listDayStemAll,
  getDayStemCell,
  upsertDayStem,
  // 月令
  getMonthBranchAdvice,
  listMonthBranchAll,
  getMonthBranchCell,
  upsertMonthBranch,
};
