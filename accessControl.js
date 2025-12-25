// accessControl.js (CommonJS)
// Schema A：firstFree + quota + redeemedCoupons
//
// ✅ 規則層（Rule Layer）：
// - gate：判斷能不能使用（不改資料）
// - parseCouponRule：只驗 coupon 規則（不寫入 user）
// ⚠️ DB 時代：真正的扣次/補次請交給 store 的原子函式
//   - consumeQuotaAtomic / addQuotaAtomic / markCouponRedeemedAtomic

function ensureFeatureBuckets(user, feature) {
  user.firstFree = user.firstFree || {};
  user.quota = user.quota || {};
  user.redeemedCoupons = user.redeemedCoupons || {};

  if (typeof user.firstFree[feature] !== "number") user.firstFree[feature] = 0;
  if (typeof user.quota[feature] !== "number") user.quota[feature] = 0;
}

function normalizeCouponCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

function isExpired(expireAt) {
  if (!expireAt) return false;
  const end = new Date(expireAt + "T23:59:59.999Z").getTime();
  return Date.now() > end;
}

/**
 * gate：判斷是否可以使用某功能（不扣次）
 * 回傳：
 * - { allow: true, source: "firstFree" | "quota" }
 * - { allow: false, source: "none" }
 */
function getEligibility(user, feature) {
  ensureFeatureBuckets(user, feature);

  if (user.firstFree[feature] > 0) return { allow: true, source: "firstFree" };
  if (user.quota[feature] > 0) return { allow: true, source: "quota" };

  return { allow: false, source: "none" };
}

/**
 * ✅ 純解析/驗證 coupon 規則（不改 user、不寫 DB）
 * 回傳：{ code, feature, added }
 */
function parseCouponRule(couponCode, couponRules) {
  const code = normalizeCouponCode(couponCode);
  if (!code) throw new Error("[COUPON_ERROR] empty coupon code");

  const rule = couponRules?.[code];
  if (!rule) throw new Error(`[COUPON_ERROR] coupon not found: ${code}`);

  if (isExpired(rule.expireAt)) {
    throw new Error(`[COUPON_ERROR] coupon expired: ${code}`);
  }

  const feature = rule.feature;
  const add = Number(rule.add || 0);
  if (!feature || add <= 0) {
    throw new Error(`[COUPON_ERROR] invalid coupon rule: ${code}`);
  }

  return { code, feature, added: add };
}

/**
 * ⚠️ 兼容保留：舊流程用（會改 user 物件）
 * DB 時代建議改用：
 * - parseCouponRule + markCouponRedeemedAtomic + addQuotaAtomic
 */
function redeemCoupon(user, couponCode, couponRules) {
  const { code, feature, added } = parseCouponRule(couponCode, couponRules);

  user.redeemedCoupons = user.redeemedCoupons || {};
  if (user.redeemedCoupons[code]) {
    throw new Error(`[COUPON_ERROR] coupon already redeemed: ${code}`);
  }

  ensureFeatureBuckets(user, feature);
  user.quota[feature] += added;
  user.redeemedCoupons[code] = true;

  return { code, feature, added };
}

/**
 * ⚠️ 兼容保留：舊流程用（會改 user 物件）
 * DB 時代建議改用 addQuotaAtomic
 */
function grantQuota(user, feature, add = 1) {
  ensureFeatureBuckets(user, feature);

  const n = Number(add || 0);
  if (n <= 0) throw new Error("[USAGE_ERROR] grantQuota add must be > 0");

  user.quota[feature] += n;
  return { feature, added: n };
}

/**
 * ⚠️ 兼容保留：舊流程用（會改 user 物件）
 * DB 時代真正扣次請改用 consumeQuotaAtomic
 */
function consumeUsage(user, feature) {
  ensureFeatureBuckets(user, feature);

  if (user.firstFree[feature] > 0) {
    user.firstFree[feature] -= 1;
    return "firstFree";
  }

  if (user.quota[feature] > 0) {
    user.quota[feature] -= 1;
    return "quota";
  }

  throw new Error(
    `[USAGE_ERROR] consumeUsage failed: no remaining usage for feature=${feature}`
  );
}

module.exports = {
  getEligibility,

  // ✅ 新增：只解析/驗證 coupon 規則（推薦 DB 原子流程用）
  parseCouponRule,

  // ⚠️ 舊版兼容（可留著，但 DB 扣補別再用）
  consumeUsage,
  redeemCoupon,
  grantQuota,
};
