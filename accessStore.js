// accessStore.js (CommonJS) — Schema A (firstFree + quota + redeemedCoupons)
// ✅ 特色：最少欄位、最貼近「首次免費 + 優惠碼加次數 + 付款加次數」的規則
//
// 預設檔案位置：
// - ./userAccess.json
// 可用 .env 覆寫：
// - ACCESS_DATA_DIR
// - ACCESS_FILE_PATH

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.ACCESS_DATA_DIR || path.join(__dirname, "data");
const FILE_PATH =
  process.env.ACCESS_FILE_PATH || path.join(__dirname, "userAccess.json");
//const FILE_PATH = process.env.ACCESS_FILE_PATH || path.join(DATA_DIR, "userAccess.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function nowISO() {
  return new Date().toISOString();
}

// ✅ 新用戶預設：三個功能各 1 次首次體驗
function defaultUserRecord(userId) {
  const t = nowISO();
  return {
    userId,
    firstFree: { liuyao: 1, bazimatch: 1, minibazi: 1 },
    quota: { liuyao: 0, bazimatch: 0, minibazi: 0 },
    redeemedCoupons: {}, // { "FREE99": true }
    meta: { createdAt: t, updatedAt: t },
  };
}

function readAll() {
  ensureDir();
  if (!fs.existsSync(FILE_PATH)) return {};
  try {
    const raw = fs.readFileSync(FILE_PATH, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("[accessStore] 讀取 userAccess.json 失敗:", e.message);
    return {};
  }
}

function writeAll(obj) {
  ensureDir();
  const tmp = FILE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, FILE_PATH);
}

// 取得 user；若不存在則自動建立一份預設資料
function getUser(userId) {
  const all = readAll();
  if (!all[userId]) {
    all[userId] = defaultUserRecord(userId);
    writeAll(all);
  }
  return all[userId];
}

// 儲存 user（以 userId 當 key）
function saveUser(user) {
  const all = readAll();
  user.meta = user.meta || {};
  user.meta.updatedAt = nowISO();
  all[user.userId] = user;
  writeAll(all);
  return user;
}

module.exports = {
  getUser,
  saveUser,
  defaultUserRecord,
  readAll,
  writeAll,
  FILE_PATH,
  DATA_DIR,
};
