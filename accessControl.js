// accessControl.js (CommonJS) — bazimatch 版
//
// 目標：server.js 決定「這一次」能不能用高階模型（例如 gpt-5.1）
// 設計原則：判斷（getEligibility）與扣除（consumeEligibility）必須分離
//
// 權限判斷順序（建議）：
// 1) paid[feature] === true        → 允許（不扣次）
// 2) credits[feature] > 0          → 允許（扣 1）
// 3) freeQuota[feature] > 0        → 允許（扣 1，新手體驗）
// 4) 否則                          → 不允許（guest 擋掉）

function isExpired(expireAt) {
  if (!expireAt) return false;
  const end = new Date(expireAt + "T23:59:59.999Z").getTime();
  return Date.now() > end;
}

/**
 * redeemCoupon(user, code)
 * - 將「優惠碼」轉成「可用次數（credits）」
 * - 會檢查：不存在/已兌換/過期/remaining 是否足夠
 * - 成功：credits[feature] += addCredits，remaining--，用完會 redeemed=true
 */
function redeemCoupon(user, code) {
  if (!code) return { ok: false, reason: "no_code" };

  const coupons = user.coupons || [];
  const c = coupons.find(x => String(x.code).toUpperCase() === String(code).toUpperCase());

  if (!c) return { ok: false, reason: "not_found" };
  if (c.redeemed) return { ok: false, reason: "already_redeemed" };
  if (isExpired(c.expireAt)) return { ok: false, reason: "expired" };
  if (typeof c.remaining === "number" && c.remaining <= 0) return { ok: false, reason: "no_remaining" };

  const feature = c.feature;
  const add = Number(c.addCredits || 0);

  user.credits = user.credits || {};
  user.credits[feature] = Number(user.credits[feature] || 0) + add;

  if (typeof c.remaining === "number") c.remaining -= 1;
  if (!c.remaining || c.remaining <= 0) c.redeemed = true;

  return { ok: true, feature, added: add, coupon: c };
}

/**
 * getEligibility(user, feature)
 * - 只做「判斷」，不改資料
 * - 回傳：
 *   { allow: true,  source: "paid" | "credits" | "free" }
 *   { allow: false, source: "none" }
 */
function getEligibility(user, feature) {
  user.paid = user.paid || {};
  user.credits = user.credits || {};
  user.freeQuota = user.freeQuota || {};

  if (user.paid[feature]) return { allow: true, source: "paid" };

  const credits = Number(user.credits[feature] || 0);
  if (credits > 0) return { allow: true, source: "credits" };

  const free = Number(user.freeQuota[feature] || 0);
  if (free > 0) return { allow: true, source: "free" };

  return { allow: false, source: "none" };
}

/**
 * consumeEligibility(user, feature, source)
 * - 真正扣掉一次資格（paid 不扣）
 * - 你可以選擇「AI 成功後才扣」來避免誤扣
 */
function consumeEligibility(user, feature, source) {
  user.credits = user.credits || {};
  user.freeQuota = user.freeQuota || {};

  if (source === "credits") {
    user.credits[feature] = Math.max(0, Number(user.credits[feature] || 0) - 1);
    return { ok: true };
  }
  if (source === "free") {
    user.freeQuota[feature] = Math.max(0, Number(user.freeQuota[feature] || 0) - 1);
    return { ok: true };
  }
  if (source === "paid") return { ok: true };

  return { ok: false, reason: "invalid_source" };
}

module.exports = {
  redeemCoupon,
  getEligibility,
  consumeEligibility,
};