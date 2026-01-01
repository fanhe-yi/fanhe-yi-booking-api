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

// ==========================
// ✅ 將舊的 INIT 訂單全部標成 EXPIRED
// 用途：避免使用者翻舊付款頁又刷到
// 規則：同 user + feature，只允許 1 張 INIT 存活
// ==========================
async function expireOldInitOrders({ userId, feature }) {
  await pool.query(
    `
    UPDATE payment_orders
    SET status = 'EXPIRED'
    WHERE user_id = $1
      AND feature = $2
      AND status = 'INIT'
    `,
    [userId, feature]
  );
}

// ==========================
// ✅ 找最近一筆 INIT 訂單（防止重複建單）////綠界不接受所以沒用這個
// ==========================
async function findRecentInitOrder({ userId, feature, minutes = 30 }) {
  const r = await pool.query(
    `
    SELECT merchant_trade_no, created_at
    FROM payment_orders
    WHERE user_id = $1
      AND feature = $2
      AND status = 'INIT'
      AND created_at >= NOW() - ($3::int * INTERVAL '1 minute')
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [userId, feature, minutes]
  );

  return r.rows[0] || null;
}

module.exports = {
  createPaymentOrder,
  getPaymentOrder,
  updateOrderRawReturn,
  markOrderPaidIfNotYet,
  markOrderFailed,
  expireOldInitOrders,
};
