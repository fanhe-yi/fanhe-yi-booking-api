// accessStore.pg.js
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

async function getUser(userId) {
  const r = await pool.query(
    `SELECT user_id, first_free, quota, redeemed_coupons, created_at, updated_at
     FROM user_access
     WHERE user_id = $1`,
    [userId]
  );

  if (r.rowCount === 0) {
    // DB 沒資料就建立一筆初始值
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

async function saveUser(user) {
  // 以你現在 schema，save 就是整包寫回去（最少改動）
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

module.exports = {
  defaultUserRecord,
  getUser,
  saveUser,
};
