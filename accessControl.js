// accessControl.js (CommonJS)
// Schema A：firstFree + quota + redeemedCoupons
//
// 職責：
// - gate：判斷能不能使用（不改資料）
// - consumeUsage：使用成立後扣一次（必扣，扣不到就是錯）
// - redeemCoupon：兌換優惠碼（增加 quota）
// - grantQuota：付款成功後增加 quota

function ensureFeatureBuckets(user, feature) {
  user.firstFree = user.firstFree || {};
  user.quota = user.quota || {};
  user.redeemedCoupons = user.redeemedCoupons || {};

  if (typeof user.firstFree[feature] !== "number") {
    user.firstFree[feature] = 0;
  }
  if (typeof user.quota[feature] !== "number") {
    user.quota[feature] = 0;
  }
}

function normalizeCouponCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

function isExpired(expireAt) {
  if (!expireAt) return false;
  // 支援 YYYY-MM-DD
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

  if (user.firstFree[feature] > 0) {
    return { allow: true, source: "firstFree" };
  }

  if (user.quota[feature] > 0) {
    return { allow: true, source: "quota" };
  }

  return { allow: false, source: "none" };
}

/**
 * 使用成立後扣一次
 * 規則：
 * 1) 先扣 firstFree
 * 2) 再扣 quota
 * 扣不到 = 系統錯（理論上 gate 已經擋過）
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

  // 不應發生，發生就是流程錯誤
  throw new Error(
    `[USAGE_ERROR] consumeUsage failed: no remaining usage for feature=${feature}`
  );
}

/**
 * 兌換優惠碼（增加 quota）
 * - 同一 userId + coupon 只能用一次
 * - couponRules 由外部 JSON 傳入
 */
function redeemCoupon(user, couponCode, couponRules) {
  const code = normalizeCouponCode(couponCode);
  if (!code) {
    throw new Error("[COUPON_ERROR] empty coupon code");
  }

  user.redeemedCoupons = user.redeemedCoupons || {};
  if (user.redeemedCoupons[code]) {
    throw new Error(`[COUPON_ERROR] coupon already redeemed: ${code}`);
  }

  const rule = couponRules?.[code];
  if (!rule) {
    throw new Error(`[COUPON_ERROR] coupon not found: ${code}`);
  }

  if (isExpired(rule.expireAt)) {
    throw new Error(`[COUPON_ERROR] coupon expired: ${code}`);
  }

  const feature = rule.feature;
  const add = Number(rule.add || 0);

  if (!feature || add <= 0) {
    throw new Error(`[COUPON_ERROR] invalid coupon rule: ${code}`);
  }

  ensureFeatureBuckets(user, feature);

  user.quota[feature] += add;
  user.redeemedCoupons[code] = true;

  return {
    code,
    feature,
    added: add,
  };
}

/**
 * 付款成功後增加使用次數
 */
function grantQuota(user, feature, add = 1) {
  ensureFeatureBuckets(user, feature);

  const n = Number(add || 0);
  if (n <= 0) {
    throw new Error("[USAGE_ERROR] grantQuota add must be > 0");
  }

  user.quota[feature] += n;

  return {
    feature,
    added: n,
  };
}

module.exports = {
  getEligibility,
  consumeUsage,
  redeemCoupon,
  grantQuota,
};
