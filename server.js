const express = require("express");
const cors = require("cors");
/* =========================
  【Node 內建模組】
  - fs：讀寫檔
  - path：組路徑（避免 OS 差異）
========================== */
const fs = require("fs");
const path = require("path");
require("dotenv").config(); //LINE env

// LINE 通知相關
const {
  notifyNewBooking,
  notifyCustomerBooking,
  pushText,
  pushFlex,
  sendBookingSuccessHero,
  sendBaziMenuFlex,
  sendMiniBaziResultFlex,
  sendGenderSelectFlex,
  mbMenu,
  mbPage,
  mbAll,
  mbInfo,
  sendBaziMatchResultFlex,
  sendLiuYaoMenuFlex,
  sendLiuYaoTimeModeFlex,
} = require("./lineClient");

/* ==========================================================
  ✅ Articles - 檔案路徑與工具函式（先做工具，不先開 API）
  目的：
  1) articles 放在專案根目錄：./articles
  2) index.json 維護文章列表（給前台列表 / prerender / sitemap 用）
  3) 每次寫入前自動備份（跟 prompts 同一套思路：敢改、可回滾）
  【articles 根目錄】
  - process.cwd()：以「執行 server.js 的專案根」為基準
  - 你要求：articles 與 prompts 同層、放根目錄
========================== */
const ARTICLES_DIR = path.join(process.cwd(), "articles");
const ARTICLES_BACKUP_DIR = path.join(ARTICLES_DIR, "_backups");
const ARTICLES_INDEX_PATH = path.join(ARTICLES_DIR, "index.json");

/* =========================
  【工具】確保資料夾存在
========================== */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/* =========================
  【工具】安全讀 JSON（檔案不存在就回 fallback）
========================== */
function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    // ⚠️ 讀檔/JSON 壞掉時，回 fallback，避免整個 API 掛掉
    return fallback;
  }
}

/* =========================
  【工具】寫 JSON（格式化，方便你 git diff / 讀檔）
========================== */
function writeJsonPretty(filePath, data) {
  const raw = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, raw, "utf-8");
}

/* =========================
  【工具】產生時間戳（用於備份檔名）
  格式：YYYYMMDD_HHMMSS
========================== */
function getTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/* =========================
  【工具】備份檔案（寫入前先備份）
  - 目的：任何更新都可回滾
  - 存放：articles/_backups/
========================== */
function backupFileIfExists(filePath, note = "") {
  if (!fs.existsSync(filePath)) return;

  ensureDir(ARTICLES_BACKUP_DIR);

  const ts = getTs();
  const base = path.basename(filePath);

  // ✅ 備份檔名：<ts>__<base>__<note>.bak
  const safeNote = String(note || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-\.]/g, "")
    .slice(0, 40);

  const backupName = safeNote
    ? `${ts}__${base}__${safeNote}.bak`
    : `${ts}__${base}.bak`;

  const backupPath = path.join(ARTICLES_BACKUP_DIR, backupName);

  fs.copyFileSync(filePath, backupPath);
}

/* =========================
  【工具】讀取文章索引 index.json
  - 統一回傳格式：{ items: [] }
========================== */
function loadArticlesIndex() {
  ensureDir(ARTICLES_DIR);

  const idx = readJsonSafe(ARTICLES_INDEX_PATH, { items: [] });

  // ✅ 防呆：確保 items 一定是陣列
  if (!idx || !Array.isArray(idx.items)) return { items: [] };
  return idx;
}

/* =========================
  【工具】保存文章索引 index.json（保存前先備份）
========================== */
function saveArticlesIndex(nextIndex, note = "index_save") {
  ensureDir(ARTICLES_DIR);

  // ✅ 寫入前備份，避免手滑改爆
  backupFileIfExists(ARTICLES_INDEX_PATH, note);

  writeJsonPretty(ARTICLES_INDEX_PATH, nextIndex);
}

/* =========================
  【工具】取得單篇文章路徑（每篇一個資料夾）
  articles/<slug>/
    - meta.json
    - article.json
    - article.html
    - assets/（圖片）
========================== */
function getArticleDir(slug) {
  return path.join(ARTICLES_DIR, slug);
}
function getArticleMetaPath(slug) {
  return path.join(getArticleDir(slug), "meta.json");
}
function getArticleJsonPath(slug) {
  return path.join(getArticleDir(slug), "article.json");
}
function getArticleHtmlPath(slug) {
  return path.join(getArticleDir(slug), "article.html");
}
function getArticleAssetsDir(slug) {
  return path.join(getArticleDir(slug), "assets");
}

//AI 訊息回覆相關
const { AI_Reading } = require("./aiClient");
//把 API 八字資料整理成：給 AI 用的摘要文字
const { getBaziSummaryForAI } = require("./baziApiClient");
/* =========================================================
   引入 prompt 讀取器
   目的：
   - systemPrompt 從 JSON 讀取，改文案不用重啟/部署
   - genderHintForSystem 仍保留動態插入
   ========================================================= */
const {
  getMiniBaziSystemPrompt,
  getMiniBaziUserTemplate,
  getMiniBaziHowToBlock,
  getMiniBaziModeCopy,
} = require("./promptStore.file");
//六爻相關
const { getLiuYaoGanzhiForDate, getLiuYaoHexagram } = require("./lyApiClient");
const { describeSixLines, buildElementPhase } = require("./liuYaoParser");

/* 
  ✅ 後台 Admin API 也需要查 Postgres
  - 你專案已經把 pg Pool 集中在 ./db（accessStore.pg.js 也這樣用）
  - 所以 server.js 也用同一個 pool，不要再 require("pg") / new Pool
  - 好處：連線集中管理、避免重複建立、避免連線數炸裂
*/
const { pool } = require("./db");

/* 
==========================================================
✅ Admin Logs - PostgreSQL 版（只記你指定的點）
==========================================================
✅ 為什麼這樣做：
- 不把所有 console.log 寫進 DB（太多、太吵、太吃 I/O）
- 你只要在「你覺得重要」的地方改成 adminLogDB(...) 就會入庫
- created_at 用 DB NOW()（UTC），查詢時再轉台灣時間字串回前端
==========================================================
*/
async function adminLogDB(level, tag, message, options = {}) {
  try {
    const lv = String(level || "info").toLowerCase();
    const tg = String(tag || "app");
    const msg = String(message || "");

    /* 
      ✅ options 可帶：
      - userId: 方便用 user_id 查
      - meta: 任何你想記的 JSON（action、feature、payload片段、錯誤訊息…）
      - alsoConsole: 是否也要 console.log（預設 true）
    */
    const userId = options.userId ? String(options.userId) : null;
    const meta =
      options.meta && typeof options.meta === "object" ? options.meta : {};
    const alsoConsole = options.alsoConsole === true;

    /* ✅ 你原本習慣的 console.log 也保留（方便用 pm2 log 看即時） */
    if (alsoConsole) {
      console.log(
        `[ADMIN_LOG_DB][${lv}][${tg}]`,
        msg,
        userId ? `user=${userId}` : "",
        meta,
      );
    }

    /* ✅ 寫入 DB（只要你呼叫它才會寫） */
    await pool.query(
      `
      INSERT INTO admin_logs (level, tag, user_id, message, meta)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [lv, tg, userId, msg, JSON.stringify(meta)],
    );
  } catch (err) {
    /* 
      ✅ 寫 log 不能把主流程搞掛
      - 所以這裡只印錯誤，不 throw
    */
    console.error("[adminLogDB] insert failed:", err.message || err);
  }
}

// ==========================
// ✅ 綠界：工具（單號 + CheckMacValue）
// 用途：導轉付款需要簽章；ReturnURL 也要驗證簽章
// ==========================
const crypto = require("crypto");
const paymentOrders = require("./paymentOrdersStore.pg");
// ⚠️ getEligibility 是你原本就有的那個 function（在哪裡就從哪裡 require/使用）

const PRICE_MAP = {
  liuyao: 99,
  minibazi: 99,
  bazimatch: 199,
};

function genMerchantTradeNo() {
  return `FH${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

// ==========================
// ✅ 綠界需要的時間格式：yyyy/MM/dd HH:mm:ss（台灣時間）
// ==========================
function formatEcpayDate(date = new Date()) {
  // 轉成台灣時間（UTC+8）
  const d = new Date(date.getTime() + 8 * 60 * 60 * 1000);

  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const MM = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const HH = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());

  return `${yyyy}/${MM}/${dd} ${HH}:${mm}:${ss}`;
}

// ==========================
// ✅ 綠界 CheckMacValue 計算（SHA256）
// 重點：URL Encode 必須符合綠界 .NET encoding(ecpay) 規則
// - %2d -> -
// - %5f -> _
// - %2e -> .
// - space -> +
// - ! * ( ) 保留
// ==========================
// ✅ 支援 SHA256 / MD5
function generateCheckMacValue(params, hashKey, hashIV, algo = "sha256") {
  const data = {};
  for (const k of Object.keys(params)) {
    if (k === "CheckMacValue") continue;
    const v = params[k];
    data[k] = v === undefined || v === null ? "" : String(v);
  }

  const sortedKeys = Object.keys(data).sort((a, b) => a.localeCompare(b));
  const raw = sortedKeys.map((k) => `${k}=${data[k]}`).join("&");
  const toEncode = `HashKey=${hashKey}&${raw}&HashIV=${hashIV}`;

  let encoded = encodeURIComponent(toEncode).toLowerCase();
  encoded = encoded
    .replace(/%20/g, "+")
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")");

  return crypto.createHash(algo).update(encoded).digest("hex").toUpperCase();
}

// ==========================
// ✅ 綠界：工具code結尾處
// ==========================

// 付費權限用法：
// - featureKey 用 "liuyao" / "bazimatch"（之後擴充就加字串）
// - guest 目前先擋掉（不解）
// - first_time/coupon/付費：允許使用高階模型（由 divinationType 控制）
/*
| 階段        | 使用的 function                      |
| --------- | --------------------------------- |
| 功能入口 gate | `getUser` + `getEligibility`      |
| 優惠碼輸入     | `redeemCoupon` + `saveUser`       |
| AI 成功後    | `consumeEligibility` + `saveUser` |
| 金流完成      | `saveUser`（補 credits / paid）      |
*/
const {
  getUser,
  consumeQuotaAtomic,
  addQuotaAtomic,
  consumeFirstFreeAtomic,
  markCouponRedeemedAtomic,
} = require("./accessStore.pg");
const { getEligibility, parseCouponRule } = require("./accessControl");

// 先創造 app
const app = express();

// 讓前端可以跨域/丟 JSON 進來
app.use(cors());
app.use(express.json()); // 讓 POST JSON 讀得懂

// 預約資料要存的檔案位置
const DATA_FILE = path.join(__dirname, "bookings.json");

// 不開放設定檔（之後後台會寫這個）
const UNAVAILABLE_FILE = path.join(__dirname, "unavailable.json");

// 簡易後台 Token（正式上線可以改成環境變數）
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-secret";

/***************************************
 * [簡轉繁]：用 OpenCC（s2t）
 ***************************************/
const OpenCC = require("opencc-js");

let _s2t;
function toTW(str = "") {
  if (!_s2t) _s2t = OpenCC.Converter({ from: "cn", to: "tw" });
  return _s2t(String(str || ""));
}

//時間helper 目前只有在送「退神」按鈕有用到
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// server.js

// ===== MiniBazi UI cache (in-memory) =====
// 先用記憶體，之後要換 Redis/DB 很容易
const mbCache = {}; // { [userId]: { birthDesc, mode, aiText, pillarsText, fiveElementsText, ts } }
const MB_TTL = 30 * 60 * 1000; // 30 分鐘

//在你完成測算後，把 payload 存到 cache（避免使用者點主題時還要重算/重打）
//handleLineEvent 最前面攔截 MB|...，把它導去 lineClient 的 mbMenu/mbPage/mbAll
function mbSave(userId, payload) {
  mbCache[userId] = { ...payload, ts: Date.now() };
}

function mbGet(userId) {
  const c = mbCache[userId];
  if (!c) return null;
  if (Date.now() - c.ts > MB_TTL) {
    delete mbCache[userId];
    return null;
  }
  return c;
}
/////////////////MiniBazi UI cache

// ✅ 合婚「分享解鎖」暫存（記憶體版，重啟會清掉）
const baziMatchShareCache = new Map(); // userId -> { payload, createdAt }
const BAZI_MATCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 分鐘

function cacheBaziMatchResult(userId, payload) {
  baziMatchShareCache.set(userId, { payload, createdAt: Date.now() });
}

function getCachedBaziMatchResult(userId) {
  const hit = baziMatchShareCache.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > BAZI_MATCH_CACHE_TTL_MS) {
    baziMatchShareCache.delete(userId);
    return null;
  }
  return hit.payload;
}

function clearCachedBaziMatchResult(userId) {
  baziMatchShareCache.delete(userId);
}

//////// ✅ 合婚「分享解鎖」暫存

//////載入 couponRules（一次）
const COUPON_RULES_PATH =
  process.env.COUPON_RULES_PATH || path.join(__dirname, "couponRules.json");

function loadCouponRules() {
  try {
    const raw = fs.readFileSync(COUPON_RULES_PATH, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("[COUPON] Failed to load couponRules.json:", e.message);
    return {};
  }
}
//////載入 couponRules（一次）

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// 系統所有可用時段（中心真相）——之後前端/後台都應該跟這個一致
const ALL_TIME_SLOTS = [
  //"09:00-10:00",
  //"10:30-11:30",
  //"14:00-15:00",
  //"15:30-16:30",
  "19:00-20:00(線上)",
  "20:00-21:00(線上)",
  "21:00-22:00(線上)",
];

// 🔹 服務代碼 → 顯示名稱
const SERVICE_NAME_MAP = {
  bazi: "八字諮詢",
  ziwei: "紫微斗數",
  name: "改名 / 姓名學",
  fengshui: "風水勘察",
  liuyao: "六爻占卜",

  chat_line: "命理諮詢", // 預設用在聊天預約沒特別指定時
};

//六爻主題標題共用區
const LIU_YAO_TOPIC_LABEL = {
  love: "感情",
  career: "事業",
  wealth: "財運",
  health: "健康",
};

/* =========================================================
 * STEP 1：常見問題「大類」Carousel（先做大類選單）
 * - 先不展開到「題目清單」
 * - 先讓按鈕能送出 postback：action=choose_qcat&cat=xxx
 * ========================================================= */

/* 【1-1】定義「問題大類」資料（先做大類就好）
 * - id：短代碼（postback 用，避免 data 太長）
 * - title：顯示在 Flex 的標題
 * - desc：一句話描述，讓使用者知道這類在問什麼
 * - emoji：讓大類更直覺//回朔
 */
const QUESTION_CATEGORIES = [
  {
    id: "love",
    emoji: "❤️",
    title: "感情 / 桃花 / 復合",
    desc: "復合、曖昧、對方心意、婚姻去留、真愛時間點",
  },
  {
    id: "career",
    emoji: "💼",
    title: "工作 / 職涯 / 事業 / 小人",
    desc: "留不留公司、換工作、升遷加薪、創業方向、天賦",
  },
  {
    id: "money",
    emoji: "💰",
    title: "財運 / 破財 / 偏財",
    desc: "今年財運、破財風險、偏財與額外收入、創業會不會賠",
  },
  {
    id: "year",
    emoji: "🧭",
    title: "流年 / 整體運勢",
    desc: "年度趨勢、關鍵月份、要注意的坑與機會",
  },
  {
    id: "family",
    emoji: "👪",
    title: "家庭 / 親子",
    desc: "父母伴侶磨合、孩子學業、人際小人與阻礙",
  },
  {
    id: "name",
    emoji: "🪪",
    title: "名字 / 形象 / 定位",
    desc: "名字給人的第一印象、需要調整嗎、走專業或親和",
  },
  {
    id: "house",
    emoji: "🏠",
    title: "房產 / 置產決策",
    desc: "房子能不能買、適不適合入手、風險點在哪",
  },
];

//全域中斷
function isAbortCommand(text) {
  const t = (text || "").trim();
  return ["取消", "回主選單", "主選單", "選單", "重來", "重新開始"].includes(t);
}
//全域中斷
function isEntryCommand(text) {
  const t = (text || "").trim();
  return [
    "預約",
    "八字測算",
    "小占卜",
    "八字合婚",
    "六爻占卜",
    "關於我",
    "我的主官網",
    "官網",
  ].includes(t);
}

function loadBookings() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error("讀取 bookings.json 發生錯誤：", err);
    return [];
  }
}

function saveBookings(bookings) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2), "utf-8");
    console.log("已寫入 bookings.json，共", bookings.length, "筆預約");
  } catch (err) {
    console.error("寫入 bookings.json 發生錯誤：", err);
  }
}

// 讀取不開放設定（沒有檔案時回傳預設空物件）
function loadUnavailable() {
  try {
    if (!fs.existsSync(UNAVAILABLE_FILE)) {
      return { fullDay: [], slots: [] };
    }
    const raw = fs.readFileSync(UNAVAILABLE_FILE, "utf-8");
    if (!raw.trim()) return { fullDay: [], slots: [] };
    return JSON.parse(raw);
  } catch (err) {
    console.error("讀取 unavailable.json 發生錯誤：", err);
    return { fullDay: [], slots: [] };
  }
}

// 不開放設定的存檔
function saveUnavailable(unavailable) {
  try {
    fs.writeFileSync(
      UNAVAILABLE_FILE,
      JSON.stringify(unavailable, null, 2),
      "utf-8",
    );
    console.log("已寫入 unavailable.json");
  } catch (err) {
    console.error("寫入 unavailable.json 發生錯誤：", err);
  }
}

function getSlotsForDate(date) {
  const bookings = loadBookings();
  const unavailable = loadUnavailable();

  // 這一天是否整天不開放
  const isFullDayBlocked =
    Array.isArray(unavailable.fullDay) && unavailable.fullDay.includes(date);

  // 這一天被你標記為不開放的時段
  const blockedSlotsForDate = [];
  if (Array.isArray(unavailable.slots)) {
    unavailable.slots
      .filter((u) => u.date === date)
      .forEach((u) => {
        if (Array.isArray(u.timeSlots)) {
          blockedSlotsForDate.push(...u.timeSlots);
        }
      });
  }

  // 這一天已被預約的時段（從 bookings.json 算出來）
  const bookedSlotsForDate = [];
  bookings
    .filter((b) => b.date === date)
    .forEach((b) => {
      const slots = Array.isArray(b.timeSlots)
        ? b.timeSlots
        : b.timeSlot
          ? [b.timeSlot]
          : [];
      bookedSlotsForDate.push(...slots);
    });

  // 產生這一天所有 slot 的狀態
  return ALL_TIME_SLOTS.map((slot) => {
    if (isFullDayBlocked || blockedSlotsForDate.includes(slot)) {
      return { timeSlot: slot, status: "blocked" };
    }
    if (bookedSlotsForDate.includes(slot)) {
      return { timeSlot: slot, status: "booked" };
    }
    return { timeSlot: slot, status: "open" };
  });
}

// 🔹 簡單的對話狀態（記在記憶體裡）
// key = userId, value = { stage: "waiting_name" | "waiting_phone" | "waiting_note", data: {...} }
const conversationStates = {};

// 把陣列切成「每 chunkSize 個一組」
function chunkArray(arr, chunkSize) {
  const result = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    result.push(arr.slice(i, i + chunkSize));
  }
  return result;
}

// ✅ 取得未來 N 天內「有 open 時段」的日期列表（給日期 Carousel 用）
// - showCount：你想顯示幾個「可約日期」
// - scanDays：最多往後掃幾天（避免一直掃到宇宙盡頭）
function getNextAvailableDays(showCount, scanDays = 60) {
  const results = [];
  const base = new Date();
  const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];

  // ✅ 先讀一次，避免每個日期都讀檔
  const bookings = loadBookings();
  const unavailable = loadUnavailable();

  for (let i = 0; i < scanDays; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const w = weekdayNames[d.getDay()];

    // 只要這天有任何 open slot，就收進清單
    if (hasOpenSlotOnDate(dateStr, bookings, unavailable)) {
      results.push({
        dateStr,
        label: `${dateStr}（${w}）`,
      });
    }

    // 收滿就停（顧客只看到「可約」的日期）
    if (results.length >= showCount) break;
  }

  return results;
}
// ✅ 取得未來 N 天內「有 open 時段」的日期列表（給日期 Carousel 用）
// - showCount：你想顯示幾個「可約日期」
// - scanDays：最多往後掃幾天（避免一直掃到宇宙盡頭）
// ✅ 判斷某日是否至少有 1 個 open slot（用同一套規則：fullDay / blockedSlots / bookedSlots）
function hasOpenSlotOnDate(date, bookings, unavailable) {
  // 這一天是否整天不開放
  const isFullDayBlocked =
    Array.isArray(unavailable.fullDay) && unavailable.fullDay.includes(date);

  if (isFullDayBlocked) return false;

  // 這一天被你標記為不開放的時段
  const blockedSlotsForDate = [];
  if (Array.isArray(unavailable.slots)) {
    unavailable.slots
      .filter((u) => u.date === date)
      .forEach((u) => {
        if (Array.isArray(u.timeSlots))
          blockedSlotsForDate.push(...u.timeSlots);
      });
  }

  // 這一天已被預約的時段
  const bookedSlotsForDate = [];
  bookings
    .filter((b) => b.date === date)
    .forEach((b) => {
      const slots = Array.isArray(b.timeSlots)
        ? b.timeSlots
        : b.timeSlot
          ? [b.timeSlot]
          : [];
      bookedSlotsForDate.push(...slots);
    });

  // 只要存在一個 slot 同時不是 blocked、也不是 booked，就代表可預約
  return ALL_TIME_SLOTS.some((slot) => {
    if (blockedSlotsForDate.includes(slot)) return false;
    if (bookedSlotsForDate.includes(slot)) return false;
    return true;
  });
}

// 🔹 取得未來 N 天的日期列表（給日期 Carousel 用）
function getNextDays(count) {
  const results = [];
  const base = new Date();
  const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];

  for (let i = 0; i < count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const w = weekdayNames[d.getDay()];

    results.push({
      dateStr,
      label: `${dateStr}（${w}）`,
    });
  }

  return results;
}

//檢查使用者付費/權限的入口函式
async function gateFeature(userId, featureKey, featureLabel) {
  const userRecord = await getUser(userId);
  const eligibility = getEligibility(userRecord, featureKey);

  if (!eligibility.allow) {
    await pushText(
      userId,
      `🔒 ${featureLabel} 目前需要「首次體驗 / 優惠碼 / 付款」才能使用。\n\n` +
        `✅ 若你有優惠碼，直接輸入即可（例如：FREE66）\n` +
        `或完成付款後再回來啟用。`,
    );
    return { allow: false, source: "none" };
  }

  // ✅ 入口先講清楚：這次到底是免費還是扣次數
  if (eligibility.source === "firstFree") {
    await pushText(userId, `🎁 你是首次體驗，這次 ${featureLabel} 免費一次。`);
  } else if (eligibility.source === "quota") {
    const remaining = Number(userRecord.quota?.[featureKey] || 0);
    await pushText(
      userId,
      `✅ 你目前還有 ${remaining} 次 ${featureLabel} 可用次數。`,
    );
  }

  // 入口只檢查 + 提示，不扣次
  return { allow: true, source: eligibility.source };
}

//扣quota原子扣
async function quotaUsage(userId, feature) {
  // ① 先吃首免（原子）
  const ff = await consumeFirstFreeAtomic(userId, feature, 1);
  if (ff.ok) {
    console.log(`[quotaUSAGE] OK firstFree user=${userId} feature=${feature}`);
    return true;
  }

  // ② 再扣 quota（原子）
  const q = await consumeQuotaAtomic(userId, feature, 1);
  if (!q.ok) {
    console.log(`[quotaUSAGE] NO_QUOTA user=${userId} feature=${feature}`);
    return false;
  }

  console.log(`[quotaUSAGE] OK quota user=${userId} feature=${feature}`);
  return true;
}

/**
 * 嘗試從使用者輸入文字中兌換優惠碼（流程攔截用）
 *
 * 使用時機：
 * - 只在「付費功能流程中」（六爻 / 八字合婚 / 八字測算）呼叫
 * - 在進入各 handleXXXFlow 之前攔截
 *
 * 行為說明：
 * - 若 text 看起來是優惠碼（FREE99 / 優惠碼 FREE99）
 *   → 嘗試兌換並增加對應 feature 的 quota
 *   → 成功或失敗都會主動回覆使用者
 *   → 回傳 { handled: true }，流程應中斷
 *
 * - 若 text 不是優惠碼
 *   → 不處理、不回覆
 *   → 回傳 { handled: false }，流程繼續往下走
 *
 * 注意事項：
 * - 成功兌換後不改變對話 state（不影響目前流程階段）
 * - 同一使用者同一優惠碼只能兌換一次
 * - 僅負責「兌換 + 回覆」，不負責 gate 或扣次
 *
 * @param {string} userId - LINE 使用者 ID
 * @param {string} text - 使用者輸入文字
 * @returns {Promise<{handled: boolean}>}
 */
async function tryRedeemCouponFromText(userId, text) {
  const input = String(text || "").trim();
  if (!input) return { handled: false };

  // 支援兩種：FREE99 / 優惠碼 FREE99
  let code = "";
  const m = input.match(/^(優惠碼|coupon|COUPON)\s+([A-Za-z0-9_-]+)$/i);
  if (m) code = m[2];
  if (!code && /^[A-Za-z0-9_-]{4,20}$/.test(input)) code = input;

  if (!code) return { handled: false };

  try {
    const couponRules = loadCouponRules();

    // ✅ 1) 只解析 / 驗證規則（不寫 DB）
    const {
      code: normalizedCode,
      feature,
      added,
    } = parseCouponRule(code, couponRules);

    // ✅ 2) 原子標記：同一人同一券只能成功一次（防連點/併發/重送）
    const mark = await markCouponRedeemedAtomic(userId, normalizedCode);
    if (!mark.ok) {
      throw new Error(
        `[COUPON_ERROR] coupon already redeemed: ${normalizedCode}`,
      );
    }

    // ✅ 3) 原子補次（真的加 quota）
    await addQuotaAtomic(userId, feature, added);

    await pushText(
      userId,
      `✅ 優惠碼兌換成功：${normalizedCode}\n` +
        `已增加「${feature}」可用次數：+${added}\n\n` +
        `你可以繼續輸入你的資料，我會接著幫你解。`,
    );

    console.log(
      `[COUPON] user=${userId} code=${normalizedCode} feature=${feature} added=${added}`,
    );

    return { handled: true };
  } catch (e) {
    await pushText(
      userId,
      `❌ 優惠碼兌換失敗：${e.message.replace(/^\[.*?\]\s*/, "")}\n` +
        `（提示：同一張券同一人只能用一次，或可能已過期）`,
    );

    console.warn(`[COUPON] redeem failed user=${userId} err=${e.message}`);
    return { handled: true };
  }
}

/* 【1-2】丟出「大類」Carousel Flex///回朔
 * - 每一頁一個大類（更乾淨、滑起來像選單）
 * - 每頁一顆「選這類」按鈕：postback 帶 action=choose_qcat&cat=love
 */
async function sendQuestionCategoryCarouselFlex(userId) {
  /* 這裡用 bubble 一頁一類，視覺很像「分類選單」 */
  const bubbles = QUESTION_CATEGORIES.map((c) => ({
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        /* 大標：emoji + 類別名稱 */
        {
          type: "text",
          text: `${c.emoji} ${c.title}`,
          size: "lg",
          weight: "bold",
          wrap: true,
        },

        /* 描述：讓使用者知道這類大概會問什麼 */
        {
          type: "text",
          text: c.desc,
          size: "sm",
          color: "#666666",
          wrap: true,
        },

        /* 主按鈕：選這類 */
        {
          type: "button",
          style: "primary",
          color: "#bdafa7ff",
          height: "sm",
          action: {
            type: "postback",
            label: "選這類",
            data: `action=choose_qcat&cat=${c.id}`,
            displayText: `我想問：${c.title}`,
          },
        },

        /* 次要提示：先不做功能，只是讓使用者安心 */
        {
          type: "text",
          text: "選完我會再讓你挑更貼近的問題，然後直接帶你去預約。",
          size: "xs",
          color: "#888888",
          wrap: true,
        },
      ],
    },
  }));

  const carousel = {
    type: "carousel",
    contents: bubbles,
  };

  await pushFlex(userId, "你想問哪一類？", carousel);
}

/* =========================================================
 * STEP 2：大類 → 題目清單 Carousel → 選題 → 導入 booking//回朔2
 * 你會新增：
 * 1) QUESTION_BANK：每個大類對應的題目清單
 * 2) sendQuestionListCarouselFlex：丟出題目清單 Carousel
 * 3) routePostback：新增 action=choose_q / show_qcats
 * 4) handleBookingPostback：做 data merge，避免覆蓋掉題目資料
 * ========================================================= */

/* 【2-0】保險：如果你原本沒有 chunkArray，就補一個//回朔2
 * - 你的 sendDateCarouselFlex 已經用過 chunkArray
 * - 但我不確定你檔案上面是否有實作
 * - 沒有的話，這段會讓你不會炸掉
 */
if (typeof chunkArray !== "function") {
  //回朔2
  /* 把陣列切成固定大小的小段 */
  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }
}

/* 【2-1】題庫：把你整理的題目放進各大類//回朔2
 * - qid：短代碼（postback 用，避免 data 太長）
 * - label：按鈕顯示用（建議短一點，避免 LINE 按鈕字數限制）
 * - full：完整題目（你後續寫入 note 或顯示用）
 */
const QUESTION_BANK = {
  love: [
    { qid: "reconcile", full: "我們會復合嗎？" },
    { qid: "ex_contact", full: "前任會重新聯絡我嗎？" },
    { qid: "amb_next", full: "曖昧關係會往下一步發展嗎？" },
    { qid: "initiative", full: "我該主動表達還是等待？" },
    { qid: "third", full: "是否有潛在第三者需要注意？" },
    { qid: "continue", full: "這段關係該不該繼續走下去？" },
    { qid: "fix", full: "這段感情目前的問題該怎麼調整？" },
    { qid: "marry", full: "我們適合走向婚姻嗎？" },
    { qid: "peach", full: "我今年有沒有桃花？" },
    { qid: "meet", full: "什麼時候會遇到對的人？" },
    { qid: "letgo", full: "我應該如何放下過去的感情？" },
    { qid: "divorce", full: "這段婚姻該不該離？" },
  ],

  career: [
    { qid: "stay", full: "這間公司還待嗎？" },
    { qid: "valued", full: "我在公司會被重視嗎？" },
    { qid: "raise", full: "是否有升遷或加薪的機會？" },
    { qid: "change", full: "該不該換工作？" },
    { qid: "better", full: "換工作會比現在更好嗎？" },
    { qid: "study", full: "出國進修轉換跑道會順利嗎？" },
    { qid: "direction", full: "哪個方向的事業最有潛力？" },
    { qid: "startup", full: "我適合創業嗎？" },
    { qid: "five", full: "適合我的職業五行是什麼？" },
    { qid: "talent", full: "我的天賦與潛能在哪方面？" },
    { qid: "villain", full: "我在職場上容易有小人嗎？" },
  ],

  money: [
    { qid: "fortune", full: "今年的財運如何？" },
    { qid: "loss", full: "有破財風險需要留意嗎？" },
    { qid: "side", full: "是否有偏財運或額外收入？" },
    { qid: "startup_loss", full: "我適合創業嗎？會不會賠錢？" },
  ],

  year: [{ qid: "overall_2026", full: "我 2026 年的整體運勢如何？" }],

  family: [
    { qid: "parents", full: "如何化解與父母或伴侶間的矛盾？" },
    { qid: "kid", full: "我的孩子在學業狀況如何？" },
    { qid: "familyhealth", full: "我家人的疾病狀況？" },
  ],

  name: [
    { qid: "name_check", full: "這個名字對我好嗎？" },
    { qid: "kid_name", full: "想幫小孩子取名？" },
    { qid: "shop_name", full: "店名用什麼名字好？" },
  ],

  house: [
    { qid: "buy", full: "這間房子能買嗎？" },
    { qid: "sell", full: "賣掉這間房子好嗎？" },
  ],
};

/* 【2-2】丟出「題目清單」Carousel//回朔2
 * - 一頁放 3 題（你也可以改成 4）
 * - 每題按下去 → postback：action=choose_q&cat=love&q=reconcile
 * - 額外提供一顆「換類別」讓他回到分類 Carousel
 */
async function sendQuestionListCarouselFlex(userId, catId) {
  const cat = QUESTION_CATEGORIES.find((x) => x.id === catId);
  const list = QUESTION_BANK[catId] || [];

  if (!cat || list.length === 0) {
    await pushText(
      userId,
      "這個分類目前題庫還沒填好 🙏\n你可以先選其他類別，或直接輸入「預約」。",
    );
    return;
  }

  const groups = chunkArray(list, 4);

  const bubbles = groups.map((group) => ({
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "梵和易學｜選一個最貼近的問題",
          size: "sm",
          color: "#888888",
        },
        {
          type: "text",
          text: `${cat.emoji} ${cat.title}`,
          size: "lg",
          weight: "bold",
          wrap: true,
        },
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          margin: "md",
          contents: group.map((q) => ({
            type: "button",
            style: "link",
            height: "sm",
            action: {
              type: "postback",
              /* ✅ 按鈕上直接顯示完整問題 */
              label: q.full,
              data: `action=choose_q&cat=${catId}&q=${q.qid}`,
              /* ✅ 使用者聊天室顯示也用完整問題 */
              displayText: `我想問：${q.full}`,
            },
          })),
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: {
            type: "postback",
            label: "換類別",
            data: "action=show_qcats",
            displayText: "我想換一個問題分類",
          },
        },
        {
          type: "text",
          text: "選完題目後，我會直接帶你進預約流程。",
          size: "xs",
          color: "#888888",
          wrap: true,
        },
      ],
    },
  }));

  const carousel = { type: "carousel", contents: bubbles };
  await pushFlex(userId, "選一個最貼近的問題", carousel);
}

// 🔹 第一步：服務選擇 Flex（Carousel：八字 / 紫微 / 姓名 / 六爻(兩頁)）
// ------------------------------------------------------------
// ✅ 目的：把原本「四顆按鈕」改成「多頁產品型介紹」
// ✅ A 方案：六爻拆成 2 頁，但兩頁按鈕都走同一個 service=liuyao（不動後端流程）
// ✅ 不動結構：postback data 仍是 action=choose_service&service=xxx
// ------------------------------------------------------------
async function sendServiceSelectFlex(userId) {
  /***************************************
   * [0] 問題庫（你給的句子我直接分到不同頁）
   * - 不做隨機：我先「直接塞」，你之後要換內容自己改這裡
   * - 每頁盡量維持相近字量，滑起來比較舒服
   ***************************************/
  const Q = {
    // 姓名學（偏「自我/運勢/定位」）
    name: [
      "• 我名字好嗎？我想改名",
      "• 我在公司會被重視嗎？",
      "• 我的名字適合當老闆嗎？",
      "• 我想幫新生兒取名？",
      "• 我要如何讓工作更順利？",
      "• 不知道八字能算命嗎？",
    ],

    // 八字諮詢（偏「趨勢/節點」）
    bazi: [
      "• 我該如何提升愛情運與吸引力？",
      "• 哪個方向的事業最有潛力？",
      "• 我適合我的職業五行是什麼",
      "• 我的天賦與潛能在哪方面？",
    ],

    // 紫微斗數（偏「互動/關係模式」）
    ziwei: [
      "• 為什麼我總吸引到不合適的對象？",
      "• 是否有升遷或加薪的機會？",
      "• 出國、轉換跑道或進修會順利嗎？",
      "• 我的孩子在學業狀況如何？",
      "• 我和現任的緣分深嗎？",
      "• 我們適合走向婚姻嗎？",
      "• 我應該如何放下過去的感情？",
      "• 我適合創業嗎？",
      "• 有破財風險需要留意嗎？",
      "• 是否有偏財運或額外收入？",
      "• 什麼時候會遇到對的人？",
    ],

    // 六爻占卜：拆兩頁
    liuyao_1: [
      //感情現況/復合/前任
      "• 三個月內前任會重新聯絡我嗎？",
      "• 我們會復合嗎？",
      "• 若復合，這段感情有機會變得更成熟嗎？",
      "• 這段婚姻該不該離？",
      "• 我今年有沒有桃花？",
      "• 現在的曖昧關係會往下一步發展嗎？",
      "• 我該主動表達還是等待更好的時機？",
      "• 我容易在哪裡遇到真愛？",
      "• 是否有潛在第三者需要注意？",
      "• 這段關係該不該繼續走下去？",
      "• 這段感情目前的問題該怎麼調整？",
    ],
    liuyao_2: [
      "• 我 2026 年的整體運勢如何？",
      "• 換工作會比現在更好嗎？",
      "• 今年的財運如何？",
      "• 我創業會不會賠錢？",
      "• 有需要特別留意的小人或阻礙嗎？",
      "• 這間房子能買嗎？",
      "• 身體有要注意的地方嗎？",
    ],
  };

  /***************************************
   * [1] 服務清單（六爻拆兩頁）
   * - pageKey：用來對應上面 Q 的內容
   * - serviceId：真正送到後端的 service（六爻兩頁都用 liuyao）
   * - label：頁面大標
   * - badge：你現在用的 🏷️ 文字（可自行換）
   * - cta：依服務類型配最像「先聊聊」的一句（功能不變）
   ***************************************/
  const services = [
    // ✅ 六爻第 1 頁 (感情現況/復合/前任)
    {
      pageKey: "liuyao_1",
      serviceId: "liuyao",
      label: "六爻占卜(感情現況/復合/前任)",
      badges: ["🏷️ 想知道會不會回頭", "🏷️ 我想問這個"],
      cta: "我想問這個",
    },
    // ✅ 六爻第 2 頁
    {
      pageKey: "liuyao_2",
      serviceId: "liuyao",
      label: "六爻占卜(財運/事業/疾病)",
      badges: ["🏷️ 針對單一事件快狠準", "🏷️ 財運/事業/疾病/買房/官司"],
      cta: "我想問這個",
    },
    {
      pageKey: "name",
      serviceId: "name",
      label: "姓名學",
      badges: ["🏷️ 最推薦", "🏷️ 想先看名字適不適合我"],
      cta: "先幫我看一下",
    },
    {
      pageKey: "ziwei",
      serviceId: "ziwei",
      label: "紫微斗數",
      badges: ["🏷️ 看關係互動＆節點", "🏷️ 我想釐清一下狀態"],
      cta: "我比較需要這個",
    },
    {
      pageKey: "bazi",
      serviceId: "bazi",
      label: "八字諮詢",
      badges: ["🏷️ 先抓人生大方向", "🏷️ 我想從這裡開始"],
      cta: "從這裡開始",
    },
  ];

  /***************************************
   * [2] 產生 bubbles（每服務一頁）
   * - header/footer 不動你的風格
   * - 「適合什麼樣的人？」移到 header 的 separator 下方
   * - body 只放「問題清單」，字體稍微放大（xs -> sm）
   ***************************************/
  const bubbles = services.map((s) => {
    // ✅ 這頁要顯示的問題列表
    const questionLines = (Q[s.pageKey] || []).map((t) => ({
      type: "text",
      text: t, // 已含 "• "
      size: "sm", // ✅ 放大（原本多是 xs）
      color: "#333333",
      wrap: true,
      margin: "sm",
    }));

    return {
      type: "bubble",
      size: "mega",

      /***************************************
       * [2-1] Header：標題 + badges + 分隔線 + 「適合什麼樣的人？」
       ***************************************/
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "lg",
        spacing: "xs",
        contents: [
          {
            type: "text",
            text: s.label,
            weight: "bold",
            size: "xl", // ✅ 放大
            color: "#111111",
            wrap: true,
            margin: "sm",
          },

          // ✅ badges：上下排列（你已改成純文字版本）
          ...(Array.isArray(s.badges) && s.badges.length
            ? s.badges.slice(0, 2).map((b, i) => ({
                type: "text",
                text: b,
                size: "xs",
                color: "#635750",
                wrap: true,
                margin: i === 0 ? "sm" : "xs",
              }))
            : []),

          // ✅ 把「適合什麼樣的人？」往上拉：放在 header 的 separator 下方
          { type: "separator", margin: "md" },
          {
            type: "text",
            text: "適合什麼問題的人？",
            size: "sm",
            weight: "bold",
            color: "#111111",
            margin: "md",
          },
        ],
      },

      /***************************************
       * [2-2] Body：只放「問題清單」
       * - intro/highlights 都刪掉
       * - 維持閱讀舒服：spacing 用 sm / margin 用 sm
       ***************************************/
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "lg",
        spacing: "sm",
        contents: [...questionLines],
      },

      /***************************************
       * [2-3] Footer：CTA 換成「先聊聊」語氣，但功能一樣
       * - data: action=choose_service&service=xxx（不動）
       * - displayText: 仍可用，但不會自己改 state；真正改流程的是 postback data
       ***************************************/
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "lg",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#52a6c0ff",
            height: "sm",
            action: {
              type: "postback",
              label: s.cta, // ✅ 依服務類型配一句
              data: `action=choose_service&service=${s.serviceId}`,
              displayText: `我想先聊聊：${s.label}`,
            },
          },
        ],
      },
    };
  });

  /***************************************
   * [3] Carousel：一次送出多頁
   ***************************************/
  const flexPayload = {
    type: "carousel",
    contents: bubbles,
  };

  /***************************************
   * [4] 推送 Flex
   ***************************************/
  await pushFlex(userId, "請選擇預約服務", flexPayload);
}

//服務選擇說明卡 Flex（八字 / 紫微 / 姓名）
async function sendServiceIntroFlex(userId, serviceKey) {
  const map = {
    minibazi: {
      title: "📊 八字格局解析(LINE線上)",
      // ✅ 促銷顯示用：原價 / 特價（記得金流價格也要一致）
      originalPrice: "NT$ 199",
      salePrice: "NT$ 99",
      desc: "使用者完成付費並提供生辰資料後，系統將進行八字格局結構與整體命理配置之文字解析，並回傳解析結果。",
    },
    bazimatch: {
      title: "💑 八字合婚解析(LINE線上)",
      originalPrice: "NT$ 299",
      salePrice: "NT$ 199",
      desc: "使用者完成付費並提供雙方生辰資料後，系統將進行命盤結構比對與關係互動層面之文字解析說明，並回傳解析結果。",
    },
    liuyao: {
      title: "🔮 六爻卦象解析(LINE線上)",
      originalPrice: "NT$ 199",
      salePrice: "NT$ 99",
      desc: "使用者完成付費並提供提問內容後，系統將依卦象模型進行解析，回傳過去狀態、當前情況與可能發展趨勢之文字說明。",
    },
  };

  const meta = map[serviceKey];
  if (!meta) return;

  // ==========================
  // ✅ 只檢查資格，不扣 quota（決定主按鈕要顯示什麼）
  // ==========================
  const userRecord = await getUser(userId);
  const eligibility = getEligibility(userRecord, serviceKey);

  // ==========================
  // ✅ 主按鈕（最小改動）
  // - 首免：顯示「🎁 首次免費」→ 仍走 action=start
  // - 有 quota：顯示「開始解析」→ 走 action=start
  // - 無權限：顯示「前往付款」→ 導到 /pay 建單付款
  // ==========================
  let primaryButton;

  if (eligibility.allow) {
    const isFirstFree = eligibility.source === "firstFree";

    primaryButton = {
      type: "button",
      style: "primary",
      action: {
        type: "postback",
        label: isFirstFree ? "🎁 首次免費" : "開始解析",
        data: `action=start&service=${serviceKey}`,
      },
    };
  } else {
    primaryButton = {
      type: "button",
      style: "primary",
      action: {
        type: "uri",
        label: "前往付款",
        uri: `${process.env.BASE_URL}/pay?userId=${encodeURIComponent(
          userId,
        )}&feature=${encodeURIComponent(serviceKey)}`,
      },
    };
  }

  const flex = {
    type: "flex",
    altText: "LINE 線上服務說明",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: meta.title,
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: "數位文字解析服務",
            size: "sm",
            color: "#666666",
            wrap: true,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: meta.desc,
            size: "sm",
            color: "#333333",
            wrap: true,
          },

          // ==========================
          // ✅ 費用區塊（促銷版：原價刪節線 + 特價大字）
          // ==========================
          {
            type: "box",
            layout: "baseline",
            contents: [
              {
                type: "text",
                text: "費用",
                size: "sm",
                color: "#666666",
                flex: 1,
              },

              // 原價（灰色 + 刪節線）
              {
                type: "text",
                text: meta.originalPrice,
                size: "sm",
                color: "#999999",
                decoration: "line-through",
                flex: 1,
                align: "end",
              },

              // 特價（大字）
              {
                type: "text",
                text: meta.salePrice,
                size: "xl",
                weight: "bold",
                color: "#E53935",
                flex: 2,
                align: "end",
              },
            ],
          },

          { type: "separator" },
          {
            type: "text",
            text:
              "⚠️ 僅供參考，非結果保證\n" +
              "📌 付款完成並送出資料後即開始解析，恕不提供取消或退款\n",
            size: "xs",
            color: "#777777",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          primaryButton,
          {
            type: "button",
            style: "link",
            action: {
              type: "uri",
              label: "查看服務說明頁",
              uri: "https://liff.line.me/2008655591-g3ef9O6F",
            },
          },
        ],
      },
    },
  };

  await pushFlex(userId, flex.altText, flex.contents);
}

// 🔹 日期選擇 Carousel Flex（每一頁有多個「日期按鈕」，會帶著 serviceId）
async function sendDateCarouselFlex(userId, serviceId) {
  //
  const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

  // 想開放幾天自己決定：例如未來 30 天
  //const days = getNextDays(30);//原來不屏蔽不可預約時段前
  // ✅ 只顯示「有可預約時段」的日期
  // 你想顯示幾個可約日期：showCount = 30
  // 最多往後掃幾天：scanDays = 90（自己調）
  const days = getNextAvailableDays(30, 90);

  if (days.length === 0) {
    await pushText(
      userId,
      `近期沒有可預約的時段 🙏\n你可以直接跟我說你方便的日期/時段，我幫你看看能不能特別安排～`,
    );
    return;
  }

  // 每 5 個日期一頁（你可以改成 3 或 4）
  const dayGroups = chunkArray(days, 3);

  const bubbles = dayGroups.map((group) => ({
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "選擇預約日期",
          size: "sm",
          color: "#888888",
        },
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          margin: "md",
          contents: group.map((day) => ({
            type: "button",
            style: "link",
            height: "sm",
            action: {
              type: "postback",
              // 🔑 按鈕上直接顯示「2025-12-10（三）」這種字
              label: day.label,
              data: `action=choose_date&service=${serviceId}&date=${day.dateStr}`,
              displayText: `我想預約 ${serviceName} ${day.dateStr}`,
            },
          })),
        },
      ],
    },
  }));

  const carousel = {
    type: "carousel",
    contents: bubbles,
  };

  await pushFlex(userId, "請選擇預約日期", carousel);
}

// 🔹 給某一天用的「選時段 Flex」，也帶著 serviceId
// dateStr 格式：YYYY-MM-DD
async function sendSlotsFlexForDate(userId, dateStr, serviceId) {
  const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";
  const slots = getSlotsForDate(dateStr);
  const openSlots = slots.filter((s) => s.status === "open");

  if (openSlots.length === 0) {
    await pushText(
      userId,
      `這一天（${dateStr}）目前沒有開放的時段喔。\n你可以換一天試試看，或直接跟我說你方便的時間～`,
    );
    return;
  }

  const buttons = openSlots.map((slot) => ({
    type: "button",
    style: "link", //預約時段的button風格,原本是secondary
    height: "sm",
    action: {
      type: "postback",
      label: slot.timeSlot,
      data: `action=choose_slot&service=${serviceId}&date=${dateStr}&time=${slot.timeSlot}`,
      displayText: `我想預約 ${serviceName} ${dateStr} ${slot.timeSlot}`,
    },
  }));

  const flexBubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "梵和易學｜預約時段",
          weight: "bold",
          size: "sm",
          color: "#888888",
        },
        {
          type: "text",
          text: `日期：${dateStr}`,
          weight: "bold",
          size: "md",
          margin: "sm",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "請選擇你方便的時段：",
          size: "sm",
        },
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          margin: "md",
          contents: buttons,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "※ 之後會再跟你確認姓名、聯絡方式",
          size: "xs",
          color: "#888888",
          wrap: true,
        },
      ],
    },
  };

  await pushFlex(userId, `請選擇 ${dateStr} 的預約時段`, flexBubble);
}

// 🔹 如果你還想直接給「今天時段」，可以保留這個 helper
async function sendTodaySlotsFlex(userId) {
  const todayStr = new Date().toISOString().slice(0, 10);
  return sendSlotsFlexForDate(userId, todayStr);
}

// 測試用：GET /
app.get("/", (req, res) => {
  res.send("Booking API is running");
});

//全部預約列表（之後 admin 用）
app.get("/api/bookings", (req, res) => {
  const bookings = loadBookings();
  res.json(bookings);
});

/* 
==========================================================
✅ Admin API - 查詢 logs（分頁 / 搜尋 / 台灣時間篩選）
==========================================================
Query:
- page=1
- pageSize=20 (max 100)
- q=關鍵字（搜尋 message）
- level=info|warn|error（可選）
- tag=postback|LINE|AI_USAGE...（可選，完全你自訂）
- userId=...（可選）
- from=YYYY-MM-DD 或 YYYY-MM-DDTHH:mm（台灣時間）
- to=YYYY-MM-DD 或 YYYY-MM-DDTHH:mm（台灣時間）
==========================================================
✅ 台灣時間處理策略（不靠 Node 時區）：
- 前端傳 from/to 以「台灣時間字串」
- SQL 用 AT TIME ZONE 'Asia/Taipei' 轉換做篩選
- 回傳額外欄位 created_at_tw：台灣時間字串，前端直接顯示
==========================================================
*/
app.get("/api/admin/logs", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const pageSize = Math.min(
      Math.max(Number(req.query.pageSize || 20), 1),
      100,
    );

    const q = String(req.query.q || "").trim();
    const level = String(req.query.level || "")
      .trim()
      .toLowerCase();
    const tag = String(req.query.tag || "").trim();
    const userId = String(req.query.userId || "").trim();

    const from = String(req.query.from || "").trim(); // 台灣時間字串
    const to = String(req.query.to || "").trim();

    /* 
      ✅ 動態組 WHERE（用參數避免 SQL injection）
    */
    const where = [];
    const params = [];
    let i = 1;

    if (q) {
      where.push(`message ILIKE $${i++}`);
      params.push(`%${q}%`);
    }
    if (level) {
      where.push(`level = $${i++}`);
      params.push(level);
    }
    if (tag) {
      where.push(`tag = $${i++}`);
      params.push(tag);
    }
    if (userId) {
      where.push(`user_id = $${i++}`);
      params.push(userId);
    }

    /* 
      ✅ 台灣時間篩選：
      - created_at 是 timestamptz（UTC）
      - (created_at AT TIME ZONE 'Asia/Taipei') 會變成「台灣 local timestamp」
      - from/to 也當作台灣 local timestamp 來比較
    */
    if (from) {
      where.push(
        `(created_at AT TIME ZONE 'Asia/Taipei') >= $${i++}::timestamp`,
      );
      params.push(from);
    }
    if (to) {
      where.push(
        `(created_at AT TIME ZONE 'Asia/Taipei') <= $${i++}::timestamp`,
      );
      params.push(to);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    /* ✅ total */
    const totalR = await pool.query(
      `SELECT COUNT(*)::int AS total FROM admin_logs ${whereSql}`,
      params,
    );
    const total = totalR.rows?.[0]?.total || 0;

    /* ✅ items（最新在前） */
    const offset = (page - 1) * pageSize;

    const itemsR = await pool.query(
      `
      SELECT 
        id, level, tag, user_id, message, meta,
        created_at,
        to_char(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_tw
      FROM admin_logs
      ${whereSql}
      ORDER BY id DESC
      LIMIT $${i++} OFFSET $${i++}
      `,
      [...params, pageSize, offset],
    );

    res.json({
      items: itemsR.rows,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("[Admin logs list] error:", err);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

//前台主要查詢時段狀態
app.get("/api/slots", (req, res) => {
  const date = req.query.date;
  if (!date) {
    return res
      .status(400)
      .json({ error: "date is required, e.g. ?date=2025-12-10" });
  }

  const slots = getSlotsForDate(date);
  res.json(slots);
});

// 接收預約資料，新增預約，並檢查是否衝突（給前端表單用）
app.post("/api/bookings", (req, res) => {
  console.log("收到一筆預約（來自前端）：");
  console.log(req.body);

  const bookings = loadBookings();

  const newBooking = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    status: "pending",
    ...req.body,
  };

  bookings.push(newBooking);
  saveBookings(bookings);

  console.log(">>> 準備呼叫 notifyNewBooking()");
  notifyNewBooking(newBooking)
    .then(() => {
      console.log(">>> LINE 通知已送出");
    })
    .catch((err) => {
      console.error(
        "[LINE] 新預約通知失敗：",
        err?.response?.data || err.message || err,
      );
    });

  if (newBooking.lineUserId) {
    console.log(">>> 偵測到 lineUserId，準備通知客戶");
    notifyCustomerBooking(newBooking).catch((err) => {
      console.error("[LINE] notifyCustomerBooking 發送失敗：", err);
    });
  } else {
    console.log(">>> 沒有 lineUserId，略過 notifyCustomerBooking");
  }

  res.json({
    success: true,
    message: "後端已收到預約資料並已寫入 bookings.json",
    bookingId: newBooking.id,
    lineUserId: newBooking.lineUserId || null,
  });
});

// LINE訊息通知測試API
app.get("/api/test-line", async (req, res) => {
  try {
    await require("./lineClient").pushText(
      process.env.LINE_ADMIN_USER_ID,
      "這是一則測試訊息：預約系統 LINE 通知已連線 ✅",
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// 後台：讀取所有預約
app.get("/api/admin/bookings", requireAdmin, (req, res) => {
  const bookings = loadBookings();

  bookings.sort((a, b) => {
    if (a.date === b.date) {
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    }
    return (a.date || "").localeCompare(b.date || "");
  });

  res.json(bookings);
});

// 後台：更新預約的狀態（pending / done / canceled）
app.patch("/api/admin/bookings/:id/status", requireAdmin, (req, res) => {
  const bookings = loadBookings();
  const id = Number(req.params.id);
  const { status } = req.body;

  if (!["pending", "done", "canceled"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const idx = bookings.findIndex((b) => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Booking not found" });
  }

  bookings[idx].status = status;
  saveBookings(bookings);

  res.json({ success: true, booking: bookings[idx] });
});

// 後台：刪除一筆預約
app.delete("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const bookings = loadBookings();
  const id = Number(req.params.id);

  const newList = bookings.filter((b) => b.id !== id);

  if (newList.length === bookings.length) {
    return res.status(404).json({ error: "Booking not found" });
  }

  saveBookings(newList);
  res.json({ success: true });
});

// admin API：讀 / 寫不開放設定
app.get("/api/admin/unavailable", requireAdmin, (req, res) => {
  const unavailable = loadUnavailable();
  res.json(unavailable);
});
// admin API：讀 / 寫不開放設定
app.post("/api/admin/unavailable", requireAdmin, (req, res) => {
  const body = req.body;

  const unavailable = {
    fullDay: Array.isArray(body.fullDay) ? body.fullDay : [],
    slots: Array.isArray(body.slots) ? body.slots : [],
  };

  saveUnavailable(unavailable);
  res.json({ success: true });
});

/* 
  ======================================
  Admin API - user_access 列表（讀取用）
  ======================================
  ✅ 為什麼先做這支：
  - 後台要「改」之前，先要「看」得到
  - 列表是唯讀，風險最低、最好驗證前後端對接
  
  ✅ 功能：
  - q：user_id 模糊搜尋（可不帶）
  - page/pageSize：分頁，避免一次撈爆
  
  ✅ 安全：
  - 走 requireAdmin（你現有的 x-admin-token）
  - SQL 用參數化避免注入
*/
app.get("/api/admin/user-access", requireAdmin, async (req, res) => {
  /* 
    ✅ 讀 query string，並做防呆
    - page 至少 1
    - pageSize 最小 1 最大 100（避免有人亂打 99999）
  */
  const q = String(req.query.q || "").trim();
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(req.query.pageSize || "20", 10)),
  );
  const offset = (page - 1) * pageSize;

  try {
    /* 
      ✅ 有 q 才加 WHERE 條件
      - 用 ILIKE 做不分大小寫搜尋
      - 參數化：避免 SQL injection
    */
    const whereSql = q ? "WHERE user_id ILIKE $1" : "";
    const whereParams = q ? [`%${q}%`] : [];

    /* 
      ✅ 先算總筆數 total（前端做分頁要用）
    */
    const totalSql = `
      SELECT COUNT(*)::int AS total
      FROM user_access
      ${whereSql}
    `;
    const totalResult = await pool.query(totalSql, whereParams);
    const total = totalResult.rows[0]?.total || 0;

    /* 
      ✅ 再撈本頁 items
      - 只選後台會用到的欄位
      - updated_at DESC：最新更新的放前面
      - LIMIT/OFFSET 也走參數化
    */
    const itemsSql = `
      SELECT
        user_id,
        first_free,
        quota,
        redeemed_coupons,
        created_at,
        updated_at
      FROM user_access
      ${whereSql}
      ORDER BY updated_at DESC NULLS LAST
      LIMIT $${whereParams.length + 1}
      OFFSET $${whereParams.length + 2}
    `;
    const itemsParams = [...whereParams, pageSize, offset];
    const itemsResult = await pool.query(itemsSql, itemsParams);

    /* 
      ✅ 統一回傳格式
      - items：資料列
      - total/page/pageSize：前端可以直接畫分頁
    */
    return res.json({
      items: itemsResult.rows,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("[Admin user_access list] error:", err);
    return res.status(500).json({ error: "Failed to fetch user_access" });
  }
});

/* 
  ======================================
  Admin API - user_access 單筆讀取（安全）
  ======================================
  ✅ 為什麼先做單筆讀取：
  - 編輯前要先拿到最新資料（避免你看舊值亂改）
  - 這支仍是唯讀，風險低、好驗證
  
  ✅ 設計：
  - 用 userId 當 key（對應你表的 user_id）
  - 回 404 表示沒有這個 user_id（之後新增 API 才會用到）
*/
app.get("/api/admin/user-access/:userId", requireAdmin, async (req, res) => {
  /* 
    ✅ userId 來源：URL path
    - encodeURIComponent 在前端會做
    - 後端這邊只拿字串並 trim
  */
  const userId = String(req.params.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    /* 
      ✅ 參數化查詢：避免 injection
    */
    const r = await pool.query(
      `
      SELECT
        user_id,
        first_free,
        quota,
        redeemed_coupons,
        created_at,
        updated_at
      FROM user_access
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId],
    );

    if (r.rowCount === 0) {
      /* 
        ✅ 找不到就回 404
        - 前端可以用來判斷是否要顯示「新增」按鈕
      */
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    /* 
      ✅ 回傳單筆資料
    */
    return res.json(r.rows[0]);
  } catch (err) {
    console.error("[Admin user_access get] error:", err);
    return res.status(500).json({ error: "Failed to fetch user_access" });
  }
});

/* 
  =========================================================
  Admin API - user_access 更新（PATCH / 白名單 / 安全）
  =========================================================
  ✅ 功能：
  - 更新 user_access 的 JSONB 欄位：
    - first_free: { liuyao, minibazi, bazimatch }
    - quota:      { liuyao, minibazi, bazimatch }
  - 只允許以上三個 key（白名單）
  - 值只允許「非負整數」（0 也可以）

  ✅ 為什麼要做白名單 + 非負整數檢查：
  - 避免後台手滑把 JSON 結構改壞（例如塞入字串、塞入新 key）
  - 避免負數造成配額/首免資料不合理

  ✅ Postgres 注意事項（你剛遇到的 500）：
  - UPDATE 同一欄位不能重複 assignment（quota = ... 不能寫三次）
  - 所以要把多個 key 的更新串成「單一 quota 表達式」
    例如 quota = jsonb_set(jsonb_set(quota,'{liuyao}',...),'{minibazi}',...)
*/
app.patch("/api/admin/user-access/:userId", requireAdmin, async (req, res) => {
  /* 
    ======================================
    1) 讀 userId & 基本檢查
    ======================================
  */
  const userId = String(req.params.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  /* 
    ======================================
    2) 白名單與輸入過濾
    ======================================
  */
  const ALLOWED_KEYS = new Set(["liuyao", "minibazi", "bazimatch"]);

  /* 
    ✅ 只接受這兩塊（其餘 body 欄位不處理）
    - 例如 req.body.redeemed_coupons 我們不給改（避免爆炸）
  */
  const firstFreePatch = req.body?.first_free || null;
  const quotaPatch = req.body?.quota || null;

  if (!firstFreePatch && !quotaPatch) {
    return res.status(400).json({ error: "first_free or quota is required" });
  }

  /* 
    ✅ sanitizePatch：
    - 只保留允許的 key
    - 值必須是「整數且 >= 0」
  */
  function sanitizePatch(obj) {
    const out = {};
    if (!obj || typeof obj !== "object") return out;

    for (const [k, v] of Object.entries(obj)) {
      if (!ALLOWED_KEYS.has(k)) continue;

      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) continue;

      out[k] = n;
    }
    return out;
  }

  const safeFirstFree = sanitizePatch(firstFreePatch);
  const safeQuota = sanitizePatch(quotaPatch);

  if (
    Object.keys(safeFirstFree).length === 0 &&
    Object.keys(safeQuota).length === 0
  ) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  try {
    /* 
      ======================================
      3) 確認 user 存在（不存在回 404）
      ======================================
    */
    const exists = await pool.query(
      `SELECT 1 FROM user_access WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    /* 
      ======================================
      4) 組 UPDATE SQL（每個欄位最多 assignment 一次）
      ======================================

      ✅ buildJsonbSetExpr：
      - 從 columnName 開始（quota 或 first_free）
      - 每個 key 都「包一層」jsonb_set
      - 最後得到一個完整表達式
    */
    const params = [userId];
    let idx = 2;

    function buildJsonbSetExpr(columnName, patchObj) {
      let expr = columnName;

      for (const [k, n] of Object.entries(patchObj)) {
        /* 
          ✅ k 來自白名單 sanitizePatch：安全
          ✅ n 用參數化：避免 SQL injection
        */
        expr = `jsonb_set(${expr}, ARRAY['${k}'], to_jsonb($${idx}::int), true)`;
        params.push(n);
        idx++;
      }
      return expr;
    }

    const sets = [];

    /* 
      ✅ first_free 有需要更新才設定
    */
    if (Object.keys(safeFirstFree).length > 0) {
      const firstFreeExpr = buildJsonbSetExpr("first_free", safeFirstFree);
      sets.push(`first_free = ${firstFreeExpr}`);
    }

    /* 
      ✅ quota 有需要更新才設定
    */
    if (Object.keys(safeQuota).length > 0) {
      const quotaExpr = buildJsonbSetExpr("quota", safeQuota);
      sets.push(`quota = ${quotaExpr}`);
    }

    /* 
      ✅ updated_at 一律更新
    */
    sets.push(`updated_at = NOW()`);

    const sql = `
      UPDATE user_access
      SET ${sets.join(",\n          ")}
      WHERE user_id = $1
      RETURNING user_id, first_free, quota, redeemed_coupons, created_at, updated_at
    `;

    /* 
      ======================================
      5) 執行更新並回傳最新資料
      ======================================
    */
    const r = await pool.query(sql, params);

    return res.json({
      success: true,
      item: r.rows[0],
    });
  } catch (err) {
    console.error("[Admin user_access patch] error:", err);
    return res.status(500).json({ error: "Failed to update user_access" });
  }
});

/* 
  ==========================================
  Admin API - user_access 整筆刪除（DELETE）
  ==========================================
  ✅ 需求對應：
  - 你要「以 key=user_id 整筆刪掉」
  - 這支就是：DELETE /api/admin/user-access/:userId

  ✅ 安全策略：
  - requireAdmin 驗證 x-admin-token
  - userId trim + 參數化查詢
  - 找不到回 404
*/
app.delete("/api/admin/user-access/:userId", requireAdmin, async (req, res) => {
  /* 
    ✅ userId 來源：URL path
  */
  const userId = String(req.params.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    /* 
      ✅ 直接刪除，RETURNING 用來判斷有沒有刪到
      - rowCount=0 表示根本沒有這筆
    */
    const r = await pool.query(
      `DELETE FROM user_access WHERE user_id = $1 RETURNING user_id`,
      [userId],
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    /* 
      ✅ 回傳 success + 被刪掉的 user_id
    */
    return res.json({ success: true, deletedUserId: r.rows[0].user_id });
  } catch (err) {
    console.error("[Admin user_access delete] error:", err);
    return res.status(500).json({ error: "Failed to delete user_access" });
  }
});

/* 
  ==========================================
  Admin API - user_access 新增（POST）
  ==========================================
  ✅ 需求對應：
  - 用 user_id 建立一筆
  - first_free 預設全 1
  - quota 預設全 0
  - redeemed_coupons 預設 {}

  ✅ 安全策略：
  - requireAdmin 驗證 x-admin-token
  - user_id trim + 基本格式檢查
  - 已存在回 409（避免你誤按新增重複）
*/
app.post("/api/admin/user-access", requireAdmin, async (req, res) => {
  /* 
    ✅ user_id 從 body 來
  */
  const userId = String(req.body?.user_id || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "user_id is required" });
  }

  /* 
    ✅ 你可以依需求放寬/收緊格式
    - 這裡先做「不要太誇張」的保護：長度 3~80
  */
  if (userId.length < 3 || userId.length > 80) {
    return res.status(400).json({ error: "user_id length invalid" });
  }

  /* 
    ✅ 預設資料（符合你說的預設值）
  */
  const firstFreeDefault = { liuyao: 0, minibazi: 0, bazimatch: 1 };
  const quotaDefault = { liuyao: 0, minibazi: 0, bazimatch: 0 };
  const redeemedDefault = {};

  try {
    /* 
      ✅ 先檢查是否已存在
    */
    const exists = await pool.query(
      `SELECT 1 FROM user_access WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (exists.rowCount > 0) {
      return res.status(409).json({ error: "ALREADY_EXISTS" });
    }

    /* 
      ✅ 寫入資料
      - created_at/updated_at 用 NOW()
    */
    const r = await pool.query(
      `
      INSERT INTO user_access (user_id, first_free, quota, redeemed_coupons, created_at, updated_at)
      VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, NOW(), NOW())
      RETURNING user_id, first_free, quota, redeemed_coupons, created_at, updated_at
      `,
      [
        userId,
        JSON.stringify(firstFreeDefault),
        JSON.stringify(quotaDefault),
        JSON.stringify(redeemedDefault),
      ],
    );

    /* 
      ✅ 回傳新增成功的那筆資料
    */
    return res.status(201).json({ success: true, item: r.rows[0] });
  } catch (err) {
    console.error("[Admin user_access create] error:", err);
    return res.status(500).json({ error: "Failed to create user_access" });
  }
});

/* =========================================================
   Step A4：Prompt 後台管理 API
   - 依賴 requireAdmin（x-admin-token）
   ========================================================= */
const {
  readPromptFile,
  savePromptFile,
  exportMiniBaziBundle,
  listBackups,
  getBackupPath,
} = require("./adminPrompts");

/* =========================================================
   ✅ 讀 minibazi prompt 全套（目前 4 檔）
   ========================================================= */
app.get("/api/admin/prompts/minibazi", requireAdmin, (req, res) => {
  try {
    const files = [
      "minibazi.json",
      "minibazi.userTemplate.txt",
      "minibazi.howto.txt",
      "minibazi.modeCopy.json",
    ];

    const out = { files: {} };
    for (const filename of files) {
      out.files[filename] = readPromptFile(filename);
    }

    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "error" });
  }
});

/* =========================================================
   ✅ 保存單一檔案（保存前自動備份）
   body:
   - filename: "minibazi.modeCopy.json" | ...
   - content: object | string
   - note: "改年度文案"（可選）
   ========================================================= */
app.put("/api/admin/prompts/minibazi", requireAdmin, (req, res) => {
  try {
    const { filename, content, note } = req.body || {};
    const result = savePromptFile({ filename, content, note });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "error" });
  }
});

/* =========================================================
   ✅ 匯出整包（下載 JSON）
   - Content-Disposition 讓瀏覽器直接下載檔案
   ========================================================= */
app.get("/api/admin/prompts/minibazi/export", requireAdmin, (req, res) => {
  try {
    const bundle = exportMiniBaziBundle();

    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");

    const filename = `minibazi_prompts__${ts}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.send(JSON.stringify(bundle, null, 2));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "error" });
  }
});

/* =========================================================
   ✅ 列出備份版本
   query:
   - filename=minibazi.modeCopy.json
   ========================================================= */
app.get("/api/admin/prompts/backups", requireAdmin, (req, res) => {
  try {
    const { filename } = req.query || {};
    const items = listBackups(String(filename || ""));
    res.json({ items });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "error" });
  }
});

/* =========================================================
   ✅ 下載某份備份
   query:
   - filename=minibazi.modeCopy.json
   - id=2026-01-20_...__.json
   ========================================================= */
app.get("/api/admin/prompts/backups/download", requireAdmin, (req, res) => {
  try {
    const { filename, id } = req.query || {};
    const fullPath = getBackupPath(String(filename || ""), String(id || ""));

    res.setHeader("Content-Disposition", `attachment; filename="${id}"`);
    res.sendFile(fullPath);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "error" });
  }
});

//==========================================================
// ✅ Articles 後台管理 API：文章列表（含 tag 篩選 / 關鍵字搜尋 / 狀態篩選）
// GET /api/admin/articles
// 權限：requireAdmin
//
// Query（可選）：
// - q=關鍵字（搜尋 title / description / slug）
// - tag=單一 tag（例如：紫微 / 八字 / 姓名學 / 風水 / 隨筆 / 觀念）
// - status=draft|published（不帶就全列）
//
// 回傳：{ items, total }
// - items 會是 index.json 的 items（再經過篩選/排序）
//==========================================================
app.get("/api/admin/articles", requireAdmin, (req, res) => {
  try {
    /* =========================
      【1】讀取文章索引
      - 來源：articles/index.json
      - 格式：{ items: [...] }
    ========================== */
    const idx = loadArticlesIndex();

    /* =========================
      【2】取 query（都當字串處理）
    ========================== */
    const q = String(req.query.q || "").trim();
    const tag = String(req.query.tag || "").trim();
    const status = String(req.query.status || "").trim(); // draft / published

    /* =========================
      【3】開始篩選
      - 先複製陣列，避免直接改到原始資料
    ========================== */
    let items = Array.isArray(idx.items) ? [...idx.items] : [];

    /* =========================
      【3-1】status 篩選（可選）
    ========================== */
    if (status === "draft" || status === "published") {
      items = items.filter((it) => it.status === status);
    }

    /* =========================
      【3-2】tag 篩選（可選）
      - 你未來要「只看紫微」就是用這個
      - tag 以「完全相等」為準（避免模糊命中）
    ========================== */
    if (tag) {
      items = items.filter(
        (it) => Array.isArray(it.tags) && it.tags.includes(tag),
      );
    }

    /* =========================
      【3-3】q 關鍵字搜尋（可選）
      - 搜 slug/title/description
      - 全部轉小寫做 contains
    ========================== */
    if (q) {
      const qq = q.toLowerCase();
      items = items.filter((it) => {
        const slug = String(it.slug || "").toLowerCase();
        const title = String(it.title || "").toLowerCase();
        const desc = String(it.description || "").toLowerCase();
        return slug.includes(qq) || title.includes(qq) || desc.includes(qq);
      });
    }

    /* =========================
      【4】排序（預設：最新在前）
      - 優先用 updatedAt，再退回 date
    ========================== */
    items.sort((a, b) => {
      const at = Date.parse(a.updatedAt || a.date || 0) || 0;
      const bt = Date.parse(b.updatedAt || b.date || 0) || 0;
      return bt - at;
    });

    /* =========================
      【5】回傳
    ========================== */
    return res.json({
      items,
      total: items.length,
    });
  } catch (err) {
    /* =========================
      【錯誤處理】避免把內部細節直接噴給前端
    ========================== */
    return res.status(500).json({
      success: false,
      message: "LIST_ARTICLES_FAILED",
    });
  }
});

//==========================================================
// ✅ Articles 後台管理 API：讀取單篇文章（meta + json + html）
// GET /api/admin/articles/:slug
// 權限：requireAdmin
//
// 回傳：{ meta, content_json, content_html }
// - meta：articles/<slug>/meta.json
// - content_json：articles/<slug>/article.json（Tiptap 原文）
// - content_html：articles/<slug>/article.html（快照）
//==========================================================
app.get("/api/admin/articles/:slug", requireAdmin, (req, res) => {
  try {
    /* =========================
      【1】取 slug（必要）
    ========================== */
    const slug = String(req.params.slug || "").trim();

    /* =========================
      【2】基本防呆：slug 不允許奇怪字元（避免路徑穿越）
      - 允許：英數、小寫、-、_
    ========================== */
    if (!/^[a-z0-9\-_]+$/.test(slug)) {
      return res.status(400).json({
        success: false,
        message: "INVALID_SLUG",
      });
    }

    /* =========================
      【3】組檔案路徑
    ========================== */
    const metaPath = getArticleMetaPath(slug);
    const jsonPath = getArticleJsonPath(slug);
    const htmlPath = getArticleHtmlPath(slug);

    /* =========================
      【4】讀檔（不存在就回 null / fallback）
    ========================== */
    const meta = readJsonSafe(metaPath, null);
    const content_json = readJsonSafe(jsonPath, null);
    const content_html = fs.existsSync(htmlPath)
      ? fs.readFileSync(htmlPath, "utf-8")
      : null;

    /* =========================
      【5】若三個都不存在，視為找不到文章
    ========================== */
    if (!meta && !content_json && !content_html) {
      return res.status(404).json({
        success: false,
        message: "NOT_FOUND",
      });
    }

    /* =========================
      【6】回傳
    ========================== */
    return res.json({
      meta,
      content_json,
      content_html,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "GET_ARTICLE_FAILED",
    });
  }
});

//==========================================================
// ✅ Articles 後台管理 API：新增文章（建立草稿）
// POST /api/admin/articles
// 權限：requireAdmin
//
// body（JSON）：
// - slug（必填）：英文小寫/數字/-/_
// - title（必填）
// - description（選填）
// - date（選填，YYYY-MM-DD；不帶就用今天）
// - tags（選填，陣列）
// - status（選填，draft|published；預設 draft）
// - content_json（選填，Tiptap JSON；預設空 doc）
// - content_html（選填，HTML；預設空字串）
//
// 行為：
// 1) 若 slug 已存在 → 409
// 2) 建立 articles/<slug>/
// 3) 寫 meta.json + article.json + article.html
// 4) 更新 articles/index.json（新增一筆）
// 5) 全程寫入前備份（index / 既有檔）
//==========================================================
app.post("/api/admin/articles", requireAdmin, express.json(), (req, res) => {
  try {
    /* =========================
      【1】取 body 欄位
    ========================== */
    const slug = String(req.body?.slug || "").trim();
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();

    const date = String(req.body?.date || "").trim(); // optional
    const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
    const statusRaw = String(req.body?.status || "draft").trim();
    const status = statusRaw === "published" ? "published" : "draft";

    const content_json =
      req.body?.content_json && typeof req.body.content_json === "object"
        ? req.body.content_json
        : {
            /* =========================
              【預設】空的 Tiptap doc
            ========================== */
            type: "doc",
            content: [],
          };

    const content_html =
      typeof req.body?.content_html === "string" ? req.body.content_html : "";

    /* =========================
      【2】基本驗證
    ========================== */
    if (!slug || !/^[a-z0-9\-_]+$/.test(slug)) {
      return res.status(400).json({ success: false, message: "INVALID_SLUG" });
    }
    if (!title) {
      return res
        .status(400)
        .json({ success: false, message: "TITLE_REQUIRED" });
    }

    /* =========================
      【3】日期處理
      - 不帶 date 就用今天（台灣時區用你目前策略：先用本機時間字串）
      - 你若想嚴格用 Asia/Taipei，我們之後再統一（先讓功能跑）
    ========================== */
    const today = new Date().toISOString().slice(0, 10);
    const finalDate = date || today;

    /* =========================
      【4】檢查是否已存在（以資料夾或 meta.json 是否存在為準）
    ========================== */
    const articleDir = getArticleDir(slug);
    const metaPath = getArticleMetaPath(slug);
    if (fs.existsSync(articleDir) || fs.existsSync(metaPath)) {
      return res
        .status(409)
        .json({ success: false, message: "ALREADY_EXISTS" });
    }

    /* =========================
      【5】建立資料夾結構
    ========================== */
    ensureDir(articleDir);
    ensureDir(getArticleAssetsDir(slug));

    /* =========================
      【6】準備 meta（含 SEO 預留欄位）
    ========================== */
    const nowIso = new Date().toISOString();

    const meta = {
      /* =========================
        基本欄位
      ========================== */
      slug,
      title,
      description,
      date: finalDate,
      updatedAt: nowIso,
      status,
      tags: tags.map((t) => String(t).trim()).filter(Boolean),

      /* =========================
        SEO 預留（先存著，之後再正式用）
      ========================== */
      canonical: `https://chen-yi.tw/articles/${slug}/`,
      robots: status === "published" ? "index,follow" : "noindex,nofollow",
      ogTitle: title,
      ogDescription: description || "",
      ogImage: "", // 之後若有封面圖可填
      twitterCard: "summary_large_image",
      lang: "zh-Hant",
      schemaType: "Article",
      authorName: "梵和易學",
      publisherName: "梵和易學",
      coverImage: "", // 之後可用
    };

    /* =========================
      【7】寫入檔案（寫入前備份：雖然是新檔，這裡備份不會做事）
    ========================== */
    const jsonPath = getArticleJsonPath(slug);
    const htmlPath = getArticleHtmlPath(slug);

    // ✅ 寫 meta.json / article.json / article.html
    writeJsonPretty(metaPath, meta);
    writeJsonPretty(jsonPath, content_json);
    fs.writeFileSync(htmlPath, content_html, "utf-8");

    /* =========================
      【8】更新 index.json（新增一筆）
      - 只放「列表需要的欄位」，保持輕量
    ========================== */
    const idx = loadArticlesIndex();

    const indexItem = {
      slug,
      title,
      description,
      date: finalDate,
      updatedAt: nowIso,
      status,
      tags: meta.tags,
      coverImage: meta.coverImage || "",
    };

    const nextIndex = {
      items: [indexItem, ...(idx.items || [])],
    };

    saveArticlesIndex(nextIndex, `create_${slug}`);

    /* =========================
      【9】回傳成功
    ========================== */
    return res.json({
      success: true,
      slug,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "CREATE_ARTICLE_FAILED",
    });
  }
});

//==========================================================
// ✅ Articles 後台管理 API：更新文章（編輯內容/改狀態）
// PATCH /api/admin/articles/:slug
// 權限：requireAdmin
//
// body（可選欄位，帶什麼改什麼）：
// - title
// - description
// - date（YYYY-MM-DD）
// - tags（陣列）
// - status（draft|published）
// - content_json（Tiptap JSON）
// - content_html（HTML）
//
// 行為：
// 1) slug 不存在 → 404
// 2) 寫入前備份：meta/json/html/index
// 3) 更新 meta.updatedAt
// 4) 若 status 改變：同步 robots（published => index,follow；draft => noindex,nofollow）
// 5) 同步更新 index.json 對應 item（找 slug）
//==========================================================
app.patch(
  "/api/admin/articles/:slug",
  requireAdmin,
  express.json(),
  (req, res) => {
    try {
      /* =========================
      【1】取 slug + 防呆
    ========================== */
      const slug = String(req.params.slug || "").trim();
      if (!slug || !/^[a-z0-9\-_]+$/.test(slug)) {
        return res
          .status(400)
          .json({ success: false, message: "INVALID_SLUG" });
      }

      /* =========================
      【2】檢查文章是否存在（以 meta.json 為主）
    ========================== */
      const metaPath = getArticleMetaPath(slug);
      const jsonPath = getArticleJsonPath(slug);
      const htmlPath = getArticleHtmlPath(slug);

      if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ success: false, message: "NOT_FOUND" });
      }

      /* =========================
      【3】讀取舊資料
    ========================== */
      const meta = readJsonSafe(metaPath, null) || {};
      const oldJson = readJsonSafe(jsonPath, null);
      const oldHtml = fs.existsSync(htmlPath)
        ? fs.readFileSync(htmlPath, "utf-8")
        : null;

      /* =========================
      【4】準備「允許更新」的欄位（白名單）
    ========================== */
      const nextTitle =
        typeof req.body?.title === "string"
          ? String(req.body.title).trim()
          : meta.title;

      const nextDescription =
        typeof req.body?.description === "string"
          ? String(req.body.description).trim()
          : meta.description;

      const nextDate =
        typeof req.body?.date === "string" && req.body.date.trim()
          ? req.body.date.trim()
          : meta.date;

      const nextTags = Array.isArray(req.body?.tags)
        ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
        : Array.isArray(meta.tags)
          ? meta.tags
          : [];

      const nextStatusRaw =
        typeof req.body?.status === "string"
          ? req.body.status.trim()
          : meta.status;

      const nextStatus = nextStatusRaw === "published" ? "published" : "draft";

      const nextContentJson =
        req.body?.content_json && typeof req.body.content_json === "object"
          ? req.body.content_json
          : oldJson;

      const nextContentHtml =
        typeof req.body?.content_html === "string"
          ? req.body.content_html
          : oldHtml;

      /* =========================
      【5】最基本驗證
    ========================== */
      if (!nextTitle) {
        return res
          .status(400)
          .json({ success: false, message: "TITLE_REQUIRED" });
      }

      /* =========================
      【6】寫入前備份（讓你敢改）
      - meta/json/html/index 都先備份
    ========================== */
      backupFileIfExists(metaPath, `patch_${slug}_meta`);
      if (fs.existsSync(jsonPath))
        backupFileIfExists(jsonPath, `patch_${slug}_json`);
      if (fs.existsSync(htmlPath))
        backupFileIfExists(htmlPath, `patch_${slug}_html`);
      backupFileIfExists(ARTICLES_INDEX_PATH, `patch_${slug}_index`);

      /* =========================
      【7】更新 meta（含 SEO 欄位同步）
    ========================== */
      const nowIso = new Date().toISOString();

      const nextMeta = {
        ...meta,
        title: nextTitle,
        description: nextDescription,
        date: nextDate,
        tags: nextTags,
        status: nextStatus,
        updatedAt: nowIso,

        // ✅ status 影響 robots（草稿避免被收錄）
        robots:
          nextStatus === "published" ? "index,follow" : "noindex,nofollow",

        // ✅ OG 預設跟著 title/description 走（你之後可客製）
        ogTitle: meta.ogTitle ? meta.ogTitle : nextTitle,
        ogDescription: meta.ogDescription
          ? meta.ogDescription
          : nextDescription,

        // ✅ canonical 若沒填過，就補預設
        canonical: meta.canonical || `https://chen-yi.tw/articles/${slug}/`,
      };

      writeJsonPretty(metaPath, nextMeta);

      /* =========================
      【8】更新內容檔案（有帶才寫；沒帶就維持原狀）
      - 這樣你可以只改 meta，不必每次都傳 content
    ========================== */
      if (nextContentJson && typeof nextContentJson === "object") {
        writeJsonPretty(jsonPath, nextContentJson);
      }
      if (typeof nextContentHtml === "string") {
        fs.writeFileSync(htmlPath, nextContentHtml, "utf-8");
      }

      /* =========================
      【9】同步更新 index.json 對應那筆
    ========================== */
      const idx = loadArticlesIndex();
      const items = Array.isArray(idx.items) ? [...idx.items] : [];

      const nextItems = items.map((it) => {
        if (it.slug !== slug) return it;
        return {
          ...it,
          title: nextTitle,
          description: nextDescription,
          date: nextDate,
          updatedAt: nowIso,
          status: nextStatus,
          tags: nextTags,
          coverImage: nextMeta.coverImage || it.coverImage || "",
        };
      });

      saveArticlesIndex({ items: nextItems }, `patch_${slug}`);

      /* =========================
      【10】回傳成功
    ========================== */
      return res.json({ success: true, slug });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "PATCH_ARTICLE_FAILED",
      });
    }
  },
);

// ✅ LIFF 分享頁：用來跳 Threads 分享（Flex 只能用 https，所以先進 LIFF 再跳外部）
app.get("/liff/share", (req, res) => {
  const liffId = process.env.LIFF_ID_SHARE || "";
  const rawText = typeof req.query.text === "string" ? req.query.text : "";
  const text = rawText.slice(0, 1200); // 避免過長（保險）

  // Threads web intent（不保證一定喚起 App，但 external=true 會更有機會）
  const threadsIntent = `https://www.threads.net/intent/post?text=${encodeURIComponent(
    text,
  )}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>分享解鎖</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans TC",sans-serif;padding:18px;line-height:1.5}
    .card{max-width:520px;margin:0 auto;border:1px solid #eee;border-radius:14px;padding:16px}
    .btn{display:block;width:100%;padding:12px 14px;border-radius:12px;border:0;margin-top:10px;font-size:16px}
    .primary{background:#111;color:#fff}
    .secondary{background:#f3f3f3}
    textarea{width:100%;min-height:140px;margin-top:10px;border-radius:12px;border:1px solid #ddd;padding:10px}
    .hint{color:#666;font-size:13px;margin-top:8px}
  </style>
</head>
<body>
  <div class="card">
    <h2 style="margin:0 0 6px">準備跳去 Threads 分享</h2>
    <div class="hint">如果沒有自動跳轉，請按「開啟 Threads 分享」。</div>

    <button class="btn primary" id="openBtn">開啟 Threads 分享</button>

    <div class="hint">若 Threads 沒跳 App，你可以直接複製文案貼到 Threads：</div>
    <textarea id="txt" readonly></textarea>
    <button class="btn secondary" id="copyBtn">複製文案</button>
  </div>

<script>
  const LIFF_ID = ${JSON.stringify(liffId)};
  const TEXT = ${JSON.stringify(text)};
  const THREADS_INTENT = ${JSON.stringify(threadsIntent)};

  document.getElementById("txt").value = TEXT;

  async function goThreads() {
    try {
      // external:true 讓它用外部瀏覽器開，較可能喚起 Threads App
      liff.openWindow({ url: THREADS_INTENT, external: true });
    } catch (e) {
      // 如果 LIFF 還沒 init，就用 window.open 保底
      window.open(THREADS_INTENT, "_blank");
    }
  }

  document.getElementById("openBtn").addEventListener("click", goThreads);

  document.getElementById("copyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(TEXT);
      alert("已複製 ✅ 直接去 Threads 貼上就行");
    } catch (e) {
      alert("複製失敗，請手動全選複製");
    }
  });

  (async () => {
    try {
      if (!LIFF_ID) return;
      await liff.init({ liffId: LIFF_ID });
      // 進來就自動跳一次（使用者體感比較順）
      if (TEXT) goThreads();
    } catch (e) {
      // init 失敗也不要死，按鈕仍可用 window.open
      console.log("LIFF init failed:", e);
    }
  })();
</script>
</body>
</html>`);
});

// ==========================
// ✅ 金流：建單 + 導轉付款頁
// 用途：使用者點「前往付款」→ 先把舊 INIT 全部 EXPIRED → 建新 INIT 訂單 → auto-submit 到綠界
// 重點：MerchantTradeNo 必須唯一，不可重複使用（所以不能 reuse）
// ==========================
app.get("/pay", async (req, res) => {
  try {
    const userId = String(req.query.userId || "").trim();
    const feature = String(req.query.feature || "").trim();

    if (!userId || !feature || !PRICE_MAP[feature]) {
      res.status(400).send("Bad Request");
      return;
    }

    const qty = 1;
    const amount = PRICE_MAP[feature] * qty;

    // ==========================
    // ① 先把舊 INIT 全部標成 EXPIRED
    // 用途：避免同一人狂點付款產生多張「都還能補 quota」的單
    // ==========================
    await paymentOrders.expireOldInitOrders({ userId, feature });

    // ==========================
    // ② 建新的 INIT 訂單（每次都必須用新的 MerchantTradeNo）
    // 因為 MerchantTradeNo 綠界要求唯一，不可重複使用
    // ==========================
    const merchantTradeNo = genMerchantTradeNo();

    await paymentOrders.createPaymentOrder({
      merchantTradeNo,
      userId,
      feature,
      qty,
      amount,
    });

    //console.log(
    //  `[pay] create NEW INIT order: ${merchantTradeNo} (${userId}, ${feature})`
    //);

    // ==========================
    // ③ 組綠界導轉參數
    // ==========================
    const MerchantID = process.env.ECPAY_MERCHANT_ID;
    const HashKey = process.env.ECPAY_HASH_KEY;
    const HashIV = process.env.ECPAY_HASH_IV;
    const BASE_URL = process.env.BASE_URL;

    if (!MerchantID || !HashKey || !HashIV || !BASE_URL) {
      console.error("[pay] missing env:", {
        MerchantID: !!MerchantID,
        HashKey: !!HashKey,
        HashIV: !!HashIV,
        BASE_URL: !!BASE_URL,
      });
      res.status(500).send("Server Misconfig");
      return;
    }

    const params = {
      MerchantID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: formatEcpayDate(),
      PaymentType: "aio",
      TotalAmount: amount,
      TradeDesc: "LINE 線上服務",
      ItemName: `${feature} x ${qty}`,
      ChoosePayment: "Credit",

      // ✅ 付款完成後綠界 Server 會 POST 回來（補 quota 走這支）
      ReturnURL: `${BASE_URL}/ecpay/return`,

      // ✅ 付款完成後，使用者回到你頁面（可改）
      ClientBackURL: `${BASE_URL}/pay/success`,

      // ✅ 自訂欄位：查單方便
      CustomField1: userId,
      CustomField2: feature,
      CustomField3: String(qty),

      // ✅ 建單時用 SHA256
      EncryptType: 1,
    };

    params.CheckMacValue = generateCheckMacValue(
      params,
      HashKey,
      HashIV,
      "sha256",
    );

    // ==========================
    // ④ 回傳 auto-submit form（導轉到綠界）
    // ==========================
    const ecpayUrl = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
    const inputs = Object.entries(params)
      .map(([k, v]) => {
        const safeVal = String(v).replace(/"/g, "&quot;");
        return `<input type="hidden" name="${k}" value="${safeVal}" />`;
      })
      .join("\n");

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(`
      <html>
        <body>
          <p>正在前往付款頁...</p>
          <form id="f" method="post" action="${ecpayUrl}">
            ${inputs}
          </form>
          <script>document.getElementById('f').submit();</script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("[pay] error:", err);
    res.status(500).send("Server Error");
  }
});

// ==========================
// ✅ 金流：綠界付款結果回呼（ReturnURL）
// 用途：綠界付款完成後 POST 回來 → 驗證 CheckMacValue → INIT→PAID → 補 quota
// ==========================
app.post(
  "/ecpay/return",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      const HashKey = process.env.ECPAY_HASH_KEY;
      const HashIV = process.env.ECPAY_HASH_IV;

      // ① 驗證簽章（防偽造）
      const data = { ...req.body };
      const receivedMac = data.CheckMacValue;
      delete data.CheckMacValue;

      const algo = String(receivedMac || "").length === 32 ? "md5" : "sha256";
      const computedMac = generateCheckMacValue(data, HashKey, HashIV, algo);

      // ==========================
      // 🔍 Debug：驗簽用（確認哪裡不一樣）
      // ==========================
      //console.log("[ECPAY RETURN] received CheckMacValue =", receivedMac);
      //console.log("[ECPAY RETURN] computed CheckMacValue =", computedMac);
      //console.log("[ECPAY RETURN] data keys =", Object.keys(data));
      //console.log("[ECPAY RETURN] algo =", algo);

      if (computedMac !== receivedMac) {
        console.warn("[ecpay return] CheckMacValue mismatch");
        res.send("0|FAIL");
        return;
      }

      const rtnCode = String(data.RtnCode || "");
      const merchantTradeNo = String(data.MerchantTradeNo || "");
      const ecpayTradeNo = String(data.TradeNo || "");

      // ② 原始回傳先存起來（追查用）
      await paymentOrders.updateOrderRawReturn(merchantTradeNo, req.body);

      // ③ 付款失敗：記錄 FAILED（不補 quota）
      if (rtnCode !== "1") {
        await paymentOrders.markOrderFailed({ merchantTradeNo, ecpayTradeNo });
        res.send("1|OK");
        return;
      }

      // ④ 防重複：只有第一次 INIT→PAID 成功才補 quota
      const paid = await paymentOrders.markOrderPaidIfNotYet({
        merchantTradeNo,
        ecpayTradeNo,
      });
      if (!paid.didUpdate) {
        res.send("1|OK");
        return;
      }

      // ⑤ 讀訂單內容 → 補 quota + 推播通知
      const order = await paymentOrders.getPaymentOrder(merchantTradeNo);
      if (order) {
        await addQuotaAtomic(order.user_id, order.feature, order.qty);

        await pushText(
          order.user_id,
          "✅ 付款完成！\n你現在可以回到對話，點選「開始解析」立即使用。",
        );
      }

      res.send("1|OK");
    } catch (err) {
      console.error("[ecpay return] error:", err);
      // 讓綠界不要一直重送把你打爆（先回 OK，錯誤看 log）
      res.send("1|OK");
    }
  },
);

// ==========================
// ✅ 付款完成導引頁（給使用者看的）
// 用途：綠界付款完成後，ClientBackURL 會把使用者導回這頁
// ==========================
app.get("/pay/success", (req, res) => {
  const officialLineUrl =
    process.env.OFFICIAL_LINE_URL || "line://ti/p/@415kfyus";

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <!doctype html>
    <html lang="zh-Hant">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>付款完成</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", Arial, "PingFang TC", sans-serif;
                 background:#f6f7fb; margin:0; padding:24px; }
          .card { max-width:520px; margin:0 auto; background:#fff; border-radius:16px; padding:20px 18px;
                  box-shadow:0 6px 20px rgba(0,0,0,.08); }
          h2 { margin:0 0 10px; font-size:20px; }
          p { margin:8px 0; color:#333; line-height:1.6; }
          .btn { display:block; text-align:center; padding:12px 14px; margin-top:14px;
                 background:#06c755; color:#fff; text-decoration:none; border-radius:12px; font-weight:700; }
          .hint { font-size:12px; color:#666; margin-top:10px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>✅ 付款完成</h2>
          <p>你可以關閉此視窗，回到 LINE 繼續使用服務。</p>
          <p>或點擊下方按鈕返回 LINE。</p>

          <a class="btn" href="${officialLineUrl}">回到 LINE</a>

          <p class="hint">若未自動跳回，請手動關閉此頁並回到 LINE 對話。</p>
        </div>
      </body>
    </html>
  `);
});

// LINE Webhook 入口
app.post("/line/webhook", async (req, res) => {
  //console.log("💬 收到一個 LINE Webhook 事件：");
  //console.log(JSON.stringify(req.body, null, 2));

  res.status(200).end();

  const events = req.body.events || [];
  for (const event of events) {
    try {
      await handleLineEvent(event);
    } catch (err) {
      console.error("處理 LINE 事件時發生錯誤：", err);
    }
  }
});

// 小占卜：解析生日輸入
// 支援格式：
// 1) 1992-12-05-0830
// 2) 1992-12-05-辰時
// 3) 1992-12-05-辰
function parseMiniBirthInput(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;

  const parts = trimmed.split("-");
  if (parts.length < 4) {
    // 少了時間/時辰那段
    return null;
  }

  const [year, month, day, rawLast] = parts;

  // 檢查日期格式 YYYY-MM-DD
  const dateStr = `${year}-${month}-${day}`;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(dateStr)) {
    return null;
  }

  const last = rawLast.trim();

  // 1) 如果是 4 位數字，當成 HHmm
  if (/^\d{4}$/.test(last)) {
    const hh = last.slice(0, 2);
    const mm = last.slice(2, 4);
    // 簡單檢查一下 00–23 / 00–59
    const hNum = Number(hh);
    const mNum = Number(mm);
    if (hNum < 0 || hNum > 23 || mNum < 0 || mNum > 59) {
      return null;
    }
    return {
      raw: trimmed,
      date: dateStr, // "1992-12-05"
      timeType: "hm", // 時分
      time: `${hh}:${mm}`, // "08:30"
      branch: null,
    };
  }

  // 2) 如果是 「辰」 或 「辰時」這種地支
  const BRANCHES = "子丑寅卯辰巳午未申酉戌亥".split("");
  let branch = last;
  // 有些人會打「辰時」
  if (branch.endsWith("時")) {
    branch = branch.slice(0, branch.length - 1);
  }

  if (BRANCHES.includes(branch)) {
    return {
      raw: trimmed,
      date: dateStr,
      timeType: "branch", // 地支時辰
      time: null,
      branch, // "辰"
    };
  }

  // 3) 特例：未知時辰
  if (last === "未知") {
    return {
      raw: trimmed,
      date: dateStr,
      timeType: "unknown",
      time: null,
      branch: null,
    };
  }

  // 其他格式不吃
  return null;
}
///把 parse 出來的 birthObj 轉成「人話時間」字串
function formatBirthForDisplay(birth) {
  if (!birth || !birth.date) return "未提供";

  const datePart = birth.date; // "YYYY-MM-DD"

  // 1) 使用者有輸入明確時分：1992-12-05-0830
  if (birth.timeType === "hm" && birth.time) {
    return `${datePart} ${birth.time}`; // e.g. "1992-12-05 08:30"
  }

  // 2) 使用者用地支時辰：1992-12-05-辰 / 辰時
  if (birth.timeType === "branch" && birth.branch) {
    // 不顯示「辰」這個字，直接換成時間區間（人話，不講地支）
    const rangeMap = {
      子: "23:00–01:00",
      丑: "01:00–03:00",
      寅: "03:00–05:00",
      卯: "05:00–07:00",
      辰: "07:00–09:00",
      巳: "09:00–11:00",
      午: "11:00–13:00",
      未: "13:00–15:00",
      申: "15:00–17:00",
      酉: "17:00–19:00",
      戌: "19:00–21:00",
      亥: "21:00–23:00",
    };

    const range = rangeMap[birth.branch] || null;
    if (range) {
      return `${datePart} 約 ${range}`;
    }
    return `${datePart} 時間約略`;
  }

  // 3) 時辰未知
  if (birth.timeType === "unknown") {
    return `${datePart}（時間未知）`;
  }

  // 4) 其他奇怪情況，至少有日期
  return datePart;
}
// --- 六爻用：地支時辰 → 大約整點小時（取中間值） ---
function branchToHourForLiuYao(branch) {
  const map = {
    子: 0, // 23~01 → 取 00
    丑: 1, // 01~03
    寅: 3, // 03~05
    卯: 5, // 05~07
    辰: 7, // 07~09
    巳: 9, // 09~11
    午: 11, // 11~13
    未: 13, // 13~15
    申: 15, // 15~17
    酉: 17, // 17~19
    戌: 19, // 19~21
    亥: 21, // 21~23
  };
  return map[branch] ?? 12; // 找不到就抓中午當 fallback
}
// --- 六爻用：從 state 取出起卦時間參數 ---
function buildLiuYaoTimeParams(state) {
  const data = state.data || {};
  let y, m, d, h, mi;
  let desc = "";

  if (data.timeMode === "custom" && data.customBirth && data.customBirth.date) {
    const birth = data.customBirth;
    const [yy, mm, dd] = birth.date.split("-").map((v) => Number(v));
    y = yy;
    m = mm;
    d = dd;

    if (birth.timeType === "hm" && birth.time) {
      const [hh, minute] = birth.time.split(":").map((v) => Number(v));
      h = hh;
      mi = minute;
      desc = `起卦時間（指定）：${birth.date} ${birth.time}`;
    } else if (birth.timeType === "branch" && birth.branch) {
      h = branchToHourForLiuYao(birth.branch);
      mi = 0;
      desc = `起卦時間（指定）：${birth.date} ${birth.branch}時（折算為約 ${h}:00）`;
    } else {
      // 沒給時辰 → 先抓中午當 fallback
      h = 12;
      mi = 0;
      desc = `起卦時間（指定）：${birth.date}（未提供時辰，暫以中午 12:00 代入）`;
    }
  } else {
    // timeMode === "now" 或其他奇怪狀況，一律當「現在」
    const now = data.questionTime ? new Date(data.questionTime) : new Date();
    y = now.getFullYear();
    m = now.getMonth() + 1;
    d = now.getDate();
    h = now.getHours();
    mi = now.getMinutes();
    const hh = String(h).padStart(2, "0");
    const mm = String(mi).padStart(2, "0");
    desc = `起卦時間（現在）：${y}-${String(m).padStart(2, "0")}-${String(
      d,
    ).padStart(2, "0")} ${hh}:${mm}`;
  }

  return { y, m, d, h, mi, desc };
}

// 中文指令 → section key 對照表
const MB_CMD_TO_KEY = {
  看人格特質: "personality",
  看人際關係: "social",
  看伴侶關係: "partner",
  看家庭互動: "family",
  看學業工作: "study_work",
};

async function handleMbText(userId, text) {
  if (!text || typeof text !== "string") return false;

  // 只攔我們定義的這些指令，避免誤傷別的對話
  const isMbCmd =
    text === "看總覽" ||
    text === "看全部" ||
    text === "看四柱五行" ||
    Object.prototype.hasOwnProperty.call(MB_CMD_TO_KEY, text);

  if (!isMbCmd) return false;

  const cached = mbGet(userId);
  if (!cached) {
    await pushText(
      userId,
      "你剛剛那份測算結果我找不到了（可能隔太久）。你再輸入一次：八字測算",
    );
    return true;
  }

  if (text === "看總覽") {
    await mbMenu(userId, cached);
    return true;
  }

  if (text === "看全部") {
    await mbAll(userId, cached);
    return true;
  }

  if (text === "看四柱五行") {
    await mbInfo(userId, cached);
    return true;
  }

  // 主題頁
  const secKey = MB_CMD_TO_KEY[text];
  if (secKey) {
    await mbPage(userId, cached, secKey);
    return true;
  }

  return false;
}

//////////////////////////////////////
/// 在 handleLineEvent 把聊天預約接進來 ///
//////////////////////////////////////
async function handleLineEvent(event) {
  const userId = event.source && event.source.userId;

  // 沒 userId（例如 group、某些事件）就先略過
  if (!userId) {
    console.log("沒有 userId 的事件，略過：", event.type);
    return;
  }

  const text = event.message?.text?.trim();

  // ✅ 先攔 MB 指令，避免掉到其它 flow
  if (await handleMbText(userId, text)) return;

  // 取出這個使用者目前的對話狀態
  const state = conversationStates[userId] || null;

  // ==========================
  // 先處理 postback（按 Flex 按鈕）
  // ==========================
  if (event.type === "postback") {
    const data = event.postback.data || "";
    console.log(`📦 收到 postback：${data}`);

    // 交給專門處理 postback 的 router
    await routePostback(userId, data);
    return;
  }

  // ==========================
  // 處理文字訊息
  // ==========================
  if (event.type === "message" && event.message.type === "text") {
    const text = (event.message.text || "").trim();

    // --------------------------------------------------
    // 0) 優惠碼攔截（輕量版）
    //
    // 用途：
    // - 讓被 gate 擋住的使用者，直接輸入優惠碼也能兌換
    // - 避免一定要先進入流程，才吃得到優惠碼
    //
    // 規則：
    // - 只有「看起來像優惠碼」才嘗試兌換
    // - 預約流程（booking）不吃，避免體驗怪
    // - 若成功/失敗有回覆，直接結束本次事件
    // --------------------------------------------------
    const looksLikeBirthday = /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(text);

    const looksLikeCoupon =
      !looksLikeBirthday &&
      (/^(優惠碼|coupon)\s+[A-Za-z0-9_]{4,20}$/i.test(text) ||
        /^(?=.*[A-Za-z])[A-Za-z0-9_]{4,20}$/.test(text));

    const currentMode = conversationStates[userId]?.mode || null;

    if (looksLikeCoupon && currentMode !== "booking") {
      const hit = await tryRedeemCouponFromText(userId, text);
      if (hit.handled) return;
    }

    // --------------------------------------------------
    // 1) Abort：使用者主動中斷流程
    // --------------------------------------------------
    if (isAbortCommand(text)) {
      delete conversationStates[userId];
      await pushText(
        userId,
        "已中斷目前流程 ✅\n\n你可以輸入：常見問題 / 八字測算 / 八字合婚 / 六爻占卜",
      );
      return;
    }

    // --------------------------------------------------
    // 2) Entry：入口指令（切換功能）
    // - 清掉舊 state，讓新流程乾淨開始
    // --------------------------------------------------
    if (isEntryCommand(text)) {
      delete conversationStates[userId];
    }

    /***************************************
     * [六爻總覽導航]：讓使用者在聊天室輸入「看過去」等指令
     * - 你在 handleLineEvent 裡先呼叫它，吃到就 return
     ***************************************/
    if (await handleLyNav(userId, text)) return;

    // --------------------------------------------------
    // 3) 若目前在某個對話流程中，優先交給該流程處理（例如預約 / 六爻 / 合婚）
    // --------------------------------------------------
    if (state) {
      const handled = await routeByConversationState(
        userId,
        text,
        state,
        event,
      );
      if (handled) return;
    }

    // --------------------------------------------------
    // 4) 不在流程中 → 當成一般指令處理
    //    沒有在進行中的對話 → 看是不是指令（預約 / 八字測算 / 其他）
    // --------------------------------------------------
    await routeGeneralCommands(userId, text);
    return;
  }

  console.log("目前尚未處理的事件類型：", event.type);
}

//routeGeneralCommands：處理「進入某個模式」的指令(入口/觸發點)
//也就是說這是路由路口
//預約：丟服務/日期/時段 Flex（你的 booking flow）
//這裡先做成「設定 state + 丟教學 Flex」
async function routeGeneralCommands(userId, text) {
  // 1) 預約（維持原樣）
  if (text === "關於八字/紫微/占卜") {
    conversationStates[userId] = {
      mode: "booking",
      stage: "idle",
      data: {},
    };
    await sendServiceSelectFlex(userId);
    return;
  }

  /* =========================
   * STEP 1.1 新增：常見問題分類入口
   * - 先不進 booking
   * - 先讓使用者選大類//回朔
   * ========================= */
  if (
    text === "預約諮詢" ||
    text === "常見問題" ||
    text === "問題" ||
    text === "我想問"
  ) {
    await sendQuestionCategoryCarouselFlex(userId);
    return;
  }

  // 2) 八字格局解析（原本「八字測算 / 小占卜」）
  // ✅ 改成：先給服務說明卡 +「開始」按鈕（postback），不先 gate
  if (text === "八字測算" || text === "小占卜" || text === "八字格局解析") {
    await sendServiceIntroFlex(userId, "minibazi");
    return;
  }

  // 3) 八字合婚解析
  // ✅ 改成：先給服務說明卡 +「開始」按鈕（postback），不先 gate
  if (text === "八字合婚" || text === "八字合婚解析") {
    await sendServiceIntroFlex(userId, "bazimatch");
    return;
  }

  // 4) 六爻卦象解析（原本「六爻占卜」）
  // ✅ 改成：先給服務說明卡 +「開始」按鈕（postback），不先 gate
  if (text === "六爻占卜" || text === "六爻卦象解析") {
    await sendServiceIntroFlex(userId, "liuyao");
    return;
  }
  /* 
  ==========================================================
  ✅ 使用者輸入文字：記錄到 admin_logs
  ==========================================================
  ✅ 為什麼這樣改：
  - 你要把使用者說的話留存，方便後台追查/篩選
  - 但你不想每次都 pushText 回去干擾使用者
  - 所以改成「只寫 DB log」
  ==========================================================
  */
  //* ✅ 簡單記錄：使用者說話（DB 會自動寫 created_at=NOW()） */
  const msg = String(text || "") // ✅ 避免空字串/爆長,500字內
    .trim()
    .slice(0, 500);
  await adminLogDB("info", "user_text", msg, { userId });

  // 5)
  //console.log("=========有聽到使用者說話=========", userId);

  // 6) 其他
  //await pushText(userId, `我有聽到你說：「${text}」，目前是機器人回覆唷`);
}

//routeByConversationState：依照 state 分發到各個 flow//
async function routeByConversationState(userId, text, state, event) {
  // 用 mode 區分是哪一條流程
  const mode = state.mode || null;

  if (!mode) return false;

  if (mode === "booking") {
    // 交給預約流程處理
    return await handleBookingFlow(userId, text, state, event);
  }
  /*
  // 在「付費功能流程」內攔截優惠碼
  if (mode === "mini_bazi" || mode === "bazi_match" || mode === "liuyao") {
    console.log("有進到攔截優惠碼的流程\n");
    const hit = await tryRedeemCouponFromText(userId, text);
    if (hit.handled) return true; // ✅ 已處理優惠碼（成功/失敗都回覆了），不要再往下跑
  }*/

  if (mode === "mini_bazi") {
    // 交給八字測算流程處理
    return await handleMiniBaziFlow(userId, text, state, event);
  }
  //八字合婚
  if (mode === "bazi_match") {
    return await handleBaziMatchFlow(userId, text, state, event);
  }

  // 新增：六爻占卜
  if (mode === "liuyao") {
    return await handleLiuYaoFlow(userId, text, state, event);
  }
  // 其他未支援的 mode
  return false;
}

// routePostback：按 Flex 按鈕時怎麼分派
async function routePostback(userId, data) {
  const params = new URLSearchParams(data);
  const action = params.get("action");
  const service = params.get("service");

  /* ✅ 永遠抓最新 state（避免舊 state 被帶進來） */
  const getState = () => conversationStates[userId] || null;

  /* ✅【最小改動】補上 state 變數：避免 ReferenceError: state is not defined */
  let state = getState();

  /* =========================================
   * 共用：postback gate
   * - 限制按鈕只能在正確流程/階段使用
   * ========================================= */
  const postbackGate = (state, { allowModes = [], allowStages = [] }) => {
    if (!state) return false;

    if (allowModes.length > 0 && !allowModes.includes(state.mode)) return false;

    if (allowStages.length > 0 && !allowStages.includes(state.stage))
      return false;

    return true;
  };

  /* =========================================
   * 共用：舊按鈕提示
   * ========================================= */
  const replyOldMenuHint = async (hintText) => {
    await pushText(
      userId,
      hintText ||
        "這個選單看起來是舊的 😅\n\n請輸入：八字測算 / 八字合婚 / 六爻占卜 重新開始。",
    );
  };

  // ✅ 使用者按下「開始」：先 gate，再進流程
  if (action === "start" && service) {
    /* ✅ 只處理你支援的 service，避免亂清 state */
    const SUPPORTED = ["minibazi", "bazimatch", "liuyao", "booking"];

    if (!SUPPORTED.includes(service)) {
      await pushText(userId, "這個服務代碼我不認識欸，請從選單再點一次 🙏");
      return;
    }

    /* ✅ 確認是支援的服務後，才清舊 state */
    delete conversationStates[userId];
    state = getState(); // ✅【最小改動】同步更新本地 state

    const labelMap = {
      minibazi: "八字格局解析",
      bazimatch: "八字合婚解析",
      liuyao: "六爻卦象解析",
      booking: "預約服務",
    };

    const gate = await gateFeature(
      userId,
      service,
      labelMap[service] || service,
    );
    if (!gate.allow) return;

    if (service === "minibazi") {
      conversationStates[userId] = {
        mode: "mini_bazi",
        stage: "wait_mode",
        data: {},
      };
      await sendBaziMenuFlex(userId);
      return;
    }

    if (service === "bazimatch") {
      conversationStates[userId] = {
        mode: "bazi_match",
        stage: "wait_male_birth_input",
        data: {},
      };

      await pushText(
        userId,
        "八字合婚模式啟動 💍\n\n" +
          "請先輸入「男方」的西元生日與時間（時間可省略）：\n\n" +
          "1) 1992-12-05-0830\n" +
          "2) 1992-12-05-辰時\n" +
          "3) 1992-12-05-辰\n" +
          "如果不想提供時辰，可以輸入：1992-12-05-未知",
      );
      return;
    }

    if (service === "liuyao") {
      conversationStates[userId] = {
        mode: "liuyao",
        stage: "wait_topic",
        data: {},
      };
      await sendLiuYaoMenuFlex(userId);
      return;
    }

    /* ✅ booking：你要對齊 handleBookingFlow 的第一關 stage */
    if (service === "booking") {
      conversationStates[userId] = {
        mode: "booking",
        stage: "waiting_name",
        data: {},
      };
      await pushText(
        userId,
        "好的～我先幫你開啟預約流程 ✅\n\n請先輸入你的姓名（或輸入「略過」）",
      );
      return;
    }

    await pushText(userId, "這個服務代碼我不認識欸，請從選單再點一次 🙏");
    return;
  }

  // 預約流程的選服務 / 選日期 / 選時段
  if (
    action === "choose_service" ||
    action === "choose_date" ||
    action === "choose_slot"
  ) {
    /* ✅ 用最新 state，避免 postback 帶到舊/空狀態 */
    const state = getState();
    return await handleBookingPostback(userId, action, params, state);
  }

  /* =========================
   * STEP 2：回到「分類」Carousel
   * ========================= */
  if (action === "show_qcats") {
    await sendQuestionCategoryCarouselFlex(userId);
    return;
  }

  /* =========================
   * STEP 2：選大類 → 丟題目清單
   * ========================= */
  if (action === "choose_qcat") {
    const catId = params.get("cat");
    await sendQuestionListCarouselFlex(userId, catId);
    return;
  }

  /* =========================
   * STEP 2：選題目 → 存進 state → 導入 booking
   * ========================= */ //回朔2
  if (action === "choose_q") {
    const catId = params.get("cat");
    const qid = params.get("q");

    const cat = QUESTION_CATEGORIES.find((x) => x.id === catId);
    const list = QUESTION_BANK[catId] || [];
    const q = list.find((x) => x.qid === qid);

    /* 防呆：找不到題目就提醒 */
    if (!cat || !q) {
      await pushText(
        userId,
        "我有收到你的選擇，但題目資料對不上 🙏\n你可以再選一次。",
      );
      await sendQuestionCategoryCarouselFlex(userId);
      return;
    }

    /* =========================================================
     * STEP 3：選題目後，直接走「命理諮詢(chat_line)」→ 選日期 → 選時段
     * - 跳過 sendServiceSelectFlex（服務選擇）
     * - serviceId 統一固定為 chat_line（命理諮詢）
     * ========================================================= */
    if (action === "choose_q") {
      const catId = params.get("cat");
      const qid = params.get("q");

      const cat = QUESTION_CATEGORIES.find((x) => x.id === catId);
      const list = QUESTION_BANK[catId] || [];
      const q = list.find((x) => x.qid === qid);

      /* 【防呆】找不到題目就回到分類 */
      if (!cat || !q) {
        await pushText(
          userId,
          "我有收到你的選擇，但題目資料對不上 🙏\n你可以再選一次。",
        );
        await sendQuestionCategoryCarouselFlex(userId);
        return;
      }

      /* 【核心】直接把服務固定成 chat_line（命理諮詢）
       * - stage 直接切到 waiting_date
       * - 後面 choose_date / choose_slot 都會沿用 state.data.serviceId
       */
      conversationStates[userId] = {
        mode: "booking",
        stage: "waiting_date",
        data: {
          /* ✅ 固定服務為「命理諮詢」 */
          serviceId: "chat_line",

          /* ✅ 保留你要的問句資料（後續可寫入 note 或通知用） */
          qCategoryId: catId,
          qCategoryTitle: cat.title,
          questionId: qid,
          questionText: q.full,
        },
      };

      /* 【回覆一句】讓使用者安心：你有記下他的問題，接下來選時段 */
      await pushText(
        userId,
        `收到～你想問的是：\n「${q.full}」\n\n命理諮詢：NT$600／小時（含方向釐清＋建議策略）。\n\n可以的話我先幫你安排時段，請選擇日期。`,
      );

      /* ✅ 直接丟日期 Carousel（用 chat_line） */
      await sendDateCarouselFlex(userId, "chat_line");

      return;
    }
  }

  // 🔮 八字測算：使用者從主選單選了「格局 / 流年 / 流月 / 流日」
  if (action === "bazi_mode") {
    const state = getState();

    /* ✅ 只允許在 mini_bazi + wait_mode 使用 */
    const ok = postbackGate(state, {
      allowModes: ["mini_bazi"],
      allowStages: ["wait_mode"],
    });

    if (!ok) {
      await replyOldMenuHint(
        "這個八字選單是舊的 😅\n請輸入「八字測算」重新開始。",
      );
      return;
    }

    const mode = params.get("mode"); // pattern / year / month / day
    const ALLOWED = ["pattern", "year", "month", "day"];
    if (!ALLOWED.includes(mode)) {
      await pushText(userId, "這個八字測算按鈕目前沒有對應的解析方式。");
      return;
    }

    conversationStates[userId] = {
      mode: "mini_bazi",
      stage: "wait_gender",
      data: { baziMode: mode },
    };

    // ✅ 改成按鈕
    await sendGenderSelectFlex(userId, {
      title: "八字測算 · 性別選擇",
      actionName: "minibazi_gender",
    });
    return;
  }

  // ✅ 合婚解鎖（分享後按這顆）
  if (action === "bazimatch_unlock") {
    const cached = getCachedBaziMatchResult(userId);

    if (!cached) {
      await pushText(
        userId,
        "解鎖按鈕我有收到✅\n但這份預覽已過期或你已經解鎖過了～",
      );
      await pushText(
        userId,
        "【合婚解鎖流年任務】🧧🐴\n\n" +
          "現在起，只要完成下面幾個步驟👇\n\n" +
          "① 算完「八字合盤」\n" +
          "② 把結果分享到 Threads\n" +
          "③ 將分享的截圖傳到本官方 LINE\n" +
          "  (記得帳號要打開，小編會檢查唷！)\n" +
          "④ 在下方留言輸入\n" +
          "👉「馬年行大運」\n\n" +
          "完成後就可以獲得：\n" +
          "🎁 專屬你的「2026 年流年解析」✨",
      );
      return;
    }

    // ✅ 送完整版（shareLock=false）
    await sendBaziMatchResultFlex(userId, {
      ...cached,
      shareLock: false,
    });

    // ✅ 這一刻才扣次（首免會在這裡被消耗）
    await quotaUsage(userId, "bazimatch");

    clearCachedBaziMatchResult(userId);
    return;
  }

  /* =========================================
   * ✅ 八字測算：選擇男命 / 女命（按鈕）
   * action=minibazi_gender&gender=male|female
   * ========================================= */
  if (action === "minibazi_gender") {
    const state = getState();

    /* ✅ 只允許在 mini_bazi + wait_gender 使用（避免舊按鈕或亂序點擊） */
    const ok = postbackGate(state, {
      allowModes: ["mini_bazi"],
      allowStages: ["wait_gender"],
    });

    if (!ok) {
      await replyOldMenuHint(
        "這個性別選單是舊的 😅\n請輸入「八字測算」重新開始。",
      );
      return;
    }

    const gender = params.get("gender"); // male / female
    if (!["male", "female"].includes(gender)) {
      await pushText(userId, "性別選擇怪怪的，請再選一次～");
      await sendGenderSelectFlex(userId, {
        title: "八字測算 · 性別選擇",
        actionName: "minibazi_gender",
      });
      return;
    }

    /* ✅ 正常推進 */
    state.data = state.data || {};
    state.data.gender = gender;
    state.stage = "wait_birth_input";
    conversationStates[userId] = state;

    const genderLabel = gender === "male" ? "男命" : "女命";

    await pushText(
      userId,
      `好的，這次就先以「${genderLabel}」來看。\n\n` +
        "接下來請輸入你的西元生日與時間（時間可省略）：\n\n" +
        "1) 1992-12-05-未知\n" +
        "2) 1992-12-05-0830\n" +
        "3) 1992-12-05-辰時 或 1992-12-05-辰\n\n" +
        "如果不想提供時辰，可以在最後寫「未知」。",
    );
    return;
  }

  // ⭐ 六爻：選主題（感情 / 事業 / 財運 / 健康）
  if (action === "liuyao_topic") {
    const state = getState();

    /* ✅ 只允許在 liuyao + wait_topic 使用 */
    const ok = postbackGate(state, {
      allowModes: ["liuyao"],
      allowStages: ["wait_topic"],
    });

    if (!ok) {
      await replyOldMenuHint(
        "這個占卜選單是舊的 😅\n請輸入「六爻占卜」重新開始。",
      );
      return;
    }

    const topic = params.get("topic"); // love / career / wealth / health
    const allow = ["love", "career", "wealth", "health"];

    if (!allow.includes(topic)) {
      await pushText(userId, "這個占卜主題我看不懂，請重新點一次按鈕試試。");
      return;
    }

    conversationStates[userId] = {
      mode: "liuyao",
      stage: "wait_gender",
      data: { topic },
    };

    // ✅ 改成按鈕
    await sendGenderSelectFlex(userId, {
      title: "六爻占卜 · 性別選擇",
      actionName: "liuyao_gender",
    });
    return;
  }

  /* =========================================
   * ✅ 六爻占卜：選擇男占 / 女占（按鈕）
   * action=liuyao_gender&gender=male|female
   * ========================================= */
  if (action === "liuyao_gender") {
    const state = getState();

    /* ✅ 只允許在 liuyao + wait_gender 使用（避免舊按鈕或亂序點擊） */
    const ok = postbackGate(state, {
      allowModes: ["liuyao"],
      allowStages: ["wait_gender"],
    });

    if (!ok) {
      await replyOldMenuHint(
        "這個性別選單是舊的 😅\n請輸入「六爻占卜」重新開始。",
      );
      return;
    }

    const gender = params.get("gender"); // male / female
    if (!["male", "female"].includes(gender)) {
      await pushText(userId, "性別選擇怪怪的，請再選一次～");
      await sendGenderSelectFlex(userId, {
        title: "六爻占卜 · 性別選擇",
        actionName: "liuyao_gender",
      });
      return;
    }

    /* ✅ 正常推進 */
    state.data = state.data || {};
    state.data.gender = gender;
    state.stage = "wait_time_mode";
    conversationStates[userId] = state;

    await sendLiuYaoTimeModeFlex(userId);
    return;
  }

  // 六爻：選起卦時間模式（現在 / 指定）
  if (action === "liuyao_time_mode") {
    const mode = params.get("mode"); // now / custom

    //永遠抓最新狀態
    const currState = getState();

    //
    //const currState = state || conversationStates[userId];

    if (!currState || currState.mode !== "liuyao") {
      await pushText(
        userId,
        "目前沒有正在進行的六爻占卜流程，如果要重來，可以先輸入「六爻占卜」。",
      );
      return;
    }

    if (mode === "now") {
      currState.data.timeMode = "now";
      currState.data.questionTime = new Date().toISOString();
      currState.stage = "collect_yao_notice";
      conversationStates[userId] = currState;

      await sendLiuYaoNoticeAndAskFirstYao(userId, currState);
      return;
    }

    if (mode === "custom") {
      currState.data.timeMode = "custom";
      currState.stage = "wait_custom_time_input";
      conversationStates[userId] = currState;

      await pushText(
        userId,
        "好的，我們用「指定時間」起卦。\n\n請輸入此卦的時間點，格式如下：\n\n" +
          "1) 2025-11-24-2150\n" +
          "2) 2025-11-24-亥時\n" +
          "3) 2025-11-24-亥\n\n" +
          "⚠️ 六爻起卦盡量不要用「未知」，至少要大約時辰區間。",
      );
      return;
    }

    await pushText(userId, "起卦時間的選項怪怪的，請再點一次按鈕看看。");
    return;
  }

  // ============================
  // ✅ 儀式關卡 1：靜心完成 → 進請神文 → 出「開始搖爻」
  // ============================
  if (action === "liuyao_calm") {
    const currState = state || conversationStates[userId];
    if (!currState || currState.mode !== "liuyao") {
      await pushText(
        userId,
        "目前沒有正在進行的六爻流程。想開始請輸入：六爻占卜",
      );
      return;
    }

    // 防呆：避免不在該節點亂按
    if (
      currState.stage !== "wait_calm" &&
      currState.stage !== "collect_yao_notice"
    ) {
      // collect_yao_notice 是你既有的 stage 名稱，保留兼容
    }

    const topicLabel =
      currState.data.topic === "love"
        ? "感情"
        : currState.data.topic === "career"
          ? "事業"
          : currState.data.topic === "wealth"
            ? "財運"
            : "健康";

    currState.stage = "wait_spelled";
    conversationStates[userId] = currState;

    await sendLiuYaoSpellFlex(userId, topicLabel);
    return;
  }

  // ============================
  // ✅ 儀式關卡 2：請神完成 → 出「開始搖爻」Flex（你已經有 sendLiuYaoStartRollFlex）
  // ============================
  if (action === "liuyao_spelled") {
    const currState = state || conversationStates[userId];
    if (!currState || currState.mode !== "liuyao") {
      await pushText(
        userId,
        "目前沒有正在進行的六爻流程。想開始請輸入：六爻占卜",
      );
      return;
    }

    currState.stage = "wait_start_roll";
    conversationStates[userId] = currState;

    // 你原本的 helper：出一個 primary button「開始搖爻」
    await sendLiuYaoStartRollFlex(userId);
    return;
  }

  // ✅ 儀式關卡 3：開始搖爻 → 進 collect_yao 丟第 1 爻
  if (action === "liuyao_start_roll") {
    const currState = state || conversationStates[userId];
    if (!currState || currState.mode !== "liuyao") {
      await pushText(
        userId,
        "目前沒有正在進行的六爻流程。想開始請輸入：六爻占卜",
      );
      return;
    }

    currState.stage = "collect_yao";
    currState.data.yaoIndex = 1;
    currState.data.yy = "";
    conversationStates[userId] = currState;

    await pushText(userId, "第一爻。請默念問題，然後擲幣。");
    await sendLiuYaoRollFlex(userId, 1, "");
    return;
  }

  // ============================
  // ✅ 儀式關卡 4：退神完成 → 丟出 pending AI 結果
  // ============================
  /***************************************
   * [退神完成]：不再丟長文，改丟「總覽頁」
   ***************************************/
  if (action === "liuyao_sendoff") {
    const currState = state || conversationStates[userId];
    if (!currState || currState.mode !== "liuyao") {
      await pushText(userId, "目前沒有正在進行的六爻流程。");
      return;
    }

    const aiText = currState.data?.pendingAiText;
    if (!aiText) {
      await pushText(
        userId,
        "我這邊還在整理內容，稍等3分鐘再按一次「退神完成」也可以～在等待期間請別使用其他服務，以免卦飛走～",
      );
      return;
    }

    /* 1) 解析 AI 文本 -> past/now/future/summary */
    const parsed = lyParse(aiText);

    /* 2) 存 cache：讓使用者可以點章節 */
    const meta = {
      topicLabel: LIU_YAO_TOPIC_LABEL?.[currState.data?.topic] || "感情",
      genderLabel: currState.data?.gender === "female" ? "女命" : "男命",
      bengua: currState.data?.hexData?.bengua || "",
      biangua: currState.data?.hexData?.biangua || "",
    };
    lySave(userId, { meta, parsed });

    /* 3) 丟總覽頁 */
    await lyMenuFlex(userId, meta, parsed);

    /* 4) 收束落款 */
    await pushText(userId, "卦已立，神已退。\n言盡於此，願你心定路明。");

    delete conversationStates[userId];
    return;
  }

  // ============================
  // ✅ 儀式關卡 5：過中爻後「默念完畢」→ 進入第四爻
  // ============================
  if (action === "liuyao_mid_continue") {
    const currState = state || conversationStates[userId];
    if (!currState || currState.mode !== "liuyao") {
      await pushText(
        userId,
        "目前沒有正在進行的六爻流程。想開始請輸入：六爻占卜",
      );
      return;
    }

    // 必須卡在中爻關卡才吃（避免亂按）
    if (currState.stage !== "wait_mid_gate") {
      await pushText(userId, "目前不在過中爻的節點，請繼續依流程操作即可。");
      return;
    }

    // 回到 collect_yao，準備第 4 爻
    currState.stage = "collect_yao";
    conversationStates[userId] = currState;

    await pushText(userId, "第四爻。請默念問題，然後擲幣。");
    await sendLiuYaoRollFlex(userId, 4, currState.data?.yy || "");
    return;
  }

  // ============================
  // ✅ 六爻：擲幣選「人頭數」（0~3）
  // ============================
  if (action === "liuyao_roll") {
    const v = params.get("v"); // "0"~"3"
    const currState = state || conversationStates[userId];

    // 值不對就重送按鈕
    if (!/^[0-3]$/.test(v)) {
      await pushText(userId, "這次選擇怪怪的，請再選一次～");
      if (currState?.mode === "liuyao" && currState.stage === "collect_yao") {
        await sendLiuYaoRollFlex(
          userId,
          currState.data?.yaoIndex || 1,
          currState.data?.yy || "",
        );
      }
      return;
    }

    // 必須在六爻流程且 collect_yao 才吃
    if (
      !currState ||
      currState.mode !== "liuyao" ||
      currState.stage !== "collect_yao"
    ) {
      await pushText(userId, "目前沒有在起卦流程中。想占卜請輸入：六爻占卜");
      return;
    }

    // 初始化
    if (!currState.data.yy) currState.data.yy = "";
    if (!currState.data.yaoIndex) currState.data.yaoIndex = 1;

    const nowIndex = currState.data.yaoIndex; // ✅ 這一爻的序號（1~6）

    // 記錄本爻
    currState.data.yy += v;
    currState.data.yaoIndex = nowIndex + 1; // 下一爻
    conversationStates[userId] = currState;

    // 儀式確認（先定此爻）
    await pushText(userId, `第 ${nowIndex} 爻已定。天地有應。`);

    // ✅ 過中爻：停頓 + 默念過門（第 3 爻結束後才出現）
    if (nowIndex === 3) {
      //await pushText(userId, "已過中爻。卦象逐漸成形。");

      // 卡住流程：要求使用者完成「默念完畢」才進第 4 爻
      currState.stage = "wait_mid_gate";
      conversationStates[userId] = currState;

      await sendLiuYaoMidGateFlex(userId);
      return; // ✅ 重要：不要直接送第 4 爻
    }

    // 還沒滿六爻 → 直接送下一爻選單
    if (currState.data.yy.length < 6) {
      await sendLiuYaoRollFlex(
        userId,
        currState.data.yaoIndex,
        currState.data.yy,
      );
      return;
    }

    // ✅ 六爻俱全：先封卦（完成版 Flex）
    const finalCode = currState.data.yy.slice(0, 6);
    currState.stage = "wait_sendoff"; // ✅ 先進入退神關卡（重點：先退神再解卦）
    conversationStates[userId] = currState;

    // 封卦畫面：文案建議你改成「下一步要收卦退神」，避免“準備解讀”造成插隊感
    if (typeof sendLiuYaoCompleteFlex === "function") {
      await sendLiuYaoCompleteFlex(userId, finalCode);
    } else {
      await pushFlex(userId, "六爻俱全", {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            { type: "text", text: "六爻俱全", weight: "bold", size: "lg" },
            {
              type: "text",
              text: "卦已立。\n下一步請收卦退神，完成後我將開始解讀。",
              size: "sm",
              color: "#666666",
              wrap: true,
            },
            { type: "text", text: "■■■■■■", size: "xl", weight: "bold" },
            {
              type: "text",
              text: `起卦碼：${finalCode}`,
              size: "xs",
              color: "#999999",
              wrap: true,
            },
          ],
        },
      });
    }

    // 🌒 停 5 秒，讓封卦「沉一下」
    await sleep(5000);
    // ✅ 立刻送「退神」按鈕（重點：不要等 AI 回來才送）
    await sendLiuYaoSendoffFlex(userId);

    // ✅ 然後才去算 AI（算完先存起來，等使用者按「退神完成」再送）
    try {
      const timeParams = buildLiuYaoTimeParams(currState);
      const { y, m, d, h, mi } = timeParams;

      const hexData = await getLiuYaoHexagram({
        y,
        m,
        d,
        h,
        mi,
        yy: finalCode,
      });

      currState.data.hexData = hexData;

      const { aiText } = await callLiuYaoAI({
        genderText: currState.data.gender === "female" ? "女命" : "男命",
        topicText: LIU_YAO_TOPIC_LABEL[currState.data.topic] || "感情",
        hexData: currState.data.hexData,
      });

      // ✅ 結果先存起來，等退神完成再送
      currState.data.pendingAiText = aiText;
      console.log("2274已進到routePostback:", userId);
      // ✅ quota 在這裡扣（代表解卦已完成）
      await quotaUsage(userId, "liuyao");

      // 保持 wait_sendoff（使用者按了才會送）
      currState.stage = "wait_sendoff";
      conversationStates[userId] = currState;

      return;
    } catch (err) {
      console.error("[liuyao] AI error:", err);
      await pushText(userId, "六爻解卦 AI 剛剛小卡住 😅 你可以稍後再試一次。");
      delete conversationStates[userId];
      return;
    }
  }

  // 預設：其他 action（暫時沒實作）
  await pushText(userId, `我有收到你的選擇：${data}`);
}

// 🧩 預約聊天流程：姓名 → 電話 → 備註 → 寫入 bookings.json
async function handleBookingFlow(userId, text, state, event) {
  if (!state || state.mode !== "booking") {
    return false;
  }

  const trimmed = text.trim();

  // A-1. 問姓名
  if (state.stage === "waiting_name") {
    if (!trimmed) {
      await pushText(
        userId,
        `好的，${text}，\n\n如果不方便留資料，也可以輸入「略過」。`,
      );
      return true;
    }

    // 存姓名，進入下一階段
    state.data.name = trimmed;
    /* ✅ 下一步改問性別 */
    state.stage = "waiting_gender";
    conversationStates[userId] = state;

    await pushText(
      userId,
      `好的，${trimmed}～已幫你記錄姓名。\n\n接下來請輸入性別：男 或 女\n\n你也可以輸入「略過」`,
    );
    return true;
  }

  /* -------------------------
   * A-1.1 問性別
   * ------------------------- */
  if (state.stage === "waiting_gender") {
    if (trimmed === "略過") {
      state.data.gender = "";
      state.stage = "waiting_birth";
      conversationStates[userId] = state;

      await pushText(
        userId,
        "OK～性別我先略過。\n\n接下來請輸入出生年月日（格式不限，怎麼打都可以）：\n例如 1992-12-05 或 1992/12/05 或 1992-12-05 08:30\n\n你也可以輸入「略過」",
      );
      return true;
    }

    const g = trimmed.replace(/\s+/g, "");
    if (g !== "男" && g !== "女") {
      await pushText(userId, "性別請輸入：男 或 女（或輸入「略過」）");
      return true;
    }

    state.data.gender = g;
    state.stage = "waiting_birth";
    conversationStates[userId] = state;

    await pushText(
      userId,
      `收到～性別：${g}\n\n接下來請輸入出生年月日：\n例如 1992-12-05 或\n 1992/12/05 或 \n1992-12-05 08:30\n\n不方便也可以輸入「略過」`,
    );
    return true;
  }

  /* -------------------------
   * A-1.3 問出生（不解析）
   * ------------------------- */
  if (state.stage === "waiting_birth") {
    if (trimmed === "略過") {
      state.data.birthRaw = "";

      state.stage = "waiting_phone";
      conversationStates[userId] = state;

      await pushText(
        userId,
        "OK～出生資訊我先略過。\n\n接下來請輸入「聯絡電話／聯絡方式」（手機或 LINE ID 都可以）。\n如果不方便留資料，也可以輸入「略過」。",
      );
      return true;
    }

    /* ✅ 不解析、不驗證：原文直接存 */
    state.data.birthRaw = trimmed;

    state.stage = "waiting_phone";
    conversationStates[userId] = state;

    await pushText(
      userId,
      `收到～出生資訊：${trimmed}\n\n接下來請輸入「聯絡電話／聯絡方式」（手機或 LINE ID 都可以）。\n如果不方便留資料，也可以輸入「略過」。`,
    );
    return true;
  }

  // A-2. 問電話 / 聯絡方式
  if (state.stage === "waiting_phone") {
    if (!trimmed) {
      await pushText(
        userId,
        "至少留一種聯絡方式給我（手機或 LINE ID 都可以）。\n如果不方便留資料，也可以輸入「略過」。",
      );
      return true;
    }

    state.data.phone = trimmed; // 這裡用 phone 存，不一定真的只有電話
    state.stage = "waiting_note";
    conversationStates[userId] = state;

    await pushText(
      userId,
      "我已經記下聯絡方式囉。\n\n" +
        "最後一步，請輸入「備註」（例如想問的重點、特殊情況）。\n" +
        "如果沒有特別備註，可以輸入「無」。",
    );
    return true;
  }

  /* =========================================================
   * STEP 4：把「使用者選的常見問題」自動寫入 note
   * - 使用者輸入的備註（trimmed）仍然保留
   * - 最終 note 會是：
   *   【常見問題】xxx
   *   【補充】yyy（若有）
   * ========================================================= */
  if (state.stage === "waiting_note") {
    /* 【4-1】先把使用者輸入備註整理好 */
    const userNote = trimmed === "無" ? "" : trimmed;

    /* 【4-2】如果是從常見問題流程進來，state.data.questionText 會存在
     * - 沒有的話就不寫（避免一般預約流程也被硬塞）
     */
    const pickedQuestion =
      state.data && state.data.questionText ? state.data.questionText : "";

    /* 【4-3】把 note 組合起來（合併，不覆蓋） */
    let finalNote = "";

    /* 先放「常見問題」 */
    if (pickedQuestion) {
      finalNote += `• 諮詢內容：${pickedQuestion}`;
    }

    /* 再放使用者補充（有填才放） */
    if (userNote) {
      finalNote += (finalNote ? "\n" : "") + `• 您的備註：${userNote}`;
    }

    /* 同步存回 state.data.note（讓你後續 debug 或 hero 可用） */
    state.data.note = finalNote;

    /* 【4-4】組一份 bookingBody（note 用 finalNote） */
    const bookingBody = {
      serviceId: state.data.serviceId || "chat_line",
      name: state.data.name || "",
      email: "",
      phone: state.data.phone || "",
      lineId: "",
      date: state.data.date,
      timeSlots: [state.data.timeSlot],
      note: finalNote, // ✅ 這裡改成 finalNote
      lineUserId: userId,

      /* ✅ 把性別/生日原文一起存進 bookings.json */
      gender: state.data.gender || "",
      birthRaw: state.data.birthRaw || "",
    };

    // 寫入 bookings.json
    const bookings = loadBookings();
    const newBooking = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      status: "pending",
      ...bookingBody,
    };
    bookings.push(newBooking);
    saveBookings(bookings);

    // 通知你自己
    notifyNewBooking(newBooking).catch((err) => {
      console.error("[LINE] notifyNewBooking (chat) 發送失敗：", err);
    });

    // 清掉對話狀態
    delete conversationStates[userId];

    // 如果你有 sendBookingSuccessHero，就丟 hero 給客戶
    if (typeof sendBookingSuccessHero === "function") {
      await sendBookingSuccessHero(userId, bookingBody);
    } else {
      // 沒有 hero 的備援文字版
      await pushText(
        userId,
        "預約已收到，我會再跟你確認細節 🙌\n" +
          `日期：${bookingBody.date}\n` +
          `時段：${bookingBody.timeSlots.join("、")}\n` +
          `姓名：${bookingBody.name}\n` +
          `聯絡方式：${bookingBody.phone}\n` +
          `備註：${bookingBody.note}`,
      );
    }

    return true;
  }

  // 其他 stage 沒處理到 → 回 false 讓上層有機會做別的事
  return false;
}

// 🧩 預約相關的 postback（選服務 / 選日期 / 選時段）
async function handleBookingPostback(userId, action, params, state) {
  // 1) 先確認：目前有在 booking 模式
  if (!state || state.mode !== "booking") {
    console.log(
      "[bookingPostback] 收到 booking 類型 postback，但目前不在 booking 模式，略過。",
    );
    await pushText(
      userId,
      "這個按鈕目前沒有對應的預約流程，如果要重新預約，可以直接輸入「預約」。",
    );
    return;
  }

  // 2) 選服務：action=choose_service&service=bazi
  if (action === "choose_service") {
    const serviceId = params.get("service");

    if (!serviceId) {
      await pushText(
        userId,
        "服務項目資訊缺失，麻煩你再輸入一次「預約」，重新選擇服務。",
      );
      return;
    }

    const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

    console.log(`🧭 [booking] 使用者選擇服務：${serviceId} (${serviceName})`);

    // 更新狀態：記住 service，接下來要選日期
    conversationStates[userId] = {
      //回朔2
      mode: "booking",
      stage: "waiting_date",
      data: {
        /* ✅ 保留先前資料（包含 questionText） */
        ...(state.data || {}),
        /* ✅ 更新服務 */
        serviceId,
      },
    };

    // 丟出日期 Carousel（會帶著 serviceId）
    await sendDateCarouselFlex(userId, serviceId);
    return;
  }

  // 3) 選日期：action=choose_date&service=bazi&date=YYYY-MM-DD
  if (action === "choose_date") {
    const date = params.get("date");
    // serviceId 優先用 state 裡存的，沒有再用 params
    const serviceId =
      (state.data && state.data.serviceId) ||
      params.get("service") ||
      "chat_line";
    const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

    if (!date) {
      await pushText(
        userId,
        "日期資訊有點怪怪的，麻煩你再選一次日期，或重新輸入「預約」。",
      );
      return;
    }

    console.log(`📅 [booking] 使用者選擇日期：${date}（服務：${serviceName}）`);

    // 更新狀態：記住日期，下一步要選時段
    conversationStates[userId] = {
      //回朔2
      mode: "booking",
      stage: "waiting_slot",
      data: {
        /* ✅ 保留先前資料（包含 questionText） */
        ...(state.data || {}),
        /* ✅ 更新日期與 service */
        serviceId,
        date,
      },
    };

    // 丟出「這一天的時段」 Flex
    await sendSlotsFlexForDate(userId, date, serviceId);
    return;
  }

  // 4) 選時段：action=choose_slot&service=bazi&date=YYYY-MM-DD&time=HH:MM-HH:MM
  if (action === "choose_slot") {
    // 優先用狀態裡的 service / date，避免被亂按舊按鈕搞亂
    const serviceId =
      (state.data && state.data.serviceId) ||
      params.get("service") ||
      "chat_line";
    const date = (state.data && state.data.date) || params.get("date") || null;
    const time = params.get("time");

    if (!date || !time) {
      await pushText(
        userId,
        "時段資訊有點怪怪的，麻煩你再輸入一次「預約」重新選擇。",
      );
      return;
    }

    const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

    console.log(`✅ [booking] 使用者選擇：${serviceName} ${date} ${time}`);

    // 更新這個 user 的對話狀態：已選好服務＋日期＋時段，接下來要問姓名
    conversationStates[userId] = {
      //回朔2
      mode: "booking",
      stage: "waiting_name",
      data: {
        /* ✅ 保留先前資料（包含 questionText） */
        ...(state.data || {}),
        /* ✅ 更新時段資訊 */
        serviceId,
        date,
        timeSlot: time,
      },
    };

    await pushText(
      userId,
      `已幫你記錄預約項目：${serviceName}\n時段：${date} ${time}\n\n接下來請先輸入你的「姓名」。`,
    );
    return;
  }

  // 5) 其他 booking action（暫時沒實作）
  await pushText(userId, `我有收到你的選擇：${action}（尚未實作詳細流程）。`);
}

// 八字測算對話流程（小占卜）
// 之後會在這裡處理：等待生日 → 解析 → 丟 AI → 回覆
//在這裡用 parseMiniBirthInput(text) 檢查生日格式。
//如果不合法 → 提示他重打。
//如果合法 → 把 state.data.baziMode 拿出來，丟給 callMiniReadingAI(parsed, baziMode)。
//把結果回給使用者，最後 delete conversationStates[userId]。
// ========================
//  八字測算主流程（精簡乾淨版）
// ========================
async function handleMiniBaziFlow(userId, text, state, event) {
  if (!state || state.mode !== "mini_bazi") return false;

  console.log(
    `[miniBaziFlow] from ${userId}, stage=${state.stage}, text=${text}`,
  );

  // 0) 先問「男命 / 女命」
  if (state.stage === "wait_gender") {
    const trimmed = (text || "").trim();

    let gender = null;
    if (["男", "男生", "男命", "m", "M"].includes(trimmed)) {
      gender = "male";
    } else if (["女", "女生", "女命", "f", "F"].includes(trimmed)) {
      gender = "female";
    }

    // 判斷不了就請他重打
    if (!gender) {
      await pushText(
        userId,
        "我這邊要先知道是「男命」還是「女命」。\n\n" +
          "可以輸入：男 / 男生 / 男命 或 女 / 女生 / 女命。",
      );
      return true;
    }

    // 設定好性別，下一步才是生日
    state.stage = "wait_birth_input";
    state.data = state.data || {};
    state.data.gender = gender;

    const genderLabel = gender === "male" ? "男命" : "女命";

    await pushText(
      userId,
      `好的，這次就先以「${genderLabel}」來看。\n\n` +
        "接下來請輸入你的西元生日與時間（時間可省略）：\n\n" +
        "1) 1992-12-05-未知\n" +
        "2) 1992-12-05-0830\n" +
        "3) 1992-12-05-辰時 或 1992-12-05-辰\n\n" +
        "如果不想提供時辰，可以在最後寫「未知」。",
    );

    return true;
  }

  // -------------------------
  // 1) 等使用者輸入生日
  // -------------------------
  if (state.stage === "wait_birth_input") {
    const parsed = parseMiniBirthInput(text);

    // 格式錯誤處理
    if (!parsed) {
      await pushText(
        userId,
        "看起來生日格式怪怪的 😅\n" +
          "請用以下任一種格式再試一次：\n" +
          "1) 1992-12-05-0830\n" +
          "2) 1992-12-05-辰時\n" +
          "3) 1992-12-05-辰\n" +
          "如果不想提供時辰，可以輸入：1992-12-05-未知",
      );
      return true;
    }

    const mode =
      state.data && state.data.baziMode ? state.data.baziMode : "pattern";
    const gender =
      state.data && state.data.gender ? state.data.gender : "unknown";

    try {
      // 2) 呼叫 AI 取得測算文本（以及四柱 + 五行）
      const { aiText, pillarsText, fiveElementsText } = await callMiniReadingAI(
        parsed, //生日
        mode, //選擇的模式 格局/流年、月、日
        gender, //姓別
      );

      // 2.5) quota扣次
      await quotaUsage(userId, "minibazi");

      // 3) 整理生日描述
      let birthDesc = `西元生日：${parsed.date}`;
      if (parsed.timeType === "hm") {
        birthDesc += ` ${parsed.time}`;
      } else if (parsed.timeType === "branch") {
        birthDesc += ` ${parsed.branch}時（地支時辰）`;
      } else if (parsed.timeType === "unknown") {
        birthDesc += `（未提供時辰）`;
      }

      // 4) 丟 Flex 卡片（如果有 JSON，就用區塊版；沒有就用純文字版）
      const mbPayload = {
        birthDesc,
        mode,
        aiText,
        pillarsText,
        fiveElementsText,
      };

      // ✅ 存起來：後續用戶點主題，不用再重算
      mbSave(userId, mbPayload);

      // ✅ 現在 sendMiniBaziResultFlex 會送「總覽 + 1 張重點」
      await sendMiniBaziResultFlex(userId, mbPayload);
      ///這邊要把狀態清掉
      delete conversationStates[userId];
      console.log(`[miniBaziFlow] from ${userId}, stage=${state.stage}`);
      return;
    } catch (err) {
      console.error("[miniBaziFlow] AI error:", err);
      await pushText(
        userId,
        "八字測算目前有點塞車 😅\n你可以稍後再試一次，或直接輸入「預約」進行完整論命。",
      );
      delete conversationStates[userId];
      return true;
    }
  }

  return false;
}

/**
 * 🔮 handleBaziMatchFlow
 * -----------------------
 * 八字合婚模式的主要控制流程（mode: "bazi_match"）。
 *
 * 【整體流程】
 * 1. wait_male_birth_input
 *    - 等待使用者輸入「男方」生日字串。
 *    - 使用 parseMiniBirthInput() 解析生日格式。
 *    - 若格式正確 → 暫存於 state.data.maleBirth 並進入下一階段。
 *
 * 2. wait_female_birth_input
 *    - 等待使用者輸入「女方」生日字串。
 *    - 同樣以 parseMiniBirthInput() 解析。
 *    - 若成功 → 呼叫 callBaziMatchAI() 取得：
 *         - aiText：AI 回傳的合婚 JSON（或純文字）
 *         - matchText：組合後的「男命月支日支 × 女命月支日支」合婚提示文字
 *         - malePillars / femalePillars：兩人八字拆出的四柱資訊
 *         - maleSummary / femaleSummary：兩人八字摘要（baziSummaryText）
 *
 * 3. 丟給 sendBaziMatchResultFlex()（位於 lineClient.js）
 *    - 將 AI 的 JSON 解析後轉成 Flex Message 回傳給用戶。
 *    - 若 JSON 解析失敗，則以純文字方式 fallback 回覆。
 *
 * 【使用到的元件 / 工具】
 * - parseMiniBirthInput()
 *      將 "1992-12-05-0830" / "1992-12-05-辰" 解析成日期物件。
 *
 * - getBaziSummaryForAI()
 *      透過第三方 API 取得命主八字摘要（summaryText）。
 *
 * - extractPillars()
 *      從 summaryText 中拆出「年柱 / 月柱 / 日柱 / 時柱」。
 *
 * - callBaziMatchAI()
 *      將男女雙方的八字 + 月支/日支關係送入 AI_Reading()，
 *      取得合婚 JSON 結果（score、summary、strengths、challenges、advice）。
 *
 * - sendBaziMatchResultFlex()
 *      使用 LINE Flex Message 將合婚結果呈現給使用者。
 *
 * 【注意事項】
 * - 不修改任何現有八字測算流程所使用的 key（如 baziSummaryText）。
 * - 合婚流程完全獨立於 mini_bazi，避免交互影響。
 * - state.stage 決定目前處理進度，請確保每個階段正確轉換。
 *
 * 此函式僅負責「流程控制與 state 管理」，不負責八字推算或 UI 格式化。
 */
// 🔮 八字合婚流程
async function handleBaziMatchFlow(userId, text, state, event) {
  if (!state || state.mode !== "bazi_match") return false;

  console.log(
    `[baziMatchFlow] from ${userId}, stage=${state.stage}, text=${text}`,
  );

  // 1) 等男方生日
  if (state.stage === "wait_male_birth_input") {
    const parsed = parseMiniBirthInput(text);

    if (!parsed) {
      await pushText(
        userId,
        "男方生日格式好像怪怪的 😅\n\n" +
          "請用以下任一種格式再試一次：\n" +
          "1) 1992-12-05-0830\n" +
          "2) 1992-12-05-辰時\n" +
          "3) 1992-12-05-辰\n" +
          "如果不想提供時辰，可以輸入：1992-12-05-未知",
      );
      return true;
    }

    state.data = state.data || {};
    state.data.maleBirth = parsed;

    state.stage = "wait_female_birth_input";
    await pushText(
      userId,
      "收到 ✅\n\n接著輸入「女方」的西元生日與時間（時間可省略）：\n\n" +
        "1) 1992-12-05-0830\n" +
        "2) 1992-12-05-辰時\n" +
        "3) 1992-12-05-辰\n" +
        "如果不想提供時辰，可以輸入：1992-12-05-未知",
    );
    return true;
  }

  // 2) 等女方生日
  if (state.stage === "wait_female_birth_input") {
    const parsed = parseMiniBirthInput(text);

    if (!parsed) {
      await pushText(
        userId,
        "女方生日格式好像怪怪的 😅\n\n" +
          "請用以下任一種格式再試一次：\n" +
          "1) 1992-12-05-0830\n" +
          "2) 1992-12-05-辰時\n" +
          "3) 1992-12-05-辰\n" +
          "如果不想提供時辰，可以輸入：1992-12-05-未知",
      );
      return true;
    }

    state.data = state.data || {};
    state.data.femaleBirth = parsed;

    try {
      // 👉 呼叫合婚 AI，拿到合婚結果（JSON 字串等）
      const result = await callBaziMatchAI(state.data.maleBirth, parsed);

      // 👉 header 用「人話時間」
      const maleBirthDisplay = formatBirthForDisplay(state.data.maleBirth);
      const femaleBirthDisplay = formatBirthForDisplay(parsed);

      // ✅ 這次是不是首免：用 gateFeature 的那次判斷（你原本 gateFeature 入口已經有）
      // 你如果目前沒有把 gate.source 存進 state，那就先用「現在查」也行，但會有時序問題
      const userRecord = await getUser(userId);
      const eligibility = getEligibility(userRecord, "bazimatch");
      const isFirstFree =
        eligibility.allow && eligibility.source === "firstFree";

      if (isFirstFree) {
        // ✅ 首免：先送「遮罩版」，不扣次
        const fullPayload = {
          ...result,
          maleBirthDisplay,
          femaleBirthDisplay,
        };

        cacheBaziMatchResult(userId, fullPayload);

        await sendBaziMatchResultFlex(userId, {
          ...fullPayload,
          shareLock: true, // ⭐ 交給 lineClient 做遮罩 + 顯示分享/解鎖按鈕
        });

        delete conversationStates[userId];
        return true;
      }

      // ✅ 非首免（有 quota/付費）：直接送完整版，然後扣次
      await sendBaziMatchResultFlex(userId, {
        ...result,
        maleBirthDisplay,
        femaleBirthDisplay,
        shareLock: false,
      });

      await quotaUsage(userId, "bazimatch");

      delete conversationStates[userId];
      return true;
    } catch (err) {
      console.error("[baziMatchFlow] AI error:", err);
      await pushText(
        userId,
        "合婚這邊目前有點塞車 😅\n你可以晚點再試一次，或直接輸入「預約」詢問完整合婚。",
      );
      delete conversationStates[userId];
      return true;
    }
  }

  return false;
}

// --- 將 baziSummaryText 解析出 年柱/月柱/日柱/時柱 ---
function extractPillars(baziSummaryText) {
  const lines = baziSummaryText.split(/\r?\n/);

  let year = "",
    month = "",
    day = "",
    hour = "";
  //console.log("======== [extractPillars] START ========");
  //console.log("total lines:", lines.length);

  for (const line of lines) {
    if (line.includes("年柱："))
      year = line.replace(/.*?年柱[:：]\s*/, "").trim();
    if (line.includes("月柱："))
      month = line.replace(/.*?月柱[:：]\s*/, "").trim();
    if (line.includes("日柱："))
      day = line.replace(/.*?日柱[:：]\s*/, "").trim();
    if (line.includes("時柱："))
      hour = line.replace(/.*?時柱[:：]\s*/, "").trim();
  }

  //console.log("FINAL =>", { year, month, day, hour });
  //console.log("======== [extractPillars] END ==========");

  return { year, month, day, hour };
}

// --- 天干五行對照表 ---
const stemElement = {
  甲: "木",
  乙: "木",
  丙: "火",
  丁: "火",
  戊: "土",
  己: "土",
  庚: "金",
  辛: "金",
  壬: "水",
  癸: "水",
};
// --- 地支五行對照表 ---
const branchElement = {
  子: "水",
  丑: "土",
  寅: "木",
  卯: "木",
  辰: "土",
  巳: "火",
  午: "火",
  未: "土",
  申: "金",
  酉: "金",
  戌: "土",
  亥: "水",
};

// --- 計算五行數量 ---
function calcFiveElements({ year, month, day, hour }) {
  const all = [year, month, day, hour];

  const count = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };

  for (const pillar of all) {
    if (!pillar) continue;
    const [stem, branch] = pillar.split("");

    const e1 = stemElement[stem];
    const e2 = branchElement[branch];

    if (e1) count[e1] += 1;
    if (e2) count[e2] += 1;
  }

  return count;
}

////把八字結果組合成文字呼叫AI
async function callMiniReadingAI(
  birthObj,
  mode = "pattern",
  gender = "unknown",
) {
  const { raw, date, timeType, time, branch } = birthObj;

  // --- 組合生日文字描述 ---
  let birthDesc = `-西元生日：${date}`;
  if (timeType === "hm") {
    birthDesc += ` ${time}`;
  } else if (timeType === "branch") {
    birthDesc += ` ${branch}時（地支時辰，未提供分鐘）`;
  } else if (timeType === "unknown") {
    birthDesc += `（未提供時辰）`;
  }

  /* =========================================================
   Step A3：focusText / timePhraseHint 改成從檔案讀取（可熱改）
   你原本的 if/else 邏輯只是在「依 mode 選文案」
   現在把文案搬到 prompts/minibazi.modeCopy.json
   好處：
   - 你以後想改 year/month/day/pattern 的文案，改 JSON 立刻生效
   - code 不用再改、也不用部署
   ========================================================= */
  let focusText = "";
  let timePhraseHint = "";

  /* 依 mode 取得對應文案（找不到就回 default） */
  const modeCopy = getMiniBaziModeCopy(mode);
  focusText = modeCopy.focusText || "";
  timePhraseHint = modeCopy.timePhraseHint || "";

  // --- 性別補充說明 ---
  let genderHintForSystem = "";
  let genderHintForUser = "";

  if (gender === "male") {
    genderHintForSystem =
      "本次解讀對象為「男命」，請以男性命主的角度來描述，用詞自然即可。";
    genderHintForUser =
      "這次請以男命的角度說明命盤特質與建議，不用一直重複「男命」二字。";
  } else if (gender === "female") {
    genderHintForSystem =
      "本次解讀對象為「女命」，請以女性命主的角度來描述，用詞自然即可。";
    genderHintForUser =
      "這次請以女命的角度說明命盤特質與建議，不用一直重複「女命」二字。";
  } else {
    genderHintForSystem =
      "本次解讀對象未特別標註性別，請使用中性的稱呼，不要自行猜測性別。";
    genderHintForUser = "";
  }

  // --- 先向 youhualao 取得八字摘要（已組成給 AI 用的文字） ---
  let baziSummaryText = "";
  try {
    const { summaryText } = await getBaziSummaryForAI(birthObj);
    baziSummaryText = summaryText;
  } catch (err) {
    console.error("[youhualao API error]", err);

    // API 掛掉時的簡易 fallback：直接請 AI 自己算、直接回文字（不用 JSON）
    const fallbackSystemPrompt =
      "你是一位懂八字與紫微斗數的東方命理老師，講話溫和、實際，不宿命論，不嚇人。";
    const fallbackUserPrompt =
      `${birthDesc}\n` +
      `原始輸入格式：${raw}\n\n` +
      `${focusText}\n\n` +
      (genderHintForUser ? genderHintForUser + "\n\n" : "") +
      "目前八字 API 暫時無法使用，請你自行根據西元生日與時辰推算四柱八字，" +
      "並依據上述重點，給予 150～200 字的簡短提醒與建議，語氣像朋友聊天。";

    //console.log(
    //  "[callMiniReadingAI][fallback] systemPrompt:\n",
    //  fallbackSystemPrompt
    //);
    //console.log(
    //  "[callMiniReadingAI][fallback] userPrompt:\n",
    //  fallbackUserPrompt
    //);

    // ❗ 這支在 fallback 就回「純文字」，上層記得視為 aiText 直接展示
    return await AI_Reading(fallbackUserPrompt, fallbackSystemPrompt);
  }

  ///////放到header用//
  // 解析四柱//////////
  const { year, month, day, hour } = extractPillars(baziSummaryText);
  // 計算五行
  const fiveCount = calcFiveElements({ year, month, day, hour });
  const pillarsText = `-年柱：${year}\n-月柱：${month}\n-日柱：${day}\n-時柱：${hour}`;
  const fiveElementsText = `-五行：木 ${fiveCount.木}、火 ${fiveCount.火}、土 ${fiveCount.土}、金 ${fiveCount.金}、水 ${fiveCount.水}`;

  // --- 取得「現在」這一刻的干支（給流年 / 流月 / 流日用） ---
  let flowingGzText = "";
  console.log("[callMiniReadingAI] mode:", mode);

  if (mode === "year" || mode === "month" || mode === "day") {
    try {
      const now = new Date();
      const { yearGZ, monthGZ, dayGZ, hourGZ } =
        await getLiuYaoGanzhiForDate(now);

      if (mode === "year") {
        flowingGzText =
          "【當下流年干支資訊】\n" +
          `今年流年年柱：赤馬紅羊年的"丙午年"為流年\n` +
          `今日月柱：${monthGZ}\n` +
          `今日日柱：${dayGZ}\n` +
          `目前時柱：${hourGZ}\n` +
          "請特別留意「流年年柱」與命主原本命盤之間的五行生剋制化與刑沖合害對應。";
      } else if (mode === "month") {
        flowingGzText =
          "【當下流月干支資訊】\n" +
          `今年流年年柱：${yearGZ}\n` +
          `本月月柱：${monthGZ}\n` +
          `今日日柱：${dayGZ}\n` +
          `目前時柱：${hourGZ}\n` +
          "請特別留意「本月月柱」對命主原本命盤的五行起伏與刑沖合害。";
      } else if (mode === "day") {
        flowingGzText =
          "【當下流日干支資訊】\n" +
          `今年流年年柱：${yearGZ}\n` +
          `本月月柱：${monthGZ}\n` +
          `今日日柱：${dayGZ}\n` +
          `目前時柱：${hourGZ}\n` +
          "請特別留意「今日日柱」對命主原本命盤的五行觸發與情緒、事件起落。";
      }
    } catch (err) {
      console.error("[youhualao ly] 取得當日干支失敗：", err);
      flowingGzText = "";
    }
  }

  // --- 系統提示 ---
  /* =========================================================
   Step 3-2：systemPrompt 改成從 prompts/minibazi.json 讀取
   設計理由：
   - 讓你改 prompt 不必動 server.js、不必 git pull/restart
   - 仍保留 genderHintForSystem（男命/女命/中性）的動態語氣提示
   - 讀檔有 mtime 快取：檔案沒變就不重讀
   ========================================================= */
  const systemPrompt = getMiniBaziSystemPrompt(genderHintForSystem);

  // --- userPrompt ---
  /* =========================================================
   Step A2：userPrompt 改成讀 .txt 模板 + placeholder 替換
   設計理由：
   - 你最常改的是「段落文字」「規則清單」「語氣提醒」
   - 把這些搬到 txt 後：改檔案就即時生效，不用部署
   - 程式只負責計算動態資料（birthDesc/focusText/summary...）

   注意：
   - 這裡用最簡單的 replaceAll 方式做模板替換
   - 不引入任何模板套件，避免複雜化
   ========================================================= */

  /* 1) 可選區塊：timePhraseHintBlock（有就帶一段，沒有就空） */
  const timePhraseHintBlock = timePhraseHint ? `\n${timePhraseHint}\n\n` : "\n";

  /* 2) 可選區塊：flowingGzTextBlock（年/月/日模式才有；沒有就空） */
  const flowingGzTextBlock = flowingGzText ? `${flowingGzText}\n\n` : "";

  /* 3) how-to 規則：讀 prompts/minibazi.howto.txt（可熱改） */
  const howToBlock = getMiniBaziHowToBlock();

  /* 4) 讀 prompts/minibazi.userTemplate.txt（可熱改） */
  let userTemplate = getMiniBaziUserTemplate();

  /* 5) 最小模板替換：把 {{xxx}} 替換成對應字串
      - 這樣你就能在 txt 自由調整段落
      - 變數值仍由程式計算產生（最穩）
*/
  const userPrompt = userTemplate
    .replaceAll("{{birthDesc}}", birthDesc)
    .replaceAll("{{raw}}", raw || "")
    .replaceAll("{{focusText}}", focusText || "")
    .replaceAll("{{timePhraseHintBlock}}", timePhraseHintBlock)
    .replaceAll("{{baziSummaryText}}", baziSummaryText || "")
    .replaceAll("{{flowingGzTextBlock}}", flowingGzTextBlock)
    .replaceAll("{{howToBlock}}", howToBlock || "");

  //console.log("[callMiniReadingAI] systemPrompt:\n", systemPrompt);
  //console.log("[callMiniReadingAI] userPrompt:\n", userPrompt);
  //console.log("[callMiniReadingAI] flowingGzText:\n", flowingGzText);

  const AI_Reading_Text = await AI_Reading(userPrompt, systemPrompt);

  // 🚩 這裡先不 parse，直接把 AI 回來的「字串」丟回去，由上層決定 parse 或當成純文字
  return {
    aiText: AI_Reading_Text,
    pillarsText,
    fiveElementsText,
  };
}

/**
 * 八字合婚主流程（Bazi Match Pipeline）
 * ------------------------------------------------------------
 * 此函式負責整合「男方」與「女方」的八字資料，並透過 AI
 * 產生完整的合婚評估 JSON（含分數 / 優點 / 磨合點 / 建議）。
 *
 * 【主要流程】
 * 1) 取得男、女雙方的八字摘要（getBaziSummaryForAI）
 *    - 此步驟與單人八字測算相同，沿用同一份 API 摘要格式。
 *    - 回傳值中的 summaryText 即為 baziSummaryText。
 *
 * 2) 解析四柱（extractPillars）
 *    - 從八字摘要文字中抓取：年柱、月柱、日柱、時柱。
 *    - 合婚僅需「月支」＋「日支」作為核心判斷基礎：
 *        malePillars.month  → 男方月柱（取地支）
 *        malePillars.day    → 男方日柱（取地支）
 *        femalePillars.month → 女方月柱（取地支）
 *        femalePillars.day   → 女方日柱（取地支）
 *
 * 3) 組合合婚提示語句（matchText）
 *    - 依你指定格式組成：
 *        例：「男命 月支申 日支寅 女命 月支亥 日支丑 幫我合婚」
 *    - 此文字會直接丟給 GPT 當作合婚語境的提示。
 *
 * 4) 呼叫 AI_Reading（GPT / fallback）
 *    - systemPrompt：
 *        定義合婚邏輯、輸出風格、強制 JSON 格式。
 *    - userPrompt：
 *        包含男命摘要、女命摘要、matchText。
 *    - AI 僅被允許回傳 JSON，格式包含：
 *        {
 *          score: 0-100,          // 合婚分數
 *          summary: "...",        // 整體總評
 *          strengths: [...],      // 互補亮點
 *          challenges: [...],     // 潛在磨合點
 *          advice: "..."          // 經營方向建議
 *        }
 *
 * 5) 回傳給上層（handleBaziMatchFlow）
 *    - 不在此階段解析 JSON，由 lineClient.js 的
 *      sendBaziMatchResultFlex 負責解析與生成 Flex Message。
 *    - 回傳結構：
 *        {
 *          aiText,                // AI 原始回應（string）
 *          matchText,             // 合婚提示語句
 *          malePillars,           // 男方四柱
 *          femalePillars,         // 女方四柱
 *          maleSummary,           // 男方八字摘要文字
 *          femaleSummary          // 女方八字摘要文字
 *        }
 *
 * 【使用到的元件 / 工具】
 * - getBaziSummaryForAI     ：取得 youhualao 的八字摘要文字
 * - extractPillars           ：從摘要中解析出四柱干支
 * - AI_Reading               ：包裝 GPT（優先）＋ Gemini（fallback）
 * - parseMiniBirthInput      ：解析生日輸入格式（於上層流程使用）
 *
 * ------------------------------------------------------------
 * 注意：
 * - 完全不改動單人測算流程的 baziSummaryText 結構。
 * - 合婚的 maleSummary / femaleSummary 皆為新變數，不會影響現有流程。
 * - Flex 呈現邏輯獨立於 lineClient.js 中處理。
 */
async function callBaziMatchAI(maleBirthObj, femaleBirthObj) {
  // 1) 先拿兩邊的八字摘要（沿用你原本那顆 getBaziSummaryForAI）
  const { summaryText: maleBaziSummaryText } =
    await getBaziSummaryForAI(maleBirthObj);
  const { summaryText: femaleBaziSummaryText } =
    await getBaziSummaryForAI(femaleBirthObj);

  // 2) 拆出四柱，再取月支 + 日支
  const malePillars = extractPillars(maleBaziSummaryText); // { year, month, day, hour }
  const femalePillars = extractPillars(femaleBaziSummaryText);

  const maleYearBranch = (malePillars.year || "").slice(1); // 取第 2 個字當地支
  const maleMonthBranch = (malePillars.month || "").slice(1);
  const maleDayBranch = (malePillars.day || "").slice(1);
  const femaleYearBranch = (femalePillars.year || "").slice(1);
  const femaleMonthBranch = (femalePillars.month || "").slice(1);
  const femaleDayBranch = (femalePillars.day || "").slice(1);

  // 3) 組給 AI 的「內部合婚提示」
  //    👉 含 月支 / 日支 + 「幫我合婚」，只給 AI 用
  const matchPromptText =
    `男命 年支${maleYearBranch} 月支${maleMonthBranch} 日支${maleDayBranch} ` +
    `女命 年支${femaleYearBranch} 月支${femaleMonthBranch} 日支${femaleDayBranch} 幫我合婚`;

  // 4) 組給使用者看的說明文字（看你要不要更 detail）
  //    👉 不出現地支、也不出現「幫我合婚」
  const matchDisplayText =
    "本次合婚是依照雙方的出生年月日，" +
    "以八字命盤的整體結構來評估緣分走向與相處模式計分。";

  // 4) 系統提示：要求 JSON + 分數
  const systemPrompt =
    "你是一位專門看八字合婚的東方命理老師，講話是現代嘴炮風。" +
    "你會收到兩位當事人的八字摘要（包含四柱與部分五行資訊），請根據兩人的命盤，" +
    "重點參考「優先參考月支與日支之間的關係」再參考「年支與月支與日支之間的關係」" +
    "以及「雙方五行生剋是否互補或失衡」，綜合給出合婚評估。" +
    "在你的內部判斷邏輯中（不要寫進輸出的文字裡），請遵守以下原則：" +
    "1.如果雙方月支、日支之間形成明顯的和諧關係（例如傳統所說的六合、相生、互補），" +
    "合婚分數要有明顯加分，可以落在 80～95 分區間，並在文字裡用「很合」、「默契自然」" +
    "「互補性高」、「相處很順」這類描述來呈現整體感受。" +
    "2.如果雙方之間存在強烈對立關係（例如傳統所說的六沖、嚴重相剋），" +
    "合婚分數應有明顯扣分，可以落在 40～65 分區間，在文字裡用「衝突感較強」、" +
    "「磨合較多」、「步調差異大」、「需要更多溝通」這類語氣呈現。" +
    "3.如果主要是相刑、內耗、反覆拉扯的關係，分數可落在 50～75 分之間，" +
    "在文字裡可以使用「相處較虐心」、「情緒容易互相牽動」、「在意彼此但也容易磨耗」等描述。" +
    "4.若同時有和諧與衝突並存，你要自行權衡，拉出明顯差異，不要所有情況都停在 70～80 分，" +
    "而是根據整體相性，合理分配在 40～95 分之間。" +
    "五行方面，請在心裡參考雙方命盤中日主以及整體五行的生剋關係，" +
    "例如互相補足欠缺的元素時，可以視為「互補性高」、" +
    "若某一方過強而另一方更被壓制時，可視為「一方壓力較大」或「容易感到不被理解」。" +
    "但這些五行、生剋的專業名詞，只能作為你內部推理的依據，不能直接寫進輸出文字。" +
    "請注意：在輸出的 JSON 文字內容中，不要出現「子、丑、寅、卯、辰、巳、午、未、申、酉、戌、亥」這些字眼，" +
    "也不要使用「月支」「日支」「地支」「六合」「六沖」「相刑」「五行生剋」等專業術語。" +
    "你可以在心裡完整使用這些命理概念，但對使用者的文字說明只用一般人聽得懂的語言，" +
    "例如「個性互補」、「步調不同」、「需要多一點溝通」、「比較虐心」、「情緒起伏較大」等。" +
    "永遠只輸出 JSON，不要任何其他文字，不要加註解，不要加 ```。" +
    "JSON 格式如下：" +
    "{ " +
    '"score": 0-100 的整數合婚分數,' +
    '"summary": "整體合婚總評，約 80～150 字（用日常語言，不要命理術語）",' +
    '"strengths": ["優點 1", "優點 2", "互補的地方等（用日常語言）"],' +
    '"challenges": ["潛在摩擦點 1", "生活節奏／價值觀差異等（用日常語言）"],' +
    '"advice": "給雙方的具體經營建議，約 120～200 字（用日常語言，不要命理術語）"' +
    " }";

  // 5) userPrompt：丟「兩份摘要 + 合婚 text」
  const userPrompt =
    "以下是兩位當事人的八字摘要，請你依照 JSON 格式做合婚評估：\n\n" +
    "【男命八字摘要】\n" +
    maleBaziSummaryText +
    "\n\n" +
    "【女命八字摘要】\n" +
    femaleBaziSummaryText +
    "\n\n" +
    "【合婚提示（內部用）】\n" +
    matchPromptText +
    "\n\n" +
    "請直接輸出 JSON。";

  //console.log("[callBaziMatchAI] userPrompt:\n", userPrompt);
  //console.log("[callBaziMatchAI] systemPrompt:\n", systemPrompt);

  const aiText = await AI_Reading(userPrompt, systemPrompt);

  // 🔹 在這裡做「人話時間」版本
  const maleBirthDisplay = formatBirthForDisplay(maleBirthObj);
  const femaleBirthDisplay = formatBirthForDisplay(femaleBirthObj);

  // 跟單人一樣先不 parse，交給 lineClient 處理
  return {
    aiText,
    matchPromptText,
    matchDisplayText,

    // ⭐ 給 Flex header 用（人類看得懂）
    maleBirthDisplay: formatBirthForDisplay(maleBirthObj),
    femaleBirthDisplay: formatBirthForDisplay(femaleBirthObj),

    // ⭐ 保留 raw 給 debug
    maleBirthRaw: maleBirthObj.raw,
    femaleBirthRaw: femaleBirthObj.raw,

    malePillars,
    femalePillars,
    maleSummary: maleBaziSummaryText,
    femaleSummary: femaleBaziSummaryText,
  };
}

// ========================
//  六爻占卜主流程
// ========================
async function handleLiuYaoFlow(userId, text, state, event) {
  if (!state || state.mode !== "liuyao") return false;

  console.log(
    `[liuYaoFlow] from ${userId}, stage=${state.stage}, text=${text}`,
  );

  const trimmed = (text || "").trim();

  // 0) 問「男占 / 女占」
  if (state.stage === "wait_gender") {
    let gender = null;
    if (["男", "男生", "男命", "m", "M", "男占"].includes(trimmed)) {
      gender = "male";
    } else if (["女", "女生", "女命", "f", "F", "女占"].includes(trimmed)) {
      gender = "female";
    }

    if (!gender) {
      await pushText(
        userId,
        "我這邊要先知道是「男占」還是「女占」。\n\n可以輸入：男 / 男生 / 男命 或 女 / 女生 / 女命。",
      );
      return true;
    }

    state.data.gender = gender;
    state.stage = "wait_time_mode";
    conversationStates[userId] = state;

    await sendLiuYaoTimeModeFlex(userId);
    return true;
  }

  // 1) 等使用者輸入「指定起卦時間」
  if (state.stage === "wait_custom_time_input") {
    const birth = parseMiniBirthInput(trimmed);
    if (!birth || !birth.date || birth.timeType === "unknown") {
      await pushText(
        userId,
        "時間格式好像怪怪的，或者沒有包含時辰。\n\n請用這種格式再輸入一次，例如：\n" +
          "- 2025-11-24-2150\n" +
          "- 2025-11-24-亥時\n" +
          "- 2025-11-24-亥",
      );
      return true;
    }

    // 這個 birth 只是拿來當「起卦時間」
    state.data.customBirth = birth;
    state.stage = "collect_yao_notice";
    conversationStates[userId] = state;

    await sendLiuYaoNoticeAndAskFirstYao(userId, state);
    return true;
  }

  // 2) 一爻一爻記錄：已經進入「collect_yao」階段
  if (state.stage === "collect_yao") {
    // 先確保有初始化
    if (!state.data.yy) {
      state.data.yy = "";
    }
    if (!state.data.yaoIndex) {
      state.data.yaoIndex = 1;
    }

    // ✅ A方案 只允許 0~3（避免 7 也被吃進去）
    if (!/^[0-3]$/.test(trimmed)) {
      await pushText(
        userId,
        "請選擇「人頭數」（推薦用按鈕）。\n\n" +
          "0=零個人頭、1=一個人頭、2=兩個人頭、3=三個人頭。",
      );
      // ✅ B 方案：手打錯了也拉回按鈕
      await sendLiuYaoRollFlex(userId, state.data.yaoIndex, state.data.yy);
      return true;
    }

    state.data.yy += trimmed;

    const nowIndex = state.data.yaoIndex;
    const nextIndex = nowIndex + 1;
    state.data.yaoIndex = nextIndex;

    // ✅ 儀式確認（短）
    await pushText(
      userId,
      `第 ${nowIndex} 爻已記錄：${
        ["零", "一", "兩", "三"][Number(trimmed)]
      } 個人頭。`,
    );

    // 還沒滿六爻 → ✅ B 方案：不要叫他繼續輸入，直接送下一爻按鈕
    if (state.data.yy.length < 6) {
      conversationStates[userId] = state;
      await sendLiuYaoRollFlex(userId, nextIndex, state.data.yy);
      return true;
    }

    // ✅ 已經湊滿 6 碼
    const finalCode = state.data.yy.slice(0, 6);
    state.stage = "wait_ai_result"; // 下一步我們會串 youhualao API + AI 解卦
    conversationStates[userId] = state;

    await pushText(
      userId,
      `好的，六個爻都記錄完成了。\n\n這一卦的起卦碼是：${finalCode}。\n我這邊會先整理卦象資料，接著幫你做 AI 解卦。`,
    );

    // 👉 這裡下一步就是：
    // 1) 把起卦時間（now 或 customBirth） + finalCode 丟進 getLiuYaoHexagram(...)
    // 2) 把 API 回傳整理成你要的六爻文字
    // 3) 丟進 AI_Reading 產生解卦
    // 我們可以在下一輪一起把這三步補上。

    try {
      console.log("3336已進到handleLiuTaoFlow:try", userId);
      const timeParams = buildLiuYaoTimeParams(state);
      const { y, m, d, h, mi } = timeParams;

      // 呼叫 youhualao 取得完整卦象
      const hexData = await getLiuYaoHexagram({
        y,
        m,
        d,
        h,
        mi,
        yy: finalCode,
      });

      // 存起來（可選，但建議）
      state.data.hexData = hexData;

      // ⬇️ 呼叫 AI 解卦
      const { aiText } = await callLiuYaoAI({
        genderText: state.data.gender === "female" ? "女命" : "男命",
        topicText: LIU_YAO_TOPIC_LABEL[state.data.topic] || "感情",
        hexData: state.data.hexData,
      });

      console.log("3400已進到handleLiuTaoFlow:", userId);
      // 扣次quota
      await quotaUsage(userId, "liuyao");
      //////////////////////////////////////////

      await pushText(userId, aiText);

      delete conversationStates[userId];
      return true;
    } catch (err) {
      console.error("[liuyao] AI error:", err);
      await pushText(userId, "六爻解卦 AI 剛剛小卡住 😅 你可以稍後再試一次。");
      delete conversationStates[userId];
      return true;
    }

    /*
    /////////////六爻逐行測試區////start
    try {
      // 1) 先算起卦時間
      const timeParams = buildLiuYaoTimeParams(state);
      const { y, m, d, h, mi, desc } = timeParams;

      // 2) 叫 youhualao 拿卦
      const hexData = await getLiuYaoHexagram({
        y,
        m,
        d,
        h,
        mi,
        yy: finalCode,
      });

      // 3) 用新的 describeSixLines() 整理六條文字
      const sixLinesText = describeSixLines(hexData);

      // 4) 順便把 userPrompt 組出來看
      //const { systemPrompt, userPrompt } = buildLiuYaoPrompts(
      // state,
      //  hexData,
      //  desc
      //);

      // 先丟「六條爻文字」給你看
      await pushText(userId, "【六爻逐條解析（測試用）】\n" + sixLinesText);

      // 再丟 userPrompt（你可以確認格式、行文、變數是否有誤）
      //await pushText(userId, "【User Prompt 給 AI（測試用）】\n" + userPrompt);

      // systemPrompt 比較長，不一定要推給用戶，可以先只 console.log
      //console.log("[LiuYao SystemPrompt]\n", systemPrompt);

      // 測試完就清 state，避免卡著
      delete conversationStates[userId];
    } catch (err) {
      console.error("[handleLiuYaoFlow] 測試六爻字串時錯誤：", err);
      await pushText(
        userId,
        "我在整理這一卦的文字時發生錯誤，你可以把錯誤訊息截圖給工程師自己看看看（或貼回來繼續修）。"
      );
      delete conversationStates[userId];
    }*/
  }

  return false;
}

// ============================
// ✅ Helper: 占卜前使用說明 Bubble
// ============================
async function sendLiuYaoNoticeFlex(userId, topicLabel = "這件事情") {
  const contents = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "請準備3個十元硬幣",
          weight: "bold",
          size: "xl",
          wrap: true,
        },
        {
          type: "text",
          text: "在開始之前，請先把心放穩。",
          size: "md",
          wrap: true,
        },

        { type: "separator", margin: "md" },

        {
          type: "text",
          text:
            "這一卦，只問一件事。\n" +
            "請你想清楚正在發生、或即將發生的情況，" +
            "不要同時放進太多問題。",
          size: "sm",
          color: "#555555",
          wrap: true,
        },

        {
          type: "text",
          text:
            "起卦之前，讓自己靜一下。\n" + "問題越清楚，卦象才會回應得越清楚。",
          size: "sm",
          color: "#555555",
          wrap: true,
        },

        { type: "separator", margin: "md" },

        {
          type: "text",
          text: `現在，請你在心中專注於\n「${topicLabel}」`,
          size: "md",
          wrap: true,
        },
        {
          type: "text",
          text: "準備好後，再進入下一步。",
          size: "xs",
          color: "#999999",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "我已準備好",
            data: "action=liuyao_calm",
            displayText: "我已準備好",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "六爻占卜須知", contents);

  function bullet(title, desc) {
    return {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      contents: [
        {
          type: "text",
          text: `・${title}`,
          weight: "bold",
          size: "md",
          wrap: true,
        },
        { type: "text", text: desc, size: "sm", color: "#666666", wrap: true },
      ],
    };
  }
}

// ============================
// ✅ Helper: 請神文 Bubble（默念版，不收個資，只帶 topicLabel）
// ============================
async function sendLiuYaoSpellFlex(userId, topicLabel = "此事") {
  const verse =
    "陰陽日月最長生，可惜天理難分明\n" + "今有真聖鬼谷子，一出天下定太平\n";

  const invocation =
    "拜請八卦祖師、伏羲、文王、周公\n、孔子、五大聖賢、智聖王禪老祖及孫臏真人、" +
    "諸葛孔明真人、陳摶真人、劉伯溫真人、野鶴真人、九天玄女、觀世音菩薩、混元禪師、\n" +
    "十方世界諸天神聖佛菩薩器眾、飛天過往神聖、本地主司福德正神、\n排卦童子、成卦童郎--\n" +
    "駕臨指示聖卦。";

  const disciple =
    `今有弟子(姓名)，性別(男/女)，\n出生某年次，住在(地址)。\n` +
    `今為「${topicLabel}」憂疑難決，\n` +
    "請諸神佛依實指示聖卦。\n" +
    "先求內卦三爻，再求外卦三爻。\n";

  const contents = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "lg",
      backgroundColor: "#F7F3ED", // ← 宣紙感
      contents: [
        {
          type: "text",
          text: "請神文",
          weight: "bold",
          size: "xl",
          wrap: true,
        },
        {
          type: "text",
          text: "請默念，並逐字照念。",
          size: "xs",
          color: "#777777",
          wrap: true,
        },

        { type: "separator", margin: "md" },

        // 起首
        hint("起首"),
        bodyBig(verse),

        // 拜請
        hint("拜請"),
        //...chunkToBigTexts(invocation, 80),
        bodyBig(invocation),

        // 稟告
        hint("稟告"),
        bodyBig(disciple),

        {
          type: "text",
          text: "默念完畢後，按下方按鈕。",
          size: "xs",
          color: "#999999",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      backgroundColor: "#FFFFFF",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "我已請神",
            data: "action=liuyao_spelled",
            displayText: "我已請神",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "六爻請神文", contents);

  // 小標題（淡）
  function hint(t) {
    return {
      type: "text",
      text: t,
      size: "xs",
      color: "#999999",
      wrap: true,
    };
  }

  // 正文（放大）
  function bodyBig(t) {
    return {
      type: "text",
      text: t,
      size: "md",
      color: "#222222",
      wrap: true,
    };
  }

  // 長段落切段（避免 Flex 爆）
  function chunkToBigTexts(str, size) {
    const out = [];
    let i = 0;
    while (i < str.length) {
      out.push(bodyBig(str.slice(i, i + size)));
      i += size;
    }
    return out;
  }
}

// ============================
// ✅ 改：六爻占卜 入口（原 sendLiuYaoNoticeAndAskFirstYao）
// 目的：不再 pushText 長篇，改成送「使用說明 Bubble」
// ============================
async function sendLiuYaoNoticeAndAskFirstYao(userId, state) {
  const topic = state?.data?.topic || "general";
  const topicLabel =
    topic === "love"
      ? "感情"
      : topic === "career"
        ? "事業"
        : topic === "wealth"
          ? "財運"
          : topic === "health"
            ? "健康"
            : "這件事情";

  // ✅ 設定流程節點：等待靜心按鈕
  state.stage = "wait_calm";
  conversationStates[userId] = state;

  // ✅ 送出使用說明 Bubble（底下有「我已準備好（靜心）」按鈕）
  await sendLiuYaoNoticeFlex(userId, topicLabel);
}

// 六爻 靜心畫面（primary button）
async function sendLiuYaoCalmFlex(userId) {
  const contents = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "起卦前 · 靜心",
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        {
          type: "text",
          text: "把問題留在心裡。\n深呼吸三次。\n準備好再開始。",
          size: "sm",
          color: "#666666",
          wrap: true,
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "我準備好了",
            data: "action=liuyao_calm",
            displayText: "我準備好了",
          },
        },
      ],
    },
  };
  await pushFlex(userId, "起卦前靜心", contents);
}

// 六爻 請神後「開始搖爻」（primary button）
async function sendLiuYaoStartRollFlex(userId) {
  const contents = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "請神儀式",
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        { type: "separator" },
        {
          type: "text",
          text: "請你在心裡（或小聲）唸完請神文。\n唸完後，按下開始搖爻。",
          size: "sm",
          color: "#666666",
          wrap: true,
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "開始搖爻",
            data: "action=liuyao_start_roll",
            displayText: "開始搖爻",
          },
        },
      ],
    },
  };
  await pushFlex(userId, "請神儀式", contents);
}

// 六爻 送出「選人頭數」的 Flex（每一爻共用）
async function sendLiuYaoRollFlex(userId, yaoIndex, yySoFar = "") {
  const IMG_3 = "https://chen-yi.tw/liuyao/heads_3-2.jpg";
  const IMG_2 = "https://chen-yi.tw/liuyao/heads_2-2.jpg";
  const IMG_1 = "https://chen-yi.tw/liuyao/heads_1-2.jpg";
  const IMG_0 = "https://chen-yi.tw/liuyao/heads_0-2.jpg";

  // ✅ 小條形圖：6 格
  const done = yySoFar ? yySoFar.length : 0;
  // ✅ 綠色 6 格進度條（完成=綠，未完成=灰）
  function progressRow(doneCount) {
    const total = 6;
    const boxes = [];
    for (let i = 1; i <= total; i++) {
      boxes.push({
        type: "text",
        text: "■",
        size: "sm",
        weight: "bold",
        color: i <= doneCount ? "#16a34a" : "#d1d5db", // 綠 / 灰
        flex: 0,
      });
    }
    return {
      type: "box",
      layout: "horizontal",
      spacing: "xs",
      contents: boxes,
    };
  }

  const contents = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `第 ${yaoIndex} 爻 · 擲幣結果`,
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        {
          type: "text",
          text: "請依照你實際擲出的結果選擇\n（只看人頭數即可）",
          size: "sm",
          color: "#666666",
          wrap: true,
        },

        // ✅ 進度：數字 + 小條形圖（永遠顯示，0/6 也顯示）
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: `進度：${done} / 6`,
              size: "xs",
              color: "#999999",
            },
            progressRow(done),
          ],
        },

        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                imagePick(IMG_3, "三個人頭", "3"),
                imagePick(IMG_2, "兩個人頭", "2"),
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                imagePick(IMG_1, "一個人頭", "1"),
                imagePick(IMG_0, "零個人頭", "0"),
              ],
            },
          ],
        },
        /*不提示使用者可以手動輸入
        {
          type: "text",
          text: "（也可以直接輸入 0～3 ）",
          size: "xs",
          color: "#999999",
        },
        */
      ],
    },
  };

  await pushFlex(userId, `第 ${yaoIndex} 爻起卦`, contents);

  function imagePick(imgUrl, label, value) {
    return {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "image",
          url: imgUrl,
          size: "full",
          aspectMode: "cover",
          aspectRatio: "1:1",
          action: {
            type: "postback",
            data: `action=liuyao_roll&v=${value}`,
            displayText: label,
          },
        },
        {
          type: "text",
          text: label,
          size: "sm",
          align: "center",
        },
      ],
      cornerRadius: "12px",
      borderWidth: "1px",
      borderColor: "#EEEEEE",
      paddingAll: "6px",
    };
  }
}

// 六爻過中爻「過門」Flex（第 3 爻結束後使用）
async function sendLiuYaoMidGateFlex(userId) {
  const contents = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "下卦已成\n卦象逐漸成形",
          weight: "bold",
          size: "xl",
          wrap: true,
        },

        // ───── 進度條區塊 ─────
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          margin: "md",
          contents: [
            {
              type: "text",
              text: "進度 3 / 6",
              size: "xs",
              color: "#2E7D32", // 深綠
            },
            {
              type: "box",
              layout: "horizontal",
              height: "8px",
              backgroundColor: "#E0E0E0", // 灰底
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  flex: 3,
                  backgroundColor: "#4CAF50", // 綠色進度
                  contents: [],
                },
                {
                  type: "box",
                  layout: "vertical",
                  flex: 3,
                  backgroundColor: "#E0E0E0",
                  contents: [],
                },
              ],
            },
          ],
        },
        // ───────────────────

        {
          type: "separator",
          margin: "md",
        },
        {
          type: "text",
          text:
            "請你默念：\n\n" +
            "「內卦三爻吉凶未判」\n「再求外卦三爻，以成全卦。」",
          size: "md",
          wrap: true,
        },
        {
          type: "text",
          text: "默念完畢後，按下方按鈕，進入第四爻。",
          size: "xs",
          color: "#999999",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "默念完畢，進入第四爻",
            data: "action=liuyao_mid_continue",
            displayText: "默念完畢",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "下卦已成", contents);
}

// 六爻 完成版六爻
async function sendLiuYaoCompleteFlex(userId, finalCode) {
  const contents = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "六爻俱全",
          weight: "bold",
          size: "xl",
          wrap: true,
        },
        {
          type: "text",
          text: "此卦卦已立，正在封卦。",
          size: "sm",
          color: "#666666",
          wrap: true,
        },

        // ✅ 6/6 綠色條
        {
          type: "box",
          layout: "horizontal",
          spacing: "xs",
          contents: Array.from({ length: 6 }).map(() => ({
            type: "text",
            text: "■",
            size: "sm",
            weight: "bold",
            color: "#16a34a",
            flex: 0,
          })),
        },

        {
          type: "text",
          text: `起卦碼：${finalCode}`,
          size: "xs",
          color: "#9ca3af",
          wrap: true,
        },
        { type: "separator" },
        {
          type: "text",
          text: "接下來請做收卦退神，我會在你完成後開始解讀。",
          size: "sm",
          color: "#666666",
          wrap: true,
        },
      ],
    },
  };

  await pushFlex(userId, "六爻完成", contents);
}

// 六爻 退神儀式
async function sendLiuYaoSendoffFlex(userId) {
  const contents = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "收卦 · 退神",
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        { type: "separator" },
        {
          type: "text",
          text:
            "卦已立，謝神明指引。\n請念以下退神文：\n「於今六爻已成，吉凶分判\n" +
            "弟子(姓名)在此叩謝\n" +
            "十方世界諸佛菩薩。」\n" +
            "完成後，我會把此卦解讀送上。",
          size: "sm",
          color: "#666666",
          wrap: true,
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "收卦 · 退神",
            data: "action=liuyao_sendoff",
            displayText: "退神完成",
          },
        },
      ],
    },
  };
  await pushFlex(userId, "退神儀式", contents);
}

///用神推導函式
function inferUseGod({ topicText, genderText }) {
  const gender = (genderText || "").includes("女") ? "female" : "male";
  const t = (topicText || "").trim();

  if (t.includes("感情")) return gender === "female" ? "官鬼" : "妻財";
  if (t.includes("事業") || t.includes("工作")) return "父母";
  if (t.includes("財運") || t.includes("金錢") || t.includes("偏財"))
    return "妻財";
  if (t.includes("健康")) return "子孫";

  // 沒匹配到就給一個保守值，或直接回傳空字串讓你提示使用者補充
  return "";
}

////呼叫AI收六爻
async function callLiuYaoAI({ genderText, topicText, hexData, useGodText }) {
  // 0) 用神（有傳就用；沒傳就推導）
  const finalUseGodText =
    useGodText || inferUseGod({ topicText, genderText }) || "用神";
  // 1) 基本資料
  const gzArr = (hexData && hexData.ganzhi) || [];
  const gzLabels = ["年", "月", "日", "時"];
  const gzText =
    gzArr && gzArr.length
      ? gzArr
          .slice(0, 4)
          .map((v, i) => `${v}${gzLabels[i] || ""}`)
          .join("，")
      : "（干支資料缺失）";

  // 2) 旺相休囚死 + 月破（你現在做的函式）
  // 期望回傳例如：{ text: "木相，火死，土囚，金休，水旺，巳，月破" }
  let phaseText = "";
  try {
    const phase = buildElementPhase(gzArr);
    phaseText = phase?.text ? phase.text : "";
  } catch (e) {
    phaseText = "";
  }

  // 2.5) 旬空（你規則：只取第三個）
  const xk = Array.isArray(hexData?.xunkong) ? hexData.xunkong[2] : "";
  const xkText = xk ? `旬空：${xk}空` : "";

  // 3) 六爻六條逐行
  const sixLinesText = describeSixLines(hexData); // 你已經做好了

  // 4) System / User prompt
  const systemPrompt =
    "你是一個六爻解卦大師，講話要務實、清楚、有條理，不宿命論、不恐嚇。\n" +
    //"解讀時要先抓用神與世應、動爻、空亡、回頭生剋、伏藏等重點，再回到提問主題給建議。\n" +
    //"可以分段輸出：①卦象總評 ②用神狀態 ③趨勢與時間感 ④具體建議。";
    "結論分段輸出①過去 ②現在 ③未來\n" +
    "並拿掉六爻的專業術語，可以比較嘴炮風又帶親切的回覆\n" +
    "整體不要超過1000中文字";

  const userPrompt =
    `你是一個六爻解卦大師\n` +
    `今天有${genderText}\n` +
    `主題：${topicText}\n` +
    `本卦：${hexData?.bengua || "（缺）"}\n` +
    `變卦：${hexData?.biangua || "（缺）"}\n` +
    `${gzText}\n` +
    (phaseText ? `${phaseText}\n` : "") +
    (xkText ? `${xkText}\n` : "") +
    `\n` +
    //`六爻逐行說明如下：\n` +
    `${sixLinesText}\n` +
    `\n` +
    `${genderText}${topicText}\n` +
    `以${finalUseGodText}為用神\n` +
    `請你解卦,最後請以繁體中文回覆`;

  // ✅ 想先人工檢查 prompt 就打開這兩行
  //console.log("[liuyao] systemPrompt:\n", systemPrompt);
  //console.log("[liuyao] userPrompt:\n", userPrompt);

  // 5) Call AI
  const aiText = await AI_Reading(userPrompt, systemPrompt);

  return { aiText, userPrompt, systemPrompt };
}

/***************************************
 * [六爻結果 Cache]：讓使用者點章節時不用重算
 ***************************************/
const LY_TTL = 30 * 60 * 1000; // 30 分鐘
const lyCache = new Map();

function lySave(userId, payload) {
  lyCache.set(userId, { ...payload, ts: Date.now() });
}

function lyGet(userId) {
  const v = lyCache.get(userId);
  if (!v) return null;
  if (Date.now() - v.ts > LY_TTL) {
    lyCache.delete(userId);
    return null;
  }
  return v;
}

/***************************************
 * [六爻文字 Parser]：把 AI 回覆拆成 ①②③ + 總結
 * - 允許中間有破折號、空行、標點變化
 ***************************************/
function lyParse(aiText = "") {
  const text = String(aiText || "").trim();

  // 用比較寬鬆的方式抓「總結」段
  const sumMatch = text.match(/(?:總結|結論)[\s：:]*([\s\S]*)$/);
  const summary = sumMatch ? `總結：${sumMatch[1].trim()}` : "";

  // 抓 ①②③ 三段（各自到下一段標記前截止）
  const p1 = pickBlock(text, /①[\s\S]*?(?=②|$)/);
  const p2 = pickBlock(text, /②[\s\S]*?(?=③|$)/);
  const p3 = pickBlock(text, /③[\s\S]*?(?=$)/);

  // 清理：把最後的「總結」從③移掉（避免重複）
  const future = summary ? p3.replace(/(?:總結|結論)[\s\S]*$/g, "").trim() : p3;

  return {
    past: p1.trim(),
    now: p2.trim(),
    future: future.trim(),
    summary: summary.trim(),
    raw: text,
  };

  function pickBlock(src, re) {
    const m = src.match(re);
    return m ? m[0] : "";
  }
}

/***************************************
 * [六爻總覽 Flex]：1 張總覽 + 2×2 章節選單 + Footer CTA
 ***************************************/
async function lyMenuFlex(userId, meta, parsed) {
  const {
    topicLabel = "六爻占卜",
    genderLabel = "",
    bengua = "",
    biangua = "",
  } = meta || {};
  const oneLiner =
    parsed?.summary || "總結：我先幫你把重點收斂好了，你可以挑你想看的段落。";

  const bubble = {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `六爻占卜｜${topicLabel}`,
          weight: "bold",
          size: "lg",
          wrap: true,
        },

        // ✅ 本卦一行、變卦一行（不用 \n / join）
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            ...(bengua
              ? [
                  {
                    type: "text",
                    text: `本卦 - ${toTW(bengua)}`,
                    size: "xs",
                    color: "#777777",
                    wrap: true,
                  },
                ]
              : []),
            ...(biangua
              ? [
                  {
                    type: "text",
                    text: `變卦 - ${toTW(biangua)}`,
                    size: "xs",
                    color: "#777777",
                    wrap: true,
                  },
                ]
              : []),
          ],
        },

        { type: "separator", margin: "md" },

        /*
  {
    type: "text",
    text: "一句話總結",
    size: "sm",
    weight: "bold",
    color: "#555555",
  },
  */
        {
          type: "text",
          text: oneLiner,
          size: "md",
          wrap: true,
        },

        { type: "separator", margin: "md" },

        {
          type: "text",
          text: "你想先看哪段？",
          size: "sm",
          weight: "bold",
          color: "#555555",
        },

        /* 1×3 選單（box 當按鈕） */
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                lyBox("看過去", "六爻過去", "#F5EFE6"),
                lyBox("看現在", "六爻現在", "#F0F4F8"),
                lyBox("看未來", "六爻未來", "#EEF6F0"),
              ],
            },
          ],
        },
      ],
    },

    /* Footer：回到流程 / 請老師解卦（接 booking） */
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        /*
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "message", label: "回到流程", text: "回到流程" },
        },
        */
        {
          type: "button",
          style: "primary",
          height: "sm",
          color: "#8E6CEF",
          action: {
            type: "message",
            label: "請老師解卦",
            text: "預約諮詢",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "六爻解卦總覽", bubble);

  function lyBox(label, text, bgColor) {
    return {
      type: "box",
      layout: "vertical",
      flex: 1,
      paddingAll: "md",
      cornerRadius: "12px",
      backgroundColor: bgColor,
      justifyContent: "center",
      alignItems: "center",
      action: { type: "message", label, text },
      contents: [
        {
          type: "text",
          text: label,
          size: "md",
          weight: "bold",
          align: "center",
          wrap: true,
          color: "#333333",
        },
      ],
    };
  }
}

/***************************************
 * [六爻章節頁 Flex]：單頁（過去/現在/未來）
 * Footer：下一頁 / 回總覽
 ***************************************/
async function lyPartFlex(userId, meta, parsed, partKey) {
  /***************************************
   * [章節設定]：標題 + 順序 + 下一頁
   ***************************************/
  const titleMap = { past: "① 過去", now: "② 現在", future: "③ 未來" };
  const order = ["past", "now", "future"];
  const idx = order.indexOf(partKey);
  const nextKey = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  /***************************************
   * [章節內容]：依 partKey 取對應段落文字
   ***************************************/
  const text =
    partKey === "past"
      ? parsed?.past
      : partKey === "now"
        ? parsed?.now
        : parsed?.future;

  /***************************************
   * [按鈕指令]：避免跟八字「看總覽」撞名
   * - 六爻全部用「六爻xxx」指令
   ***************************************/
  const keyToCmd = {
    past: "六爻過去",
    now: "六爻現在",
    future: "六爻未來",
  };
  const nextCmd = nextKey ? keyToCmd[nextKey] : "六爻總覽";

  /***************************************
   * [Footer CTA]：
   * - 非最後一頁：主按鈕 = 下一頁
   * - 最後一頁：主按鈕 = 請老師解卦（避免跟回總覽重複）
   * - 永遠保留：link = 回六爻總覽
   ***************************************/
  const footerContents = [];

  if (nextKey) {
    footerContents.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: {
        type: "message",
        label: `下一頁（${titleMap[nextKey]}）`,
        text: nextCmd,
      },
    });
  } else {
    footerContents.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: "#8E6CEF",
      action: {
        type: "message",
        label: "請老師解卦",
        text: "預約諮詢",
      },
    });
  }

  footerContents.push({
    type: "button",
    style: "link",
    height: "sm",
    action: { type: "message", label: "回六爻總覽", text: "六爻總覽" },
  });

  /***************************************
   * [Flex Bubble]：單頁章節卡
   ***************************************/
  const bubble = {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `六爻解卦｜${titleMap[partKey] || "段落"}`,
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        {
          type: "text",
          text: meta?.topicLabel ? `主題：${meta.topicLabel}` : "",
          size: "xs",
          color: "#777777",
          wrap: true,
        },
        { type: "separator", margin: "md" },
        {
          type: "text",
          text:
            text ||
            "（這段內容解析不到。你可以回六爻總覽再點一次，或重新起卦。）",
          size: "md",
          wrap: true,
        },
      ].filter(Boolean),
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: footerContents,
    },
  };

  await pushFlex(userId, "六爻解卦段落", bubble);
}

/***************************************
 * [六爻全文]：用 carousel 3 頁（比 1300 字長文 Flex 好讀）
 ***************************************/
async function lyAllCarousel(userId, meta, parsed) {
  const mk = (title, text) => ({
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `六爻解卦｜${title}`,
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        meta?.topicLabel
          ? {
              type: "text",
              text: `主題：${meta.topicLabel}`,
              size: "xs",
              color: "#777777",
              wrap: true,
            }
          : null,
        { type: "separator", margin: "md" },
        { type: "text", text: text || "（無內容）", size: "md", wrap: true },
      ].filter(Boolean),
    },
  });

  const flex = {
    type: "carousel",
    contents: [
      mk("① 過去", parsed.past),
      mk("② 現在", parsed.now),
      mk("③ 未來", `${parsed.future}\n\n${parsed.summary || ""}`.trim()),
    ],
  };

  await pushFlex(userId, "六爻解卦全文", flex);
}

/***************************************
 * [六爻總覽導航]：讓使用者在聊天室輸入「看過去」等指令
 * - 你在 handleLineEvent 裡先呼叫它，吃到就 return
 * - 指令統一加「六爻」前綴
 * - 移除「看全文」
 ***************************************/
async function handleLyNav(userId, text) {
  const t = String(text || "")
    .trim()
    .replace(/\s+/g, "");
  if (!t) return false;

  const allow = ["六爻總覽", "六爻過去", "六爻現在", "六爻未來"];
  if (!allow.includes(t)) return false;

  const cached = lyGet(userId);
  if (!cached) {
    await pushText(
      userId,
      "你這一卦的內容我這邊找不到了（可能已過期或你已重新起卦）。要不要重新起一卦？",
    );
    return true;
  }

  const { meta, parsed } = cached;

  if (t === "六爻總覽") {
    await lyMenuFlex(userId, meta, parsed);
    return true;
  }
  if (t === "六爻過去") {
    await lyPartFlex(userId, meta, parsed, "past");
    return true;
  }
  if (t === "六爻現在") {
    await lyPartFlex(userId, meta, parsed, "now");
    return true;
  }
  if (t === "六爻未來") {
    await lyPartFlex(userId, meta, parsed, "future");
    return true;
  }

  return false;
}

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Booking API server running at http://localhost:${PORT}`);
});
