/* =========================================================
   promptStore.file.js
   目的：
   1) 把 prompt 從 server.js 抽出去，改成讀檔（prompts/minibazi.json）
   2) 支援「熱更新」：你改 JSON 檔存檔後，不用重啟後端就會生效
   3) 用 mtimeMs 做簡單快取：避免每次呼叫 AI 都打磁碟讀檔

   設計理由（照實說）：
   - 你現在 prompt 內文很長，放在 server.js 每次改都要 git/pull/restart，迭代很痛
   - 直接 fs.readFileSync 每次都讀檔也可以，但高頻呼叫會浪費 I/O
   - mtimeMs 快取是最簡單可靠、又不用引入額外套件的方法
   ========================================================= */

const fs = require("fs");
const path = require("path");

/* ---------------------------------------------------------
   快取結構：
   - cache.mtimeMs：記住檔案最後修改時間
   - cache.json：記住 parse 後的 JSON 物件
   --------------------------------------------------------- */
const cache = {
  mtimeMs: null,
  json: null,
};

/* ---------------------------------------------------------
   讀取並 parse JSON（只有在檔案變動時才重讀）
   - filePath：minibazi.json 的路徑
   --------------------------------------------------------- */
function loadJsonIfChanged(filePath) {
  /* 取檔案狀態（mtimeMs 會在你存檔時變動） */
  const stat = fs.statSync(filePath);

  /* 若 cache 存在且 mtime 沒變，就直接回傳 cache */
  if (cache.json && cache.mtimeMs === stat.mtimeMs) {
    return cache.json;
  }

  /* 讀檔 + parse（這裡若 JSON 格式壞掉，會直接 throw，方便你立刻發現） */
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  /* 更新 cache */
  cache.mtimeMs = stat.mtimeMs;
  cache.json = parsed;

  return parsed;
}

/* ---------------------------------------------------------
   組出 MiniBazi 的 systemPrompt（把 placeholder 換回動態內容）
   - genderHintForSystem：你原本在 server.js 內組的那段男命/女命語氣提示
   回傳：string systemPrompt
   --------------------------------------------------------- */
function getMiniBaziSystemPrompt(genderHintForSystem = "") {
  /* 允許用 env 覆蓋 prompt 資料夾位置（之後你想搬路徑會更方便） */
  const promptDir = process.env.PROMPT_DIR || path.join(__dirname, "prompts");
  const filePath = path.join(promptDir, "minibazi.json");

  const json = loadJsonIfChanged(filePath);

  /* 防呆：如果 JSON 結構不如預期，就給清楚錯誤，避免默默用空字串導致 AI 跑偏 */
  if (!json || !Array.isArray(json.systemPromptParts)) {
    throw new Error("[promptStore] minibazi.json missing systemPromptParts[]");
  }

  /* 逐段拼起來，並替換 placeholder */
  const systemPrompt = json.systemPromptParts
    .map((part) => {
      const s = String(part || "");
      return s.replace("{{genderHintForSystem}}", genderHintForSystem || "");
    })
    .join("");

  return systemPrompt;
}

module.exports = {
  getMiniBaziSystemPrompt,
};
