const crypto = require("crypto");
const { pool } = require("./db");

let ensured = false;

async function ensureWebToolReportTables() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_ai_usage (
      visitor_id TEXT NOT NULL,
      usage_date_tw DATE NOT NULL,
      used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (visitor_id, usage_date_tw)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_web_ai_usage_date
      ON web_ai_usage (usage_date_tw DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_tool_reports (
      id UUID PRIMARY KEY,
      token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      source TEXT NOT NULL DEFAULT 'ecpay',
      email TEXT NOT NULL,
      visitor_id TEXT NOT NULL DEFAULT '',
      focus TEXT NOT NULL DEFAULT '',
      birth JSONB NOT NULL,
      bazi_chart JSONB,
      ziwei_chart JSONB,
      bazi_analysis TEXT,
      ziwei_analysis TEXT,
      zonghe_analysis TEXT,
      poster_json JSONB,
      html TEXT,
      activity_code TEXT NOT NULL DEFAULT '',
      payment_merchant_trade_no TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      generated_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_web_tool_reports_token
      ON web_tool_reports (token)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_web_tool_reports_payment
      ON web_tool_reports (payment_merchant_trade_no)
      WHERE payment_merchant_trade_no <> ''
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_web_tool_reports_email_created
      ON web_tool_reports (email, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_report_activity_codes (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TIMESTAMPTZ,
      batch_id TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      redeemed_at TIMESTAMPTZ,
      redeemed_email TEXT NOT NULL DEFAULT '',
      redeemed_visitor_id TEXT NOT NULL DEFAULT '',
      report_id UUID REFERENCES web_tool_reports(id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_web_report_activity_codes_status
      ON web_report_activity_codes (status, created_at DESC)
  `);
  ensured = true;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function makeId() {
  return crypto.randomUUID();
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function makeActivityCode(prefix = "REPORT") {
  const safePrefix = String(prefix || "REPORT")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12) || "REPORT";
  return `${safePrefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function consumeFreeAiUse(visitorId) {
  await ensureWebToolReportTables();
  const id = String(visitorId || "").trim();
  const r = await pool.query(
    `
    INSERT INTO web_ai_usage (visitor_id, usage_date_tw)
    VALUES ($1, (NOW() AT TIME ZONE 'Asia/Taipei')::date)
    ON CONFLICT (visitor_id, usage_date_tw) DO NOTHING
    RETURNING visitor_id
    `,
    [id],
  );
  return r.rowCount === 1
    ? { ok: true }
    : { ok: false, reason: "DAILY_LIMIT_REACHED" };
}

async function createPaymentReport({ email, visitorId, focus, birth }) {
  await ensureWebToolReportTables();
  const id = makeId();
  const token = makeToken();
  await pool.query(
    `
    INSERT INTO web_tool_reports
      (id, token, status, source, email, visitor_id, focus, birth)
    VALUES
      ($1, $2, 'pending_payment', 'ecpay', $3, $4, $5, $6::jsonb)
    `,
    [
      id,
      token,
      String(email || "").trim().toLowerCase(),
      String(visitorId || "").trim(),
      String(focus || "").trim(),
      JSON.stringify(birth || {}),
    ],
  );
  return { id, token, status: "pending_payment" };
}

async function attachPaymentToReport(reportId, merchantTradeNo) {
  await ensureWebToolReportTables();
  await pool.query(
    `
    UPDATE web_tool_reports
    SET payment_merchant_trade_no = $2, updated_at = NOW()
    WHERE id = $1
    `,
    [reportId, merchantTradeNo],
  );
}

async function createActivityCodesBatch({ count, prefix, expiresAt = null, note = "" }) {
  await ensureWebToolReportTables();
  const n = Math.max(1, Math.min(Number(count || 1), 200));
  const batchId = makeId();
  const codes = [];
  for (let i = 0; i < n; i += 1) {
    let inserted = false;
    for (let attempt = 0; attempt < 8 && !inserted; attempt += 1) {
      const code = makeActivityCode(prefix);
      try {
        await pool.query(
          `
          INSERT INTO web_report_activity_codes (code, batch_id, expires_at, note)
          VALUES ($1, $2, $3, $4)
          `,
          [code, batchId, expiresAt || null, String(note || "").trim()],
        );
        codes.push(code);
        inserted = true;
      } catch (err) {
        if (err?.code !== "23505") throw err;
      }
    }
    if (!inserted) throw new Error("ACTIVITY_CODE_GENERATE_FAILED");
  }
  return { batchId, codes };
}

async function createCouponPaidReport({ code, email, visitorId, focus, birth }) {
  await ensureWebToolReportTables();
  const normalizedCode = normalizeCode(code);
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedVisitorId = String(visitorId || "").trim();
  const reportId = makeId();
  const token = makeToken();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const codeResult = await client.query(
      `
      SELECT code, status, expires_at
      FROM web_report_activity_codes
      WHERE code = $1
      FOR UPDATE
      `,
      [normalizedCode],
    );
    const row = codeResult.rows[0];
    if (!row) throw new Error("ACTIVITY_CODE_NOT_FOUND");
    if (row.status !== "active") throw new Error("ACTIVITY_CODE_USED");
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("ACTIVITY_CODE_EXPIRED");
    }

    await client.query(
      `
      INSERT INTO web_tool_reports
        (id, token, status, source, email, visitor_id, focus, birth, activity_code, paid_at)
      VALUES
        ($1, $2, 'coupon_paid', 'activity_code', $3, $4, $5, $6::jsonb, $7, NOW())
      `,
      [
        reportId,
        token,
        normalizedEmail,
        normalizedVisitorId,
        String(focus || "").trim(),
        JSON.stringify(birth || {}),
        normalizedCode,
      ],
    );
    await client.query(
      `
      UPDATE web_report_activity_codes
      SET status = 'redeemed',
          redeemed_at = NOW(),
          redeemed_email = $2,
          redeemed_visitor_id = $3,
          report_id = $4
      WHERE code = $1
      `,
      [normalizedCode, normalizedEmail, normalizedVisitorId, reportId],
    );
    await client.query("COMMIT");
    return { id: reportId, token, status: "coupon_paid" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getPublicReport(reportId, token) {
  await ensureWebToolReportTables();
  const r = await pool.query(
    `
    SELECT id, token, status, source, email, visitor_id, focus, birth,
           bazi_chart, ziwei_chart, bazi_analysis, ziwei_analysis,
           zonghe_analysis, poster_json, html, activity_code,
           payment_merchant_trade_no, error, created_at, updated_at,
           paid_at, generated_at
    FROM web_tool_reports
    WHERE id = $1 AND token = $2
    `,
    [reportId, token],
  );
  return r.rows[0] || null;
}

async function getReportByMerchantTradeNo(merchantTradeNo) {
  await ensureWebToolReportTables();
  const r = await pool.query(
    `SELECT id, token, status FROM web_tool_reports WHERE payment_merchant_trade_no = $1`,
    [merchantTradeNo],
  );
  return r.rows[0] || null;
}

async function markReportPaidByMerchantTradeNo(merchantTradeNo) {
  await ensureWebToolReportTables();
  const r = await pool.query(
    `
    UPDATE web_tool_reports
    SET status = 'generating',
        paid_at = COALESCE(paid_at, NOW()),
        updated_at = NOW()
    WHERE payment_merchant_trade_no = $1
      AND status IN ('pending_payment', 'coupon_paid', 'failed')
    RETURNING id, token, status
    `,
    [merchantTradeNo],
  );
  return r.rows[0] || null;
}

async function markReportGenerating(reportId) {
  await ensureWebToolReportTables();
  await pool.query(
    `
    UPDATE web_tool_reports
    SET status = 'generating', error = NULL, updated_at = NOW()
    WHERE id = $1 AND status <> 'ready'
    `,
    [reportId],
  );
}

async function markReportReady(reportId, payload) {
  await ensureWebToolReportTables();
  await pool.query(
    `
    UPDATE web_tool_reports
    SET status = 'ready',
        bazi_chart = $2::jsonb,
        ziwei_chart = $3::jsonb,
        bazi_analysis = $4,
        ziwei_analysis = $5,
        zonghe_analysis = $6,
        poster_json = $7::jsonb,
        html = $8,
        error = NULL,
        generated_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      reportId,
      JSON.stringify(payload.baziChart || null),
      JSON.stringify(payload.ziweiChart || null),
      payload.baziAnalysis || "",
      payload.ziweiAnalysis || "",
      payload.zongheAnalysis || "",
      JSON.stringify(payload.posterJson || null),
      payload.html || "",
    ],
  );
}

async function markReportFailed(reportId, error) {
  await ensureWebToolReportTables();
  await pool.query(
    `
    UPDATE web_tool_reports
    SET status = 'failed', error = $2, updated_at = NOW()
    WHERE id = $1
    `,
    [reportId, String(error?.message || error || "REPORT_GENERATE_FAILED").slice(0, 1000)],
  );
}

module.exports = {
  consumeFreeAiUse,
  createPaymentReport,
  attachPaymentToReport,
  createActivityCodesBatch,
  createCouponPaidReport,
  getPublicReport,
  getReportByMerchantTradeNo,
  markReportPaidByMerchantTradeNo,
  markReportGenerating,
  markReportReady,
  markReportFailed,
};
