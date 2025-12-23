// accessStore.js (CommonJS) — bazimatch 版
// JSON 檔先撐住；之後換 PostgreSQL 時，外部呼叫端不用改：替換此檔實作即可。

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.ACCESS_DATA_DIR || path.join(__dirname, "data");
const FILE_PATH = process.env.ACCESS_FILE_PATH || path.join(DATA_DIR, "userAccess.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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

function nowISO() {
  return new Date().toISOString();
}

// ✅ 預設新用戶：六爻/八字合婚（bazimatch）各 1 次新手體驗
function defaultUserRecord(userId) {
  const t = nowISO();
  return {
    userId,
    paid: { liuyao: false, bazimatch: false },
    freeQuota: { liuyao: 1, bazimatch: 1 },
    credits: { liuyao: 0, bazimatch: 0 },
    coupons: [],
    meta: { createdAt: t, updatedAt: t }
  };
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
  readAll,
  writeAll,
  defaultUserRecord,
  FILE_PATH,
  DATA_DIR,
};