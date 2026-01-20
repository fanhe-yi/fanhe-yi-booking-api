/* =========================================================
   adminPrompts.js
   - Prompt 讀寫 / 匯出 / 備份（僅後台 admin 使用）

   設計重點：
   1) 白名單：只允許操作指定檔案，避免路徑穿越
   2) 原子寫入：寫 tmp -> rename，避免寫一半壞檔
   3) 保存前自動備份：每次保存都留一份帶時間戳版本
   4) 匯出：一次打包目前全部 prompt，方便你下載備份
   ========================================================= */

const fs = require("fs");
const path = require("path");

/* =========================================================
   ✅ Prompt 資料夾位置
   - 你之前已經用 PROMPT_DIR 或預設 ./prompts
   ========================================================= */
const PROMPT_DIR = process.env.PROMPT_DIR || path.join(__dirname, "prompts");

/* =========================================================
   ✅ 備份資料夾位置
   - 預設：./prompts_backups
   - 建議不要跟 prompts 放一起，避免你誤編輯到備份
   ========================================================= */
const BACKUP_DIR =
  process.env.PROMPT_BACKUP_DIR || path.join(__dirname, "prompts_backups");

/* =========================================================
   ✅ 只允許這幾個檔案（白名單）
   - 你之後要加檔案，手動加到這裡即可
   ========================================================= */
const ALLOW_FILES = new Set([
  "minibazi.json",
  "minibazi.userTemplate.txt",
  "minibazi.howto.txt",
  "minibazi.modeCopy.json",
]);

/* =========================================================
   ✅ 讀檔（依副檔名回 type: json/text）
   ========================================================= */
function readPromptFile(filename) {
  if (!ALLOW_FILES.has(filename)) {
    const err = new Error("filename not allowed");
    err.status = 400;
    throw err;
  }

  const fullPath = path.join(PROMPT_DIR, filename);
  const ext = path.extname(filename).toLowerCase();

  if (!fs.existsSync(fullPath)) {
    const err = new Error("file not found");
    err.status = 404;
    throw err;
  }

  const raw = fs.readFileSync(fullPath, "utf8");

  if (ext === ".json") {
    /* ✅ JSON 檔：回傳 parsed（方便前端直接編輯物件） */
    return { type: "json", content: JSON.parse(raw) };
  }

  /* ✅ txt 檔：回傳字串 */
  return { type: "text", content: raw };
}

/* =========================================================
   ✅ 原子寫入（避免寫到一半檔案壞掉）
   ========================================================= */
function writeFileAtomic(fullPath, dataStr) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const tmpPath = `${fullPath}.tmp`;
  fs.writeFileSync(tmpPath, dataStr, "utf8");
  fs.renameSync(tmpPath, fullPath);
}

/* =========================================================
   ✅ 保存前備份
   - 備份路徑：prompts_backups/<filename>/<timestamp>__<note>.<ext>
   - note 可選（前端如果有填，就會帶來更好找）
   ========================================================= */
function backupBeforeWrite(filename, dataStr, note = "") {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const baseDir = path.join(BACKUP_DIR, filename);
  fs.mkdirSync(baseDir, { recursive: true });

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");

  /* ✅ note 做最小清洗，避免檔名怪怪的 */
  const safeNote = String(note || "")
    .trim()
    .slice(0, 30)
    .replace(/[^\w\u4e00-\u9fa5\- ]/g, "")
    .replace(/\s+/g, "_");

  const ext = path.extname(filename);
  const backupName = safeNote ? `${ts}__${safeNote}${ext}` : `${ts}${ext}`;
  const backupPath = path.join(baseDir, backupName);

  writeFileAtomic(backupPath, dataStr);

  /* =========================================================
     ✅ 保留最近 N 份（避免備份無限長）
     - 你想改數量就調這個
     ========================================================= */
  const KEEP = Number(process.env.PROMPT_BACKUP_KEEP || 50);

  try {
    const files = fs
      .readdirSync(baseDir)
      .filter((f) => f.endsWith(ext))
      .sort()
      .reverse(); // 最新在前

    const toRemove = files.slice(KEEP);
    for (const f of toRemove) {
      fs.unlinkSync(path.join(baseDir, f));
    }
  } catch (e) {
    /* ✅ 清理失敗不影響主流程 */
  }

  return { backupName };
}

/* =========================================================
   ✅ 寫入 prompt（含備份）
   - filename：白名單檔
   - content：json object 或 string
   - note：可選（做版本註記）
   ========================================================= */
function savePromptFile({ filename, content, note }) {
  if (!ALLOW_FILES.has(filename)) {
    const err = new Error("filename not allowed");
    err.status = 400;
    throw err;
  }

  const ext = path.extname(filename).toLowerCase();
  const fullPath = path.join(PROMPT_DIR, filename);

  let dataStr = "";

  if (ext === ".json") {
    /* ✅ JSON：先確保能 stringify（避免前端傳怪東西） */
    dataStr = JSON.stringify(content, null, 2);
  } else {
    /* ✅ txt：強制轉字串 */
    dataStr = String(content ?? "");
  }

  /* ✅ 保存前先備份（備份的是「即將寫入的新內容」） */
  const { backupName } = backupBeforeWrite(filename, dataStr, note);

  /* ✅ 再寫入正式檔案（原子寫入） */
  writeFileAtomic(fullPath, dataStr);

  return {
    ok: true,
    filename,
    backupId: backupName,
  };
}

/* =========================================================
   ✅ 匯出整包（目前四個檔案）
   - 回傳一個物件，讓路由層決定怎麼下載
   ========================================================= */
function exportMiniBaziBundle() {
  const now = new Date().toISOString();

  const bundle = {
    meta: {
      group: "minibazi",
      exportedAt: now,
    },
    files: {},
  };

  for (const filename of ALLOW_FILES) {
    const { type, content } = readPromptFile(filename);
    bundle.files[filename] = { type, content };
  }

  return bundle;
}

/* =========================================================
   ✅ 列出某檔案備份列表（由新到舊）
   ========================================================= */
function listBackups(filename) {
  if (!ALLOW_FILES.has(filename)) {
    const err = new Error("filename not allowed");
    err.status = 400;
    throw err;
  }

  const baseDir = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(baseDir)) return [];

  const ext = path.extname(filename);

  return fs
    .readdirSync(baseDir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .reverse()
    .map((f) => ({
      id: f, // ✅ 下載用
      filename,
    }));
}

/* =========================================================
   ✅ 取得某份備份檔案的完整路徑（給下載用）
   ========================================================= */
function getBackupPath(filename, id) {
  if (!ALLOW_FILES.has(filename)) {
    const err = new Error("filename not allowed");
    err.status = 400;
    throw err;
  }

  const baseDir = path.join(BACKUP_DIR, filename);
  const fullPath = path.join(baseDir, id);

  if (!fs.existsSync(fullPath)) {
    const err = new Error("backup not found");
    err.status = 404;
    throw err;
  }

  return fullPath;
}

module.exports = {
  readPromptFile,
  savePromptFile,
  exportMiniBaziBundle,
  listBackups,
  getBackupPath,
};
