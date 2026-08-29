const { pool } = require("./db");

let ensured = false;

async function ensureWebLiuYaoUsageTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_liuyao_usage (
      id             BIGSERIAL PRIMARY KEY,
      visitor_id     TEXT NOT NULL,
      usage_date_tw  DATE NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_web_liuyao_usage_visitor_day
      ON web_liuyao_usage(visitor_id, usage_date_tw)
  `);
  ensured = true;
}

async function consumeDailyFreeUse(visitorId) {
  if (!visitorId) return { ok: false, reason: "MISSING_VISITOR" };

  await ensureWebLiuYaoUsageTable();

  const { rows } = await pool.query(
    `
    INSERT INTO web_liuyao_usage (visitor_id, usage_date_tw)
    VALUES ($1, (NOW() AT TIME ZONE 'Asia/Taipei')::date)
    ON CONFLICT (visitor_id, usage_date_tw) DO NOTHING
    RETURNING id
    `,
    [visitorId],
  );

  if (rows[0]?.id) return { ok: true };
  return { ok: false, reason: "DAILY_LIMIT_REACHED" };
}

module.exports = {
  consumeDailyFreeUse,
};
