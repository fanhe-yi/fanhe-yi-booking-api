// accessControl.js (CommonJS) — Schema A (firstFree + quota + redeemedCoupons)
//
// ✅ 你要的規則：
// 1) 首次使用免費：firstFree[feature] 預設 1，用完歸 0
// 2) 優惠碼免費：同一 userId 同一 coupon 只能兌換一次；兌換後 quota[feature] += N
// 3) 付款用戶免費用一次：付款成功時 quota[feature] += 1（或 +N）
// 4) 扣次：AI 成功後才扣（先扣 firstFree，再扣 quota）

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function isExpired(expireAt) {
  if (!expireAt) return false;
  const end = new Date(expireAt + "T23:59:59.999Z").getTime();
  return Date.now() > end;
}

function ensureFeatureBuckets(user, feature) {
  user.firstFree = user.firstFree || {};
  user.quota = user.quota || {};
  user.redeemedCoupons = user.redeemedCoupons || {};

  if (typeof user.firstFree[feature] !== "number") user.firstFree[feature] = 0;
  if (typeof user.quota[feature] !== "number") user.quota[feature] = 0;
}

/**
 * getEligibility(user, feature)
 * - 入口 gate 用：只判斷，不改資料
 * - 回傳 source：
 *   - "firstFree"：本次會走首次免費（提示用）
 *   - "quota"：本次會走次數池（優惠碼/付費給的次數）
 *   - "none"：沒有資格
 */
function getEligibility(user, feature) {
  ensureFeatureBuckets(user, feature);

  const first = Number(user.firstFree[feature] || 0);
  if (first > 0) return { allow: true, source: "firstFree" };

  const q = Number(user.quota[feature] || 0);
  if (q > 0) return { allow: true, source: "quota" };

  return { allow: false, source: "none" };
}

/**
 * consumeAfterSuccess(user, feature, source)
 * - AI 成功後才扣（依 source 扣）
 */
function consumeAfterSuccess(user, feature, source) {
  ensureFeatureBuckets(user, feature);

  if (source === "firstFree") {
    user.firstFree[feature] = Math.max(0, Number(user.firstFree[feature] || 0) - 1);
    return { ok: true, consumed: "firstFree" };
  }

  if (source === "quota") {
    user.quota[feature] = Math.max(0, Number(user.quota[feature] || 0) - 1);
    return { ok: true, consumed: "quota" };
  }

  return { ok: false, reason: "invalid_source" };
}

/**
 * consumeAfterSuccessPreferFirstFree(user, feature)
 * - AI 成功後才扣（更保險）：永遠先扣 firstFree（有就扣），不然扣 quota
 */
function consumeAfterSuccessPreferFirstFree(user, feature) {
  ensureFeatureBuckets(user, feature);

  const first = Number(user.firstFree[feature] || 0);
  if (first > 0) {
    user.firstFree[feature] = Math.max(0, first - 1);
    return { ok: true, consumed: "firstFree" };
  }

  const q = Number(user.quota[feature] || 0);
  if (q > 0) {
    user.quota[feature] = Math.max(0, q - 1);
    return { ok: true, consumed: "quota" };
  }

  return { ok: false, reason: "no_balance" };
}

/**
 * redeemCoupon(user, couponCode, couponRules)
 * - couponRules 建議從 JSON 讀入（例如 couponRules.json）
 * - 成功：quota[feature] += add，並標記 redeemedCoupons[CODE] = true
 */
function redeemCoupon(user, couponCode, couponRules) {
  const code = normalizeCode(couponCode);
  if (!code) return { ok: false, reason: "no_code" };

  user.redeemedCoupons = user.redeemedCoupons || {};
  if (user.redeemedCoupons[code]) return { ok: false, reason: "already_redeemed" };

  const rules = couponRules || {};
  const rule = rules[code];
  if (!rule) return { ok: false, reason: "not_found" };

  if (isExpired(rule.expireAt)) return { ok: false, reason: "expired" };

  const feature = rule.feature;
  const add = Number(rule.add || 0);
  if (!feature || add <= 0) return { ok: false, reason: "invalid_rule" };

  ensureFeatureBuckets(user, feature);
  user.quota[feature] = Number(user.quota[feature] || 0) + add;

  user.redeemedCoupons[code] = true;

  return { ok: true, code, feature, added: add };
}

/**
 * grantQuota(user, feature, add)
 * - 付款成功後用：quota[feature] += add（預設 1）
 */
function grantQuota(user, feature, add = 1) {
  ensureFeatureBuckets(user, feature);
  const n = Number(add || 0);
  if (n <= 0) return { ok: false, reason: "invalid_add" };

  user.quota[feature] = Number(user.quota[feature] || 0) + n;
  return { ok: true, feature, added: n };
}

module.exports = {
  getEligibility,
  consumeAfterSuccess,
  consumeAfterSuccessPreferFirstFree,
  redeemCoupon,
  grantQuota,
};