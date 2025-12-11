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
} = require("./lineClient");

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
  const dayGroups = chunkArray(days, 5);

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
  console.log("💬 收到一個 LINE Webhook 事件：");
  console.log(JSON.stringify(req.body, null, 2));

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

  // ==========================
  // 先處理 postback（按 Flex 按鈕）
  // ==========================
  if (event.type === "postback") {
    const data = event.postback.data || "";
    console.log(`📦 收到 postback：${data}`);

    const params = new URLSearchParams(data.replace(/\?/g, "&"));
    const action = params.get("action");

    // 1) 選服務：action=choose_service&service=bazi
    if (action === "choose_service") {
      const serviceId = params.get("service") || "chat_line";
      const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

      console.log(`🧭 使用者選擇服務：${serviceId} (${serviceName})`);

      // 服務選好就進入「選日期」，並且讓日期 Flex 帶著 serviceId
      await sendDateCarouselFlex(userId, serviceId);
      return;
    }

    // 2) 選日期：action=choose_date&service=bazi&date=YYYY-MM-DD
    if (action === "choose_date") {
      const serviceId = params.get("service") || "chat_line";
      const date = params.get("date");
      const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

      console.log(`📅 使用者選擇日期：${date}（服務：${serviceName}）`);

      // 日期選好 → 進入「選該日的時段」，也帶著 serviceId
      await sendSlotsFlexForDate(userId, date, serviceId);
      return;
    }

    // 3) 選時段：action=choose_slot&service=bazi&date=YYYY-MM-DD&time=HH:MM-HH:MM
    if (action === "choose_slot") {
      const serviceId = params.get("service") || "chat_line";
      const date = params.get("date");
      const time = params.get("time");
      const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";

      console.log(`✅ 使用者選擇：${serviceName} ${date} ${time}`);

      conversationStates[userId] = {
        stage: "waiting_name",
        data: {
          date,
          timeSlot: time,
          serviceId, // 🔑 這裡開始整條 flow 都有 serviceId
        },
      };

      await pushText(
        userId,
        `已幫你記錄預約項目：${serviceName}\n時段：${date} ${time}\n\n接下來請先輸入你的「姓名」。`
      );
      return;
    }

    // 其他沒處理到的 postback 先原樣回一行
    await pushText(userId, `我有收到你的選擇：${data}`);
    return;
  }

  // ==========================
  // 再處理「文字訊息」
  // ==========================
  if (event.type === "message" && event.message.type === "text") {
    const text = (event.message.text || "").trim();
    console.log(`👤 ${userId} 說：${text}`);

    const state = conversationStates[userId];

    // ---- A. 有對話狀態：走預約流程 ----
    if (state) {
      // A-1 等姓名
      if (state.stage === "waiting_name") {
        state.data.name = text;
        state.stage = "waiting_phone";

        await pushText(
          userId,
          `好的，${text}，已幫你記錄姓名。\n\n接下來請輸入「聯絡電話」。\n如果不方便留電話，也可以輸入「略過」。`
        );
        return;
      }

      // A-2 等電話
      if (state.stage === "waiting_phone") {
        if (text !== "略過") {
          state.data.phone = text;
        } else {
          state.data.phone = "";
        }
        state.stage = "waiting_note";

        await pushText(
          userId,
          `已經記錄聯絡方式。\n\n最後一步，請輸入「備註」（例如想問的重點、特殊情況）。\n如果沒有特別備註，可以輸入「無」。`
        );
        return;
      }

      // A-3 等備註 → 收齊資料 → 寫入預約 → 發通知
      if (state.stage === "waiting_note") {
        state.data.note = text === "無" ? "" : text;

        const bookingBody = {
          serviceId: state.data.serviceId || "chat_line",
          name: state.data.name || "",
          email: "",
          phone: state.data.phone || "",
          lineId: "",
          date: state.data.date,
          timeSlots: [state.data.timeSlot],
          note: state.data.note || "",
          lineUserId: userId,
        };

        const bookings = loadBookings();
        const newBooking = {
          id: Date.now(),
          createdAt: new Date().toISOString(),
          status: "pending",
          ...bookingBody,
        };
        bookings.push(newBooking);
        saveBookings(bookings);

        // 🔔 通知你自己
        notifyNewBooking(newBooking).catch((err) => {
          console.error("[LINE] notifyNewBooking (chat) 發送失敗：", err);
        });
        // 🔔 通知客戶，這裡不再叫 notifyCustomerBooking，避免重複
        //notifyCustomerBooking(newBooking).catch((err) => {
        //  console.error("[LINE] notifyCustomerBooking (chat) 發送失敗：", err);
        //});

        delete conversationStates[userId];

        //const serviceName =
        //  SERVICE_NAME_MAP[bookingBody.serviceId] || bookingBody.serviceId;

        await sendBookingSuccessHero(userId, bookingBody);

        return;
      }
    }

    // ---- B. 沒有對話狀態：關鍵字 & 一般對話 ----
    ///////////////////進入點//////////////////

    // 🔮 小占卜：等待生日輸入階段
    if (state && state.stage === "mini_reading_wait_birth") {
      const parsed = parseMiniBirthInput(text);

      if (!parsed) {
        await pushText(
          userId,
          "看起來格式怪怪的 😅\n" +
            "請用以下任一種格式再試一次：\n" +
            "1) 1992-12-05-0830\n" +
            "2) 1992-12-05-辰時\n" +
            "3) 1992-12-05-辰\n" +
            "如果不想提供時辰，可以輸入：1992-12-05-未知"
        );
        return;
      }

      // 如果最後一段是「未知」，你可以自己解讀成「沒提供時辰」
      if (parsed.timeType === "unknown") {
        await pushText(
          userId,
          "收到，你先只提供生日，這次小占卜會以整體命格為主，不特別看時辰細節。"
        );
      }

      // 呼叫 AI，做小占卜
      try {
        const aiText = await callMiniReadingAI(parsed);

        // 先回一則「你提供的資訊整理」
        let infoLine = `你提供的生日資訊：\n${parsed.date}`;
        if (parsed.timeType === "hm") {
          infoLine += ` ${parsed.time}`;
        } else if (parsed.timeType === "branch") {
          infoLine += ` ${parsed.branch}時（地支時辰）`;
        } else if (parsed.timeType === "unknown") {
          infoLine += `（未提供時辰）`;
        }

        await pushText(userId, infoLine);
        await pushText(userId, aiText);
      } catch (err) {
        console.error("[miniReading] AI 發生錯誤：", err);
        await pushText(
          userId,
          "小占卜目前有點塞車 😅\n你可以稍後再試一次，或是直接跟我說「想預約」做完整命盤。"
        );
      }

      // 結束這一次的小占卜對話
      delete conversationStates[userId];
      return;
    }

    // 「預約」→ 第一步先選服務
    if (text === "預約") {
      await sendServiceSelectFlex(userId);
      return;
    }

    // 🔮 小占卜入口
    if (text === "小占卜") {
      conversationStates[userId] = {
        stage: "mini_reading_wait_birth",
        data: {},
      };

      await pushText(
        userId,
        "小占卜模式啟動 🔮\n" +
          "請用以下格式輸入你的生日與時間（時間可省略）：\n\n" +
          "✅ 只填生日：1992-12-05-未知\n" +
          "✅ 西元＋時分：1992-12-05-0830\n" +
          "✅ 西元＋地支：1992-12-05-辰時 或 1992-12-05-辰\n\n" +
          "如果你不想提供時辰，可以在最後寫「未知」。"
      );
      return;
    }

    // 其他文字，暫時維持 echo
    await pushText(userId, `機器人測試:我有聽到你說：「${text}」`);
    return;
  }

  // 其他事件類型先略過
  console.log("目前尚未處理的事件類型：", event.type);
}

////之後可能會搬到aiClient.js////
// 🔮 小占卜：呼叫 AI 做簡單命格分析
// birthObj 會長這樣：
// {
//   raw: "1992-12-05-0830",
//   date: "1992-12-05",
//   timeType: "hm" | "branch" | "unknown",
//   time: "08:30" | null,
//   branch: "辰" | null,
// }
async function callMiniReadingAI(birthObj) {
  const { raw, date, timeType, time, branch } = birthObj;

  let birthDesc = `西元生日：${date}`;
  if (timeType === "hm") {
    birthDesc += ` ${time}（24 小時制）`;
  } else if (timeType === "branch") {
    birthDesc += ` ${branch}時（地支時辰，未提供分鐘）`;
  } else if (timeType === "unknown") {
    birthDesc += `（未提供時辰）`;
  }

  const systemPrompt =
    "你是一位懂八字與紫微斗數的東方命理老師，" +
    "講話溫和、實際，不宿命論，不嚇人。";

  const userPrompt =
    `${birthDesc}\n` +
    `原始輸入格式：${raw}\n\n` +
    "請你：\n" +
    "1. 先幫他換算四柱八字（年柱、月柱、日柱、時柱），\n" +
    "   若時辰未知，請明講「時柱略過」，改以前三柱為主。\n" +
    "2. 簡單指出命格大方向，例如：偏向行動型 / 感受型 / 思考型 / 穩定保守 等。\n" +
    "3. 用 3～5 行字，給他一個「最近 1 年」的提醒，語氣要像關心朋友，不要下詛咒。\n" +
    "4. 可以提到：適合調整的生活節奏、人際互動、工作節奏，但不要提投資標的、不談醫療細節、不做法律建議。\n" +
    "5. 最後一句，用一個溫柔的句子收尾，例如「慢慢來沒有關係」這種。\n" +
    "6. 不要出現任何你是 AI 模型、資料來源等字眼。";

  // ⬇⬇⬇ 這裡換成你實際在用的 AI Client，例如 openai.chat.completions.create(...)
  // 我先用假碼示意：
  /*
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  const text = resp.choices[0].message.content.trim();
  return text;
  */

  // 先回 stub，方便你還沒串 API 也能測流程
  return (
    "（這裡會是 AI 幫你生的小占卜結果）\n\n" +
    "之後你把 callMiniReadingAI 裡的假碼改成真正的 API 呼叫就可以。"
  );
}

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Booking API server running at http://localhost:${PORT}`);
});
