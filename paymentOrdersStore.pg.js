// paymentOrdersStore.pg.js
// ✅ 目的：把 payment_orders 的 DB 操作集中管理，server.js 不塞一堆 SQL
// ✅ 重點：建單 / 存 raw_return / 防重標記 PAID / 查單

const { pool } = require("./db");

async function createPaymentOrder({
  merchantTradeNo,
  userId,
  feature,
  qty,
  amount,
}) {
  await pool.query(
    `
    INSERT INTO payment_orders
      (merchant_trade_no, user_id, feature, qty, amount, status, created_at)
    VALUES
      ($1, $2, $3, $4, $5, 'INIT', NOW())
    `,
    [merchantTradeNo, userId, feature, qty, amount]
  );
  return { merchantTradeNo };
}

async function getPaymentOrder(merchantTradeNo) {
  const r = await pool.query(
    `SELECT * FROM payment_orders WHERE merchant_trade_no = $1`,
    [merchantTradeNo]
  );
  return r.rows[0] || null;
}

async function updateOrderRawReturn(merchantTradeNo, raw) {
  await pool.query(
    `
    UPDATE payment_orders
    SET raw_return = $2::jsonb
    WHERE merchant_trade_no = $1
    `,
    [merchantTradeNo, JSON.stringify(raw)]
  );
}

// ✅ 防重：綠界可能重送回呼 → 只有第一次 INIT→PAID 成功才算
async function markOrderPaidIfNotYet({ merchantTradeNo, ecpayTradeNo }) {
  const r = await pool.query(
    `
    UPDATE payment_orders
    SET status = 'PAID',
        paid_at = NOW(),
        ecpay_trade_no = $2
    WHERE merchant_trade_no = $1
      AND status <> 'PAID'
    RETURNING merchant_trade_no
    `,
    [merchantTradeNo, ecpayTradeNo]
  );
  return { didUpdate: r.rowCount === 1 };
}

async function markOrderFailed({ merchantTradeNo, ecpayTradeNo }) {
  await pool.query(
    `
    UPDATE payment_orders
    SET status = 'FAILED',
        ecpay_trade_no = COALESCE($2, ecpay_trade_no)
    WHERE merchant_trade_no = $1
      AND status <> 'PAID'
    `,
    [merchantTradeNo, ecpayTradeNo]
  );
}

module.exports = {
  createPaymentOrder,
  getPaymentOrder,
  updateOrderRawReturn,
  markOrderPaidIfNotYet,
  markOrderFailed,
};
