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

        notifyNewBooking(newBooking).catch((err) => {
          console.error("[LINE] notifyNewBooking (chat) 發送失敗：", err);
        });

        notifyCustomerBooking(newBooking).catch((err) => {
          console.error("[LINE] notifyCustomerBooking (chat) 發送失敗：", err);
        });

        delete conversationStates[userId];

        const serviceName =
          SERVICE_NAME_MAP[bookingBody.serviceId] || bookingBody.serviceId;

        await sendBookingSuccessHero(userId, bookingBody);

        return;
      }
    }

    // ---- B. 沒有對話狀態：關鍵字 & 一般對話 ----

    // 「預約」→ 第一步先選服務
    if (text === "預約") {
      await sendServiceSelectFlex(userId);
      return;
    }

    // 其他文字，暫時維持 echo
    await pushText(userId, `機器人測試:我有聽到你說：「${text}」`);
    return;
  }

  // 其他事件類型先略過
  console.log("目前尚未處理的事件類型：", event.type);
}

async function sendBookingSuccessHero(userId, booking) {
  const { name, date, timeSlots, serviceId } = booking;

  const serviceName = SERVICE_NAME_MAP[serviceId] || "命理諮詢";
  const finalTime = Array.isArray(timeSlots) ? timeSlots[0] : timeSlots;

  const heroImageUrl = "https://i.imgur.com/Y0Qy7pC.png";
  // 🔥 你可以換成自己的品牌圖（1080x607 效果最好）

  const bubble = {
    type: "bubble",
    size: "mega",
    hero: {
      type: "image",
      url: heroImageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "預約已完成 🎉",
          weight: "bold",
          size: "xl",
          margin: "md",
        },
        {
          type: "text",
          text: `${serviceName}`,
          weight: "bold",
          size: "lg",
          color: "#8B6F47",
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "box",
          layout: "vertical",
          margin: "md",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "日期",
                  size: "sm",
                  color: "#aaaaaa",
                },
                {
                  type: "text",
                  text: date,
                  size: "sm",
                  margin: "lg",
                },
              ],
            },
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "時段",
                  size: "sm",
                  color: "#aaaaaa",
                },
                {
                  type: "text",
                  text: finalTime,
                  size: "sm",
                  margin: "lg",
                },
              ],
            },
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "預約人",
                  size: "sm",
                  color: "#aaaaaa",
                },
                {
                  type: "text",
                  text: name || "（無填寫）",
                  size: "sm",
                  margin: "lg",
                },
              ],
            },
          ],
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "text",
          text: "我會再跟你確認細節，若臨時需調整，也可以隨時在這裡跟我說 👇",
          size: "sm",
          wrap: true,
          margin: "md",
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
          color: "#8B6F47",
          action: {
            type: "message",
            label: "修改預約",
            text: "我想修改預約",
          },
        },
        {
          type: "button",
          style: "secondary",
          action: {
            type: "message",
            label: "查看其他服務",
            text: "服務項目",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "預約成功", bubble);
}

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Booking API server running at http://localhost:${PORT}`);
});
