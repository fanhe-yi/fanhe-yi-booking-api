/***************************************
 * [Step 1-1] domain/cache.js
 * 目的：快取六爻解卦結果（讓使用者點章節不用重算）
 ***************************************/
const LY_TTL = 30 * 60 * 1000; // 30 分鐘
const lyCache = new Map();

function lySave(userId, payload) {
  console.log("[LY CACHE] save", userId);
  lyCache.set(userId, { ...payload, ts: Date.now() });
}

function lyGet(userId) {
  console.log("[LY CACHE] get", userId);
  const v = lyCache.get(userId);
  if (!v) return null;
  if (Date.now() - v.ts > LY_TTL) {
    lyCache.delete(userId);
    return null;
  }
  return v;
}

module.exports = { lySave, lyGet };
