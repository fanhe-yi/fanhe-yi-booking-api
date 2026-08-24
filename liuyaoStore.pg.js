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

module.exports = {
  insertLiuYaoRecord,
};
