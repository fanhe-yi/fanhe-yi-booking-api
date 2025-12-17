const express = require("express");
const cors = require("cors");
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
  sendBaziMatchResultFlex,
  sendLiuYaoMenuFlex,
  sendLiuYaoTimeModeFlex,
} = require("./lineClient");

//AI 訊息回覆相關
const { AI_Reading } = require("./aiClient");
//把 API 八字資料整理成：給 AI 用的摘要文字
const { getBaziSummaryForAI } = require("./baziApiClient");
//六爻相關
const { getLiuYaoGanzhiForDate, getLiuYaoHexagram } = require("./lyApiClient");
const { describeSixLines, buildElementPhase } = require("./liuYaoParser");

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

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// 系統所有可用時段（中心真相）——之後前端/後台都應該跟這個一致
const ALL_TIME_SLOTS = [
  "09:00-10:00",
  "10:30-11:30",
  "14:00-15:00",
  "15:30-16:30",
  "20:00-21:00（線上）",
];

// 🔹 服務代碼 → 顯示名稱
const SERVICE_NAME_MAP = {
  bazi: "八字諮詢",
  ziwei: "紫微斗數",
  name: "改名 / 姓名學",
  fengshui: "風水勘察",
  chat_line: "命理諮詢", // 預設用在聊天預約沒特別指定時
};

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
      "utf-8"
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
////////////////////////////////////////
///新增「選服務」的 Flex（第一層 bubble/）//
////////////////////////////////////////

// 🔹 第一步：服務選擇 Flex（八字 / 紫微 / 姓名）
async function sendServiceSelectFlex(userId) {
  const services = [
    { id: "bazi", label: "八字諮詢" },
    { id: "ziwei", label: "紫微斗數" },
    { id: "name", label: "改名 / 姓名學" },
    // 之後你要開風水可以再加：
    // { id: "fengshui", label: "風水勘察" },
  ];

  const buttons = services.map((s) => ({
    type: "button",
    style: "primary",
    height: "sm",
    margin: "sm",
    action: {
      type: "postback",
      label: s.label,
      data: `action=choose_service&service=${s.id}`,
      displayText: `我想預約 ${s.label}`,
    },
  }));

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
          text: "梵和易學｜預約服務",
          size: "sm",
          color: "#888888",
        },
        {
          type: "text",
          text: "請先選擇你想預約的項目：",
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
  };

  await pushFlex(userId, "請選擇預約服務", bubble);
}

// 🔹 日期選擇 Carousel Flex（每一頁有多個「日期按鈕」，會帶著 serviceId）
async function sendDateCarouselFlex(userId, serviceId) {
  //
  const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

  // 想開放幾天自己決定：例如未來 30 天
  const days = getNextDays(30);
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
            style: "primary",
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
      `這一天（${dateStr}）目前沒有開放的時段喔。\n你可以換一天試試看，或直接跟我說你方便的時間～`
    );
    return;
  }

  const buttons = openSlots.map((slot) => ({
    type: "button",
    style: "primary",
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
        err?.response?.data || err.message || err
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
      "這是一則測試訊息：預約系統 LINE 通知已連線 ✅"
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

app.post("/api/admin/unavailable", requireAdmin, (req, res) => {
  const body = req.body;

  const unavailable = {
    fullDay: Array.isArray(body.fullDay) ? body.fullDay : [],
    slots: Array.isArray(body.slots) ? body.slots : [],
  };

  saveUnavailable(unavailable);
  res.json({ success: true });
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
      d
    ).padStart(2, "0")} ${hh}:${mm}`;
  }

  return { y, m, d, h, mi, desc };
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
  // 取出這個使用者目前的對話狀態
  const state = conversationStates[userId] || null;

  // ==========================
  // 先處理 postback（按 Flex 按鈕）
  // ==========================
  if (event.type === "postback") {
    const data = event.postback.data || "";
    console.log(`📦 收到 postback：${data}`);

    // 交給專門處理 postback 的 router
    await routePostback(userId, data, state);
    return;
  }

  // --- 2) 處理文字訊息 ---
  if (event.type === "message" && event.message.type === "text") {
    const text = (event.message.text || "").trim();
    //console.log(`👤 ${userId} 說：${text}`);

    // 2-1. 如果目前在某個對話流程中（例如預約 / 小占卜）
    if (state) {
      const handled = await routeByConversationState(
        userId,
        text,
        state,
        event
      );
      if (handled) return; // 若已被對應流程吃掉，這次就結束
    }

    // 2-2. 沒有在進行中的對話 → 看是不是指令（預約 / 八字測算 / 其他）
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
  // 1) 預約指令（沿用你原本的行為）
  if (text === "預約") {
    // 清掉舊的對話狀態，避免卡在別的流程
    conversationStates[userId] = {
      mode: "booking", // 標記：現在是在預約流程
      stage: "idle", // 先沒有在問問題，只是在選服務/日期/時段
      data: {}, // 後面會塞 serviceId / date / timeSlot
    };

    // 丟「八字 / 紫微 / 姓名」那顆 Bubble
    await sendServiceSelectFlex(userId);
    return;
  }

  // 2) 八字測算（原本的小占卜）
  if (text === "八字測算" || text === "小占卜") {
    // 設定對話狀態：等待輸入生日字串
    conversationStates[userId] = {
      mode: "mini_bazi",
      stage: "wait_mode", // 先讓用戶選 A/B/C/D
      data: {},
    };
    // 丟出「格局 / 流年 / 流月 / 流日」的 Flex 選單
    await sendBaziMenuFlex(userId);

    return;
  }

  // 3) 八字合婚
  if (text === "八字合婚") {
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
        "如果不想提供時辰，可以輸入：1992-12-05-未知"
    );
    return;
  }

  // 4) 六爻占卜入口
  if (text === "六爻占卜") {
    conversationStates[userId] = {
      mode: "liuyao",
      stage: "wait_topic", // 先選感情 / 事業 / 財運 / 健康
      data: {},
    };

    await sendLiuYaoMenuFlex(userId);
    return;
  }

  // 5) 其他文字 → 類似 echo 或之後你要做 FAQ / 論命前須知 可以在這裡加
  await pushText(userId, `我有聽到你說：「${text}」，目前是機器人回覆唷`);
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

  if (mode === "mini_bazi") {
    // 交給八字測算流程處理
    return await handleMiniBaziFlow(userId, text, state, event);
  }

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

//routePostback：按 Flex 按鈕時怎麼分派
async function routePostback(userId, data, state) {
  const params = new URLSearchParams(data);
  const action = params.get("action");

  // 預約流程的選服務 / 選日期 / 選時段
  if (
    action === "choose_service" ||
    action === "choose_date" ||
    action === "choose_slot"
  ) {
    // 這個本來就是預約相關 → 交給 booking flow
    return await handleBookingPostback(userId, action, params, state);
  }

  // 🔮 八字測算：使用者從主選單選了「格局 / 流年 / 流月 / 流日」
  if (action === "bazi_mode") {
    const mode = params.get("mode"); // pattern / year / month / day

    // 只接受這四種，避免亂按奇怪的 data
    const ALLOWED = ["pattern", "year", "month", "day"];
    if (!ALLOWED.includes(mode)) {
      await pushText(userId, "這個八字測算按鈕目前沒有對應的解析方式。");
      return;
    }

    // ✅ 先記住 mode，下一步改成問「男命 / 女命」
    conversationStates[userId] = {
      mode: "mini_bazi",
      stage: "wait_gender",
      data: {
        baziMode: mode,
      },
    };

    await pushText(
      userId,
      "這次要以「男命」還是「女命」來看呢？\n\n" +
        "請輸入：男 / 男生 / 男命 或 女 / 女生 / 女命。"
    );
    return;
  }

  // ⭐ 六爻：選主題（感情 / 事業 / 財運 / 健康）
  if (action === "liuyao_topic") {
    const topic = params.get("topic"); // love / career / wealth / health
    const allow = ["love", "career", "wealth", "health"];

    if (!allow.includes(topic)) {
      await pushText(userId, "這個占卜主題我看不懂，請重新點一次按鈕試試。");
      return;
    }

    conversationStates[userId] = {
      mode: "liuyao",
      stage: "wait_gender",
      data: {
        topic,
      },
    };

    await pushText(
      userId,
      "好的～這一卦要問「" +
        (topic === "love"
          ? "感情"
          : topic === "career"
          ? "事業"
          : topic === "wealth"
          ? "財運"
          : "健康") +
        "」。\n\n先跟我說，這是「男占」還是「女占」？\n\n可以輸入：男 / 男生 / 男命 或 女 / 女生 / 女命。"
    );
    return;
  }

  // 六爻：選起卦時間模式（現在 / 指定）
  if (action === "liuyao_time_mode") {
    const mode = params.get("mode"); // now / custom

    // 理論上 state 一定存在，但多一道保護
    const currState = state || conversationStates[userId];
    if (!currState || currState.mode !== "liuyao") {
      await pushText(
        userId,
        "目前沒有正在進行的六爻占卜流程，如果要重來，可以先輸入「六爻占卜」。"
      );
      return;
    }

    if (mode === "now") {
      currState.data.timeMode = "now";
      currState.data.questionTime = new Date().toISOString(); // 之後呼叫六爻 API 會用到
      currState.stage = "collect_yao_notice"; // 下一步：占卦須知 + 請神咒 + 開始記錄一爻一爻
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
          "⚠️ 六爻起卦盡量不要用「未知」，至少要大約時辰區間。"
      );
      return;
    }

    await pushText(userId, "起卦時間的選項怪怪的，請再點一次按鈕看看。");
    return;
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
        `好的，${text}，\n\n如果不方便留資料，也可以輸入「略過」。`
      );
      return true;
    }

    // 存姓名，進入下一階段
    state.data.name = trimmed;
    state.stage = "waiting_phone";
    conversationStates[userId] = state;

    await pushText(
      userId,
      `好的，${trimmed}～\n` +
        `已幫你記錄姓名。\n\n接下來請輸入「聯絡電話」。\n如果不方便留電話，也可以輸入「略過」。`
    );
    return true;
  }

  // A-2. 問電話 / 聯絡方式
  if (state.stage === "waiting_phone") {
    if (!trimmed) {
      await pushText(
        userId,
        "至少留一種聯絡方式給我（手機或 LINE ID 都可以）。\n如果不方便留資料，也可以輸入「略過」。"
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
        "如果沒有特別備註，可以輸入「無」。"
    );
    return true;
  }

  // A-3. 問備註 → 收齊資料 → 寫入預約 → 通知 + hero
  if (state.stage === "waiting_note") {
    state.data.note = trimmed === "無" ? "" : trimmed;

    // 組一份 bookingBody，格式跟 /api/bookings 類似
    const bookingBody = {
      serviceId: state.data.serviceId || "chat_line", // 目前沒有選服務，就先標記 chat_line
      name: state.data.name || "",
      email: "",
      phone: state.data.phone || "",
      lineId: "", // 聊天預約這裡就不另外收 lineId
      date: state.data.date,
      timeSlots: [state.data.timeSlot],
      note: state.data.note || "",
      lineUserId: userId, // 直接用 LINE userId 綁定
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
          `聯絡方式：${bookingBody.phone}`
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
      "[bookingPostback] 收到 booking 類型 postback，但目前不在 booking 模式，略過。"
    );
    await pushText(
      userId,
      "這個按鈕目前沒有對應的預約流程，如果要重新預約，可以直接輸入「預約」。"
    );
    return;
  }

  // 2) 選服務：action=choose_service&service=bazi
  if (action === "choose_service") {
    const serviceId = params.get("service");

    if (!serviceId) {
      await pushText(
        userId,
        "服務項目資訊缺失，麻煩你再輸入一次「預約」，重新選擇服務。"
      );
      return;
    }

    const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

    console.log(`🧭 [booking] 使用者選擇服務：${serviceId} (${serviceName})`);

    // 更新狀態：記住 service，接下來要選日期
    conversationStates[userId] = {
      mode: "booking",
      stage: "waiting_date",
      data: {
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
        "日期資訊有點怪怪的，麻煩你再選一次日期，或重新輸入「預約」。"
      );
      return;
    }

    console.log(`📅 [booking] 使用者選擇日期：${date}（服務：${serviceName}）`);

    // 更新狀態：記住日期，下一步要選時段
    conversationStates[userId] = {
      mode: "booking",
      stage: "waiting_slot",
      data: {
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
        "時段資訊有點怪怪的，麻煩你再輸入一次「預約」重新選擇。"
      );
      return;
    }

    const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

    console.log(`✅ [booking] 使用者選擇：${serviceName} ${date} ${time}`);

    // 更新這個 user 的對話狀態：已選好服務＋日期＋時段，接下來要問姓名
    conversationStates[userId] = {
      mode: "booking",
      stage: "waiting_name",
      data: {
        serviceId,
        date,
        timeSlot: time,
      },
    };

    await pushText(
      userId,
      `已幫你記錄預約項目：${serviceName}\n時段：${date} ${time}\n\n接下來請先輸入你的「姓名」。`
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
    `[miniBaziFlow] from ${userId}, stage=${state.stage}, text=${text}`
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
          "可以輸入：男 / 男生 / 男命 或 女 / 女生 / 女命。"
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
        "如果不想提供時辰，可以在最後寫「未知」。"
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
          "如果不想提供時辰，可以輸入：1992-12-05-未知"
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
        parsed,
        mode,
        gender
      );

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
      await sendMiniBaziResultFlex(userId, {
        birthDesc,
        mode,
        aiText,
        pillarsText,
        fiveElementsText,
      });

      delete conversationStates[userId];
      return true;
    } catch (err) {
      console.error("[miniBaziFlow] AI error:", err);
      await pushText(
        userId,
        "八字測算目前有點塞車 😅\n你可以稍後再試一次，或直接輸入「預約」進行完整論命。"
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
    `[baziMatchFlow] from ${userId}, stage=${state.stage}, text=${text}`
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
          "如果不想提供時辰，可以輸入：1992-12-05-未知"
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
        "如果不想提供時辰，可以輸入：1992-12-05-未知"
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
          "如果不想提供時辰，可以輸入：1992-12-05-未知"
      );
      return true;
    }

    state.data = state.data || {};
    state.data.femaleBirth = parsed;

    try {
      // 👉 呼叫合婚 AI，拿到合婚結果（JSON 字串等）
      const result = await callBaziMatchAI(state.data.maleBirth, parsed);

      // 👉 這裡用「人話時間」格式給 Flex header 用
      // 需要先在上面有定義 formatBirthForDisplay(birthObj)
      const maleBirthDisplay = formatBirthForDisplay(state.data.maleBirth);
      const femaleBirthDisplay = formatBirthForDisplay(parsed);

      // 🔚 丟 Flex 合婚結果
      await sendBaziMatchResultFlex(userId, {
        ...result, // 包含 aiText、matchDisplayText、matchPromptText 等
        maleBirthDisplay, // 給 header 顯示「男方：YYYY-MM-DD HH:mm / 約 XX:XX–XX:XX」
        femaleBirthDisplay, // 給 header 顯示「女方：...」
      });

      delete conversationStates[userId];
      return true;
    } catch (err) {
      console.error("[baziMatchFlow] AI error:", err);
      await pushText(
        userId,
        "合婚這邊目前有點塞車 😅\n你可以晚點再試一次，或直接輸入「預約」詢問完整合婚。"
      );
      delete conversationStates[userId];
      return true;
    }
  }

  return false;
}

// ========================
//  六爻占卜主流程
// ========================
async function handleLiuYaoFlow(userId, text, state, event) {
  if (!state || state.mode !== "liuyao") return false;

  console.log(
    `[liuYaoFlow] from ${userId}, stage=${state.stage}, text=${text}`
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
        "我這邊要先知道是「男占」還是「女占」。\n\n可以輸入：男 / 男生 / 男命 或 女 / 女生 / 女命。"
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
          "- 2025-11-24-亥"
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

    // 這裡先用「單一數字」當作每一爻的代碼（你之後可以改成擲銅錢的 6 / 7 / 8 / 9 等）
    if (!/^[0-9]$/.test(trimmed)) {
      await pushText(
        userId,
        "繼續輸入數字代碼（0~3），代表這一爻的起卦結果。\n\n記得：3代表三個正面(沒數字那面)，2代表二個正面，以此類推。"
      );
      return true;
    }

    state.data.yy += trimmed;

    const nowIndex = state.data.yaoIndex;
    const nextIndex = nowIndex + 1;
    state.data.yaoIndex = nextIndex;

    // 還沒滿六爻 → 繼續下一爻
    if (state.data.yy.length < 6) {
      conversationStates[userId] = state;
      await pushText(
        userId,
        `已記錄第 ${nowIndex} 爻，目前累積碼：${state.data.yy}\n\n請輸入第 ${nextIndex} 爻的代碼（單一數字）。`
      );
      return true;
    }

    // ✅ 已經湊滿 6 碼
    const finalCode = state.data.yy.slice(0, 6);
    state.stage = "wait_ai_result"; // 下一步我們會串 youhualao API + AI 解卦
    conversationStates[userId] = state;

    await pushText(
      userId,
      `好的，六個爻都記錄完成了。\n\n這一卦的起卦碼是：${finalCode}。\n我這邊會先整理卦象資料，接著幫你做 AI 解卦。`
    );

    // 👉 這裡下一步就是：
    // 1) 把起卦時間（now 或 customBirth） + finalCode 丟進 getLiuYaoHexagram(...)
    // 2) 把 API 回傳整理成你要的六爻文字
    // 3) 丟進 AI_Reading 產生解卦
    // 我們可以在下一輪一起把這三步補上。

    try {
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

      // ⬇️【就貼在這裡】呼叫 AI 解卦
      const { aiText } = await callLiuYaoAI({
        genderText: state.data.gender === "female" ? "女命" : "男命",
        topicText: state.data.topic || "感情",
        hexData: state.data.hexData,
        useGodText: "官鬼",
      });

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

// 六爻占卜：說明占卦須知 + 請神咒 + 問第 1 爻
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

  const noticeText =
    "在起卦之前，先跟你說明一下六爻占卜的小提醒：\n\n" +
    "1️⃣ 一卦一問：這一卦專心只看一個主題，不要混太多問題。\n" +
    "2️⃣ 問眼前真實狀況：盡量針對正在發生、或即將發生的具體情境。\n" +
    "3️⃣ 心念要穩：起卦前讓自己的心情稍微平靜一下，問題想清楚再開始。\n\n" +
    "接下來，請你在心裡專注在「" +
    topicLabel +
    "」這個主題上，默念你心中的問題。";

  const spellText =
    "如果你不排斥，也可以在心裡或小聲唸一段簡單請神文，加一點儀式感：\n\n" +
    "「弟子某某，誠心焚香起卦，祈請諸位神明、祖先護祐，\n" +
    "指點關於此事的因果與趨勢，使我得以趨吉避凶、安穩前行。」\n\n" +
    "不用一定照字逐字唸，抓大意就好，重點是專心。";

  await pushText(userId, noticeText);
  await pushText(userId, spellText);

  // 把 stage 切成 collect_yao，等使用者輸入第一爻
  state.stage = "collect_yao";
  state.data.yaoIndex = 1;
  state.data.yy = "";
  conversationStates[userId] = state;

  await pushText(
    userId,
    "這邊請直接輸入一個數字代碼（0~3），代表這一爻的起卦結果。\n\n例如：\n3代表三個正面(沒數字那面)，\n2代表二個正面。"
  );
}

// --- 將 baziSummaryText 解析出 年柱/月柱/日柱/時柱 ---
function extractPillars(baziSummaryText) {
  const lines = baziSummaryText.split(/\r?\n/);

  let year = "",
    month = "",
    day = "",
    hour = "";

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
  gender = "unknown"
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

  // --- focus 語氣設定 ----
  let focusText = "";
  let timePhraseHint = "";

  if (mode === "pattern") {
    focusText =
      "本次以「格局 / 命盤基礎性格與人生主調」為主，不特別細拆流年流月。";
    timePhraseHint =
      "在描述時可以多用「整體來說」「長期來看」這類字眼，少用「今年」「這個月」「今天」。";
  } else if (mode === "year") {
    focusText =
      "本次以「今年的流年變化與提醒」為主，重點放在流年年柱與命主八字之間的五行生剋制化、刑沖合害。格局只簡單帶過。";
    timePhraseHint =
      "請在內容中多用「今年」「這一年」「這一年當中」等字眼，讓讀者明顯感覺到是年度層級。";
  } else if (mode === "month") {
    focusText =
      "本次以「這個月的運勢節奏與起伏」為主，重點放在本月月柱與命主八字之間的五行互動與刑沖合害。格局只簡單帶過。";
    timePhraseHint =
      "請多用「這幾個月」「本月」「近期一兩個月」等字眼，讓讀者感覺是 1～3 個月的節奏。";
  } else if (mode === "day") {
    focusText =
      "本次以「今日 / 最近幾日的狀態提醒」為主，重點放在今日日柱對命主八字的觸發與起伏。格局只簡單帶過。";
    timePhraseHint =
      "請多用「今天」「這幾天」「這陣子」等字眼，讓讀者感覺是當下幾天的提醒。";
  } else {
    focusText = "本次以整體命格與最近一年提醒為主。";
    timePhraseHint = "";
  }

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

    console.log(
      "[callMiniReadingAI][fallback] systemPrompt:\n",
      fallbackSystemPrompt
    );
    console.log(
      "[callMiniReadingAI][fallback] userPrompt:\n",
      fallbackUserPrompt
    );

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
      const { yearGZ, monthGZ, dayGZ, hourGZ } = await getLiuYaoGanzhiForDate(
        now
      );

      if (mode === "year") {
        flowingGzText =
          "【當下流年干支資訊】\n" +
          `今年流年年柱：${yearGZ}\n` +
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
  const systemPrompt =
    "你是一位懂八字與紫微斗數的東方命理老師，" +
    "講話溫和、實際，不宿命論，不嚇人。" +
    genderHintForSystem + //systemPrompt / fallback 補上「男命 / 女命」語氣
    "你已經拿到系統事先換算好的四柱八字、十神與部分藏干資訊，" +
    "請一律以這些資料為準，不要自行重新計算，也不要質疑數據本身。" +
    "重點是根據提供的結構化八字資訊，做出貼近日常生活、具體可行的提醒與說明。" +
    "### 請務必遵守輸出格式：" +
    "永遠只輸出 JSON，不要任何其他文字，不要加註解，不要加 ``` 等 Markdown。" +
    "格式如下：" +
    "{ " +
    '"personality": "人格特質的說明150-170 個中文字", ' +
    '"social": "人際關係的說明，150-170 個中文字", ' +
    '"partner": "伴侶 / 親密關係的說明，150-170 個中文字", ' +
    '"family": "家庭互動 /原生家庭或家人互動的說明，150-170 個中文字", ' +
    '"study_work": "學業 / 工作方向與節奏的說明，150-170 個中文字"' +
    " }" +
    "每一段都要濃縮具體，只寫可行建議，不要廢話、不重覆、不講專業術語堆疊。" +
    "五段合計大約 750～850 個中文字（含標點）。" +
    "務必符合 JSON 格式，所有 key 都要用雙引號包起來。";

  // --- userPrompt ---
  const userPrompt =
    `【基本資料】\n` +
    `${birthDesc}\n` +
    `原始輸入格式：${raw}\n\n` +
    `【本次解讀重點】\n${focusText}\n` +
    (timePhraseHint ? `\n${timePhraseHint}\n\n` : "\n") +
    "【命盤結構摘要（請以此為準）】\n" +
    `${baziSummaryText}\n\n` +
    (flowingGzText ? `${flowingGzText}\n\n` : "") +
    "【請你這樣做】\n" +
    "1. 不要再自行推算八字，以上述四柱、十神、藏干資訊為準。\n" +
    "2. 先簡短總結這個命盤的調性（例如：偏行動 / 思考 / 感受、偏穩定或變動等），但這段不要另外獨立輸出，只要自然融入五個欄位之中。\n" +
    "3. 在內容中自然寫出年柱、月柱、日柱、時柱與日主，以及五行數量（不用算藏干），但不要做成條列，只要融入文字。\n" +
    "4. 依照五個面向：人格特質、人際關係、伴侶關係、家庭互動、學業/工作，分別寫 150-170 個中文字的建議與提醒。\n" +
    "5. 若時辰未知或僅為約略時段，請在適當欄位自然提到「時柱僅供參考」或「本次以前三柱為主」。\n" +
    "6. 語氣像在跟朋友聊天，溫和、實際，可以有點幽默但不要酸人。\n" +
    "7. 最後在某一欄位的結尾，用一個溫柔的句子收尾，讓對方有被支持的感覺。\n" +
    "8. 非常重要：最終輸出只能是 JSON 物件本身，不要出現任何解釋文字、不要多一句話、不要加 ```json。";

  console.log("[callMiniReadingAI] systemPrompt:\n", systemPrompt);
  console.log("[callMiniReadingAI] userPrompt:\n", userPrompt);
  console.log("[callMiniReadingAI] flowingGzText:\n", flowingGzText);

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
  const { summaryText: maleBaziSummaryText } = await getBaziSummaryForAI(
    maleBirthObj
  );
  const { summaryText: femaleBaziSummaryText } = await getBaziSummaryForAI(
    femaleBirthObj
  );

  // 2) 拆出四柱，再取月支 + 日支
  const malePillars = extractPillars(maleBaziSummaryText); // { year, month, day, hour }
  const femalePillars = extractPillars(femaleBaziSummaryText);

  const maleMonthBranch = (malePillars.month || "").slice(1); // 取第 2 個字當地支
  const maleDayBranch = (malePillars.day || "").slice(1);
  const femaleMonthBranch = (femalePillars.month || "").slice(1);
  const femaleDayBranch = (femalePillars.day || "").slice(1);

  // 3) 組給 AI 的「內部合婚提示」
  //    👉 含 月支 / 日支 + 「幫我合婚」，只給 AI 用
  const matchPromptText =
    `男命 月支${maleMonthBranch} 日支${maleDayBranch} ` +
    `女命 月支${femaleMonthBranch} 日支${femaleDayBranch} 幫我合婚`;

  // 4) 組給使用者看的說明文字（看你要不要更 detail）
  //    👉 不出現地支、也不出現「幫我合婚」
  const matchDisplayText =
    "本次合婚是依照雙方的出生年月日，" +
    "以八字命盤的整體結構來評估緣分走向與相處模式計分。";

  // 4) 系統提示：要求 JSON + 分數
  const systemPrompt =
    "你是一位專門看八字合婚的東方命理老師，講話是現代嘴炮風。" +
    "你會收到兩位當事人的八字摘要（包含四柱與部分五行資訊），請根據兩人的命盤，" +
    "重點參考「月支與日支之間的關係」以及「雙方五行生剋是否互補或失衡」，" +
    "綜合給出合婚評估。" +
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

  console.log("[callBaziMatchAI] userPrompt:\n", userPrompt);
  console.log("[callBaziMatchAI] systemPrompt:\n", systemPrompt);

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

////呼叫AI收六爻
async function callLiuYaoAI({ genderText, topicText, hexData, useGodText }) {
  // 1) 基本資料
  const gzArr = (hexData && hexData.ganzhi) || [];
  const gzText = gzArr.length ? gzArr.join("，") : "（干支資料缺失）";

  // 2) 旺相休囚死 + 月破（你現在做的函式）
  // 期望回傳例如：{ text: "木相，火死，土囚，金休，水旺，巳，月破" }
  let phaseText = "";
  try {
    const phase = buildElementPhase(gzArr);
    phaseText = phase?.text ? phase.text : "";
  } catch (e) {
    phaseText = "";
  }

  // 3) 六爻六條
  const sixLinesText = describeSixLines(hexData); // 你已經做好了

  // 4) System / User prompt
  const systemPrompt = "";
  //"你是一個六爻解卦大師，講話要務實、清楚、有條理，不宿命論、不恐嚇。" +
  //"解讀時要先抓用神與世應、動爻、空亡、回頭生剋、伏藏等重點，再回到提問主題給建議。" +
  //"可以分段輸出：①卦象總評 ②用神狀態 ③趨勢與時間感 ④具體建議。";

  const userPrompt =
    `你是一個六爻解卦大師\n` +
    `今天有${genderText}\n` +
    `主題：${topicLabel}\n` +
    `卦象如下：\n` +
    `${gzText}\n` +
    (phaseText ? `${phaseText}\n` : "") +
    `\n` +
    `${sixLinesText}\n` +
    `\n` +
    `${genderText}${topicLabel}\n` +
    `以${useGodText}為用神\n` +
    `請你解卦`;

  // ✅ 想先人工檢查 prompt 就打開這兩行
  console.log("[liuyao] systemPrompt:\n", systemPrompt);
  console.log("[liuyao] userPrompt:\n", userPrompt);

  // 5) Call AI
  const aiText = await AI_Reading(userPrompt, systemPrompt);

  return { aiText, userPrompt, systemPrompt };
}

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Booking API server running at http://localhost:${PORT}`);
});
