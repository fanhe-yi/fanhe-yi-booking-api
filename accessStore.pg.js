// accessStore.pg.js
// PostgreSQL 版 store：對應 user_access (JSONB)
// ✅ 提供原子扣/補 quota，避免併發 / webhook 重送造成雙扣、雙補
// ✅ 提供原子標記 coupon 已兌換（仍用 JSONB，不額外建表，最少改動）

const { pool } = require("./db");

function defaultUserRecord(userId) {
  const now = new Date().toISOString();
  return {
    userId,
    firstFree: { liuyao: 1, bazimatch: 1, minibazi: 1 },
    quota: { liuyao: 0, bazimatch: 0, minibazi: 0 },
    redeemedCoupons: {},
    meta: { createdAt: now, updatedAt: now },
  };
}

/**
 * 取得使用者資料；若 DB 沒資料就自動建立一筆預設值
 */
async function getUser(userId) {
  const r = await pool.query(
    `SELECT user_id, first_free, quota, redeemed_coupons, created_at, updated_at
     FROM user_access
     WHERE user_id = $1`,
    [userId]
  );

  if (r.rowCount === 0) {
    const u = defaultUserRecord(userId);
    await pool.query(
      `INSERT INTO user_access (user_id, first_free, quota, redeemed_coupons, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, NOW(), NOW())`,
      [
        u.userId,
        JSON.stringify(u.firstFree),
        JSON.stringify(u.quota),
        JSON.stringify(u.redeemedCoupons),
      ]
    );
    return u;
  }

  const row = r.rows[0];
  return {
    userId: row.user_id,
    firstFree: row.first_free || {},
    quota: row.quota || {},
    redeemedCoupons: row.redeemed_coupons || {},
    meta: {
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
  };
}

/**
 * 整包寫回（非原子）
 * - 保留：給你「真的需要整包更新」時用（例如你決定要把 firstFree 整包改掉）
 * - ⚠️ 但「扣 quota / 補 quota / coupon 防重」請改用下面的原子函式
 */
async function saveUser(user) {
  const updatedAt = new Date();
  await pool.query(
    `UPDATE user_access
     SET first_free = $2::jsonb,
         quota = $3::jsonb,
         redeemed_coupons = $4::jsonb,
         updated_at = $5
     WHERE user_id = $1`,
    [
      user.userId,
      JSON.stringify(user.firstFree || {}),
      JSON.stringify(user.quota || {}),
      JSON.stringify(user.redeemedCoupons || {}),
      updatedAt,
    ]
  );

  user.meta = user.meta || {};
  user.meta.updatedAt = updatedAt.toISOString();
  return user;
}

/**
 * 原子補 quota（付款成功 / coupon 成功用）
 * feature: 'liuyao' | 'bazimatch' | 'minibazi'
 */
async function addQuotaAtomic(userId, feature, qty) {
  if (!feature) throw new Error("addQuotaAtomic: feature is required");
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("addQuotaAtomic: qty must be a positive integer");
  }

  // 確保 user 存在
  await getUser(userId);

  const r = await pool.query(
    `
    UPDATE user_access
    SET quota = jsonb_set(
      quota,
      ARRAY[$2],
      to_jsonb(
        COALESCE((quota->>$2)::int, 0) + $3
      ),
      true
    ),
    updated_at = NOW()
    WHERE user_id = $1
    RETURNING quota
    `,
    [userId, feature, qty]
  );

  return r.rows[0]?.quota;
}

/**
 * 原子扣 quota（使用服務用）
 * - 不夠扣就不做任何更新（rowCount=0）
 */
async function consumeQuotaAtomic(userId, feature, qty = 1) {
  if (!feature) throw new Error("consumeQuotaAtomic: feature is required");
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("consumeQuotaAtomic: qty must be a positive integer");
  }

  await getUser(userId);

  const r = await pool.query(
    `
    UPDATE user_access
    SET quota = jsonb_set(
      quota,
      ARRAY[$2],
      to_jsonb(
        COALESCE((quota->>$2)::int, 0) - $3
      ),
      true
    ),
    updated_at = NOW()
    WHERE user_id = $1
      AND COALESCE((quota->>$2)::int, 0) >= $3
    RETURNING quota
    `,
    [userId, feature, qty]
  );

  if (r.rowCount === 0) {
    return { ok: false, reason: "NO_QUOTA" };
  }
  return { ok: true, quota: r.rows[0].quota };
}

// ==========================
// ✅ 原子扣 first_free（首免）
// - 只有在 first_free[feature] >= 1 時才會成功
// - 防併發：同時兩個請求只會有一個成功
// ==========================
async function consumeFirstFreeAtomic(userId, feature, qty = 1) {
  if (!feature) throw new Error("consumeFirstFreeAtomic: feature is required");
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("consumeFirstFreeAtomic: qty must be a positive integer");
  }

  await getUser(userId);

  const r = await pool.query(
    `
    UPDATE user_access
    SET first_free = jsonb_set(
      first_free,
      ARRAY[$2],
      to_jsonb(
        COALESCE((first_free->>$2)::int, 0) - $3
      ),
      true
    ),
    updated_at = NOW()
    WHERE user_id = $1
      AND COALESCE((first_free->>$2)::int, 0) >= $3
    RETURNING first_free
    `,
    [userId, feature, qty]
  );

  if (r.rowCount === 0) {
    return { ok: false, reason: "NO_FIRST_FREE" };
  }
  return { ok: true, firstFree: r.rows[0].first_free };
}

/**
 * 原子標記 coupon 已兌換（JSONB 方式）
 * - 防併發：只有在「還沒標記過」時才會成功更新
 */
async function markCouponRedeemedAtomic(userId, couponCode) {
  const code = String(couponCode || "")
    .trim()
    .toUpperCase();
  if (!code) throw new Error("markCouponRedeemedAtomic: couponCode required");

  await getUser(userId);

  const r = await pool.query(
    `
    UPDATE user_access
    SET redeemed_coupons = jsonb_set(
      redeemed_coupons,
      ARRAY[$2],
      'true'::jsonb,
      true
    ),
    updated_at = NOW()
    WHERE user_id = $1
      AND COALESCE((redeemed_coupons->>$2)::boolean, false) = false
    RETURNING redeemed_coupons
    `,
    [userId, code]
  );

  if (r.rowCount === 0) {
    return { ok: false, reason: "ALREADY_REDEEMED" };
  }
  return { ok: true, redeemedCoupons: r.rows[0].redeemed_coupons };
}

module.exports = {
  defaultUserRecord,
  getUser,
  saveUser,

  // ✅ 原子操作（你接金流會靠這三個保命）
  addQuotaAtomic,
  consumeFirstFreeAtomic,
  consumeQuotaAtomic,
  markCouponRedeemedAtomic,
};
