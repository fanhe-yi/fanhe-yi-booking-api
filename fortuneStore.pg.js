/* ==========================================================
   fortuneStore.pg.js
   占卜功能的 DB helper（fortune_draws 表）

   - 用途：給 server.js 的占卜流程用，封裝所有 PG 操作
   - 依賴：./db.js 的 pool（既有 PostgreSQL 連線池）
   - schema：見 migrations/001_fortune_draws.sql
========================================================== */

const { pool } = require("./db");

/* =========================
   【工具】取得「今天」的台北日期字串 YYYY-MM-DD
   - 用於 draw_date 欄位
   - 不能用 toISOString().slice(0,10)，那會回 UTC 日期，跨午夜會錯
========================== */
function getTaiwanDateString() {
  const now = new Date();
  const taipei = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }),
  );
  const yyyy = taipei.getFullYear();
  const mm = String(taipei.getMonth() + 1).padStart(2, "0");
  const dd = String(taipei.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* =========================
   【quota】判定 user 今天還能不能抽
   - true  = 今天還沒成功抽過 → 可抽
   - false = 今天已抽過（有任何 poem_id 不為 NULL 的紀錄）

   注意：笑筊/陰筊 因為 poem_id 為 NULL，不算用過 quota
========================== */
async function canCastFortuneToday(userId) {
  if (!userId) return false;
  const today = getTaiwanDateString();
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS used
       FROM fortune_draws
      WHERE user_id = $1
        AND draw_date = $2
        AND poem_id IS NOT NULL`,
    [userId, today],
  );
  return Number(rows[0].used) === 0;
}

/* =========================
   【寫入】記錄一次抽籤事件
   參數：
     - userId           必填
     - deity            必填，如 "yuelao"
     - jiaoResult       "shengjiao" / "xiaojiao" / "yinjiao"
     - poemId           聖筊才有；笑/陰筊傳 null
     - questionText     使用者問題（隱私同意過才存）
     - aiResponse       AI 回應（聖筊才有；笑/陰筊傳 null）
   回傳：寫入的 row id
========================== */
async function recordFortuneDraw({
  userId,
  deity,
  jiaoResult,
  poemId = null,
  questionText = null,
  aiResponse = null,
}) {
  if (!userId || !deity || !jiaoResult) {
    throw new Error("recordFortuneDraw: missing required fields");
  }
  const today = getTaiwanDateString();
  const { rows } = await pool.query(
    `INSERT INTO fortune_draws
       (user_id, draw_date, deity, poem_id, jiao_result, question_text, ai_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, today, deity, poemId, jiaoResult, questionText, aiResponse],
  );
  return rows[0].id;
}

/* =========================
   【analytics】撈某使用者最近 N 筆紀錄（給未來「我的占卜歷史」用）
   - 本次 MVP 不一定會用到，先 export 留著
========================== */
async function getRecentDrawsByUser(userId, limit = 5) {
  if (!userId) return [];
  const { rows } = await pool.query(
    `SELECT id, draw_date, deity, poem_id, jiao_result, created_at
       FROM fortune_draws
      WHERE user_id = $1
        AND poem_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

module.exports = {
  getTaiwanDateString,
  canCastFortuneToday,
  recordFortuneDraw,
  getRecentDrawsByUser,
};
