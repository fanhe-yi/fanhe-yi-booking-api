// ==========================================================
// liuyaoStore.pg.js
//
// 六爻卜卦紀錄的 DB helper。
// 對應 schema：migrations/003_liuyao_records.sql
//
// 設計原則：所有函式**永遠不 throw**。DB 掛掉不能讓主流程炸鍋，
//           影響使用者收到 AI 回覆。失敗一律 log + 回傳 null。
// ==========================================================

const { pool } = require("./db");

/**
 * 寫入一筆六爻紀錄。
 * @param {object} record
 * @param {string} record.userId          必填 - LINE userId
 * @param {string} [record.genderText]    男命 / 女命
 * @param {string} [record.topicText]     使用者提問
 * @param {string} [record.hexCode]       使用者輸入的起卦碼（finalCode）
 * @param {string} [record.ganzhiText]    干支
 * @param {string} [record.phaseText]     旺相休囚死
 * @param {string} [record.xunkongText]   旬空
 * @param {string} [record.sixLinesText]  六爻六條
 * @param {object} [record.hexData]       原始 hexData（含 ganzhi / xunkong / 卦爻結構）
 * @param {string} [record.aiResponse]    AI 解讀全文
 * @returns {Promise<{id: number} | null>}
 */
async function insertLiuYaoRecord(record) {
  if (!record || !record.userId) {
    console.warn("[liuyaoStore] insertLiuYaoRecord: missing userId, skipped");
    return null;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO liuyao_records
         (user_id, gender_text, topic_text, hex_code, ganzhi_text,
          phase_text, xunkong_text, six_lines_text,
          hex_data, ai_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        record.userId,
        record.genderText || "",
        record.topicText || "",
        record.hexCode || "",
        record.ganzhiText || "",
        record.phaseText || "",
        record.xunkongText || "",
        record.sixLinesText || "",
        record.hexData || null,
        record.aiResponse || "",
      ],
    );
    return { id: rows[0].id };
  } catch (err) {
    console.error(
      "[liuyaoStore] insertLiuYaoRecord failed:",
      err?.message || err,
    );
    return null;
  }
}

/**
 * 分頁列表 + 可選搜尋 / verified filter
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.pageSize=20]
 * @param {string} [opts.q]              跨 user_id / topic / ganzhi / querent 模糊搜
 * @param {boolean} [opts.verifiedOnly]  true 只回已驗證
 * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
 */
async function listLiuYaoRecords({
  page = 1,
  pageSize = 20,
  q = "",
  verifiedOnly = false,
} = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (p - 1) * ps;

  const conds = [];
  const params = [];

  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    // 同一個 $1 用 4 個欄位，避免多算 params 位置
    const i = params.length;
    conds.push(
      `(user_id ILIKE $${i} OR topic_text ILIKE $${i} ` +
        `OR ganzhi_text ILIKE $${i} OR querent_name ILIKE $${i})`,
    );
  }
  if (verifiedOnly) conds.push("is_verified = TRUE");

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM liuyao_records ${where}`,
    params,
  );
  const total = cnt[0]?.total || 0;

  const p2 = [...params, ps, offset];
  const limitIdx = p2.length - 1;
  const offsetIdx = p2.length;
  const { rows } = await pool.query(
    `SELECT id, user_id, querent_name, is_verified,
            gender_text, topic_text, hex_code,
            LEFT(ganzhi_text, 40) AS ganzhi_preview,
            LEFT(ai_response, 60) AS ai_preview,
            (admin_notes <> '') AS has_notes,
            created_at, updated_at
       FROM liuyao_records
       ${where}
       ORDER BY id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    p2,
  );
  return { items: rows, total, page: p, pageSize: ps };
}

/**
 * 取單筆完整 row（含 admin_notes / hex_data 等所有欄位）
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
async function getLiuYaoRecord(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM liuyao_records WHERE id = $1`,
      [n],
    );
    return rows[0] || null;
  } catch (err) {
    console.error(
      "[liuyaoStore] getLiuYaoRecord failed:",
      err?.message || err,
    );
    return null;
  }
}

/**
 * 部分更新（PATCH pattern）— 只更新有傳的欄位
 * @param {number|string} id
 * @param {object} fields
 * @param {string} [fields.querent_name]
 * @param {boolean} [fields.is_verified]
 * @param {string} [fields.admin_notes]
 * @returns {Promise<boolean>} true = 更新成功；false = id 無效 / 沒欄位 / 找不到
 */
async function updateLiuYaoRecord(id, fields = {}) {
  const n = Number(id);
  if (!Number.isFinite(n)) return false;

  const sets = [];
  const params = [];
  if (typeof fields.querent_name === "string") {
    params.push(fields.querent_name);
    sets.push(`querent_name = $${params.length}`);
  }
  if (typeof fields.is_verified === "boolean") {
    params.push(fields.is_verified);
    sets.push(`is_verified = $${params.length}`);
  }
  if (typeof fields.admin_notes === "string") {
    params.push(fields.admin_notes);
    sets.push(`admin_notes = $${params.length}`);
  }
  if (sets.length === 0) return false;

  sets.push("updated_at = NOW()");
  params.push(n);
  try {
    const { rowCount } = await pool.query(
      `UPDATE liuyao_records SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params,
    );
    return rowCount > 0;
  } catch (err) {
    console.error(
      "[liuyaoStore] updateLiuYaoRecord failed:",
      err?.message || err,
    );
    return false;
  }
}

module.exports = {
  insertLiuYaoRecord,
  listLiuYaoRecords,
  getLiuYaoRecord,
  updateLiuYaoRecord,
};
