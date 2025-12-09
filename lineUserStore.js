// lineUserStore.js
// 專門負責讀取 lineUsers.json，找出 lineId 對應的 LINE userId

const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "lineUsers.json");

function loadLineUsers() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error("[LINE] 讀取 lineUsers.json 失敗：", err);
    return [];
  }
}

function findUserIdByLineId(lineId) {
  if (!lineId) return null;
  const all = loadLineUsers();
  const found = all.find(
    (item) =>
      item.lineId && item.lineId.toString().trim() === lineId.toString().trim()
  );
  return found ? found.userId : null;
}

module.exports = {
  findUserIdByLineId,
};
