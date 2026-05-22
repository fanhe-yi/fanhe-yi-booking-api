/* ==========================================================
   minibaziAdviceStore.pg.js
   用途：minibazi（八字格局解析）「命理師審定資料」DB helper
   依賴：./db.js 的 PG pool
   Schema：見 migrations/002_minibazi_advice.sql
   - PRIMARY KEY (day_stem, month_branch)
   - day_stem    CHAR(1)：甲乙丙丁戊己庚辛壬癸
   - month_branch CHAR(1)：子丑寅卯辰巳午未申酉戌亥
========================================================== */

const { pool } = require("./db");

/* =========================
   【AI 用】依日主 + 月支取出該格內容
   - 空白 / 不存在 → 回 null
   - 有內容 → 回 trim 後的字串
   - AI flow 拿到 null 就不 inject「審定資料」block，讓 AI 自由發揮
========================== */
async function getOne(dayStem, monthBranch) {
  if (!dayStem || !monthBranch) return null;
  try {
    const { rows } = await pool.query(
      `SELECT content FROM minibazi_advice
       WHERE day_stem = $1 AND month_branch = $2`,
      [dayStem, monthBranch],
    );
    if (!rows[0]) return null;
    const c = String(rows[0].content || "").trim();
    return c || null;
  } catch (err) {
    // DB 故障時不阻斷 AI flow，回 null（caller 會走 fallback 不 inject）
    console.warn("[minibaziAdvice] getOne failed:", err?.message || err);
    return null;
  }
}

/* =========================
   【Admin 用】列出全部 120 格
   - 附帶 content_len 讓前端判斷「已填 / 未填」不必整個 content 傳給前端
========================== */
async function listAll() {
  const { rows } = await pool.query(
    `SELECT day_stem,
            month_branch,
            content,
            notes,
            updated_at,
            updated_by,
            LENGTH(content) AS content_len
       FROM minibazi_advice
      ORDER BY day_stem, month_branch`,
  );
  return rows;
}

/* =========================
   【Admin 用】取單一格完整資料（含 notes）
========================== */
async function getCell(dayStem, monthBranch) {
  if (!dayStem || !monthBranch) return null;
  const { rows } = await pool.query(
    `SELECT day_stem, month_branch, content, notes, updated_at, updated_by
       FROM minibazi_advice
      WHERE day_stem = $1 AND month_branch = $2`,
    [dayStem, monthBranch],
  );
  return rows[0] || null;
}

/* =========================
   【Admin 用】UPSERT 一筆內容
   - dayStem / monthBranch 必填
   - content / notes / updatedBy 都可選填
========================== */
async function upsert({ dayStem, monthBranch, content, notes, updatedBy }) {
  if (!dayStem || !monthBranch) {
    throw new Error("upsert: dayStem / monthBranch are required");
  }
  await pool.query(
    `INSERT INTO minibazi_advice
       (day_stem, month_branch, content, notes, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (day_stem, month_branch)
     DO UPDATE SET content    = EXCLUDED.content,
                   notes      = EXCLUDED.notes,
                   updated_at = NOW(),
                   updated_by = EXCLUDED.updated_by`,
    [dayStem, monthBranch, content || "", notes || "", updatedBy || null],
  );
}

module.exports = {
  getOne,
  getCell,
  listAll,
  upsert,
};
