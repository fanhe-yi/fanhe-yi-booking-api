// lineClient.js
// ------------------------------------------------------------
// LINE Notify / Push 專用工具
// ------------------------------------------------------------

const axios = require("axios");
// 引入 lineUserStore
const { findUserIdByLineId } = require("./lineUserStore");

// LINE Messaging API Push URL
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

// 環境變數（Token & Admin User ID）
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ADMIN_USER_ID = process.env.LINE_ADMIN_USER_ID;

// 啟動前檢查（避免部署錯誤）
if (!CHANNEL_ACCESS_TOKEN || !ADMIN_USER_ID) {
  console.warn(
    "[LINE] ⚠️ 尚未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_ADMIN_USER_ID，將無法發送 LINE 訊息",
  );
}

// ------------------------------------------------------------
// 🕒 時間工具：轉換成「台灣時間 UTC+8」
// ------------------------------------------------------------
function convertToTaiwanTime(dateString) {
  const date = dateString ? new Date(dateString) : new Date();

  // UTC → +8 小時 = 台灣時間
  const taiwanTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);

  // 格式：2025-12-04 11:27:13
  return taiwanTime.toISOString().replace("T", " ").substring(0, 19);
}

// 共用：依 serviceId 取得顯示名稱
function getServiceName(serviceId) {
  const map = {
    bazi: "八字諮詢",
    ziwei: "紫微斗數",
    name: "改名 / 姓名學",
    liuyao: "六爻占卜",
    fengshui: "風水勘察",
    chat_line: "命理諮詢",
  };
  return map[serviceId] || `命理諮詢（${serviceId || "未指定"}）`;
}

// ------------------------------------------------------------
// 👤 取得使用者暱稱 (Profile)
// ------------------------------------------------------------
async function getUserProfile(userId) {
  if (!CHANNEL_ACCESS_TOKEN) return "未知用戶";

  try {
    // 使用 axios 打 LINE 的 Profile API
    const res = await axios.get(
      `https://api.line.me/v2/bot/profile/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
      },
    );

    return res.data.displayName; // 回傳使用者的 LINE 暱稱
  } catch (err) {
    console.error(
      `[LINE API] 無法取得 userId: ${userId} 的 Profile:`,
      err.response?.data || err.message,
    );
    return "未知用戶"; // 抓不到時的防呆預設值
  }
}

// ------------------------------------------------------------
// 📤 1) 發送純文字訊息
// ------------------------------------------------------------
async function pushText(to, text) {
  if (!CHANNEL_ACCESS_TOKEN) return;

  try {
    await axios.post(
      LINE_PUSH_URL,
      {
        to,
        messages: [
          {
            type: "text",
            text,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
      },
    );

    console.log("[LINE] pushText 發送成功");
  } catch (err) {
    console.error("[LINE] 發送失敗：", err.response?.data || err.message);
  }
}

// ------------------------------------------------------------
// 📤 1-2) 發送 Flex 訊息
// ------------------------------------------------------------
async function pushFlex(to, altText, contents) {
  if (!CHANNEL_ACCESS_TOKEN) return;

  try {
    await axios.post(
      LINE_PUSH_URL,
      {
        to,
        messages: [
          {
            type: "flex",
            altText, // iOS 通知、看不到 Flex 時會顯示這行文字
            contents, // 真正的 Flex JSON
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
      },
    );

    console.log("[LINE] pushFlex 發送成功");
  } catch (err) {
    console.error(
      "[LINE] pushFlex 發送失敗：",
      err.response?.data || err.message,
    );
  }
}

// ------------------------------------------------------------
// 🔔 2) 新預約通知：傳給「管理者（多位）」
// ------------------------------------------------------------
async function notifyNewBooking(booking) {
  // 這裡的檢查依你實際需求為主，若已改用多位管理員，可以拔掉單一 ADMIN_USER_ID 的檢查
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return;

  const {
    serviceId,
    name,
    contact, // 前端組好的備援字串
    email,
    phone,
    lineId,
    date,
    timeSlots,
    timeSlot,
    note,
    createdAt,
    lineUserId, // 🌟 關鍵 1：把 lineUserId 從 booking 中解構出來
  } = booking;

  // 服務名稱（轉中文）
  const serviceName = getServiceName(serviceId);

  // 🌟 關鍵 2：判斷是否有 lineUserId，有才去抓暱稱
  let displayName = "（未提供 LINE 帳號）";
  if (lineUserId) {
    displayName = await getUserProfile(lineUserId);
  }

  // 時段（多選優先）
  let slotText = "未選擇時段";
  if (Array.isArray(timeSlots) && timeSlots.length > 0) {
    slotText = timeSlots.join("、");
  } else if (timeSlot) {
    slotText = timeSlot;
  }

  // 聯絡方式整理
  const contactLines = [];
  if (phone && String(phone).trim())
    contactLines.push(`電話：${String(phone).trim()}`);
  if (lineId && String(lineId).trim())
    contactLines.push(`LINE ID：${String(lineId).trim()}`);
  if (email && String(email).trim())
    contactLines.push(`Email：${String(email).trim()}`);

  if (!contactLines.length && contact && String(contact).trim()) {
    contactLines.push(String(contact).trim());
  }

  const contactBlock =
    contactLines.length > 0
      ? contactLines.map((c) => `· ${c}`).join("\n")
      : "（未填寫）";

  // ------------------------------------------------------------
  // 組 LINE 文字訊息內容
  // ------------------------------------------------------------
  const msg =
    `📣 新預約通知\n` +
    `-----------------\n` +
    `項目：${serviceName}\n` +
    `暱稱：${displayName}\n` + // 🌟 關鍵 3：帶入抓到的暱稱
    `姓名：${name || "（未填寫）"}\n` +
    `日期：${date || "（未填寫）"}\n` +
    `時段：${slotText}\n` +
    `-----------------\n` +
    `聯絡方式：\n${contactBlock}\n` +
    `-----------------\n${note}\n` +
    `-----------------\n` +
    `建立時間：${convertToTaiwanTime(createdAt)}`;

  // ------------------------------------------------------------
  // 準備通知管理者群
  // ------------------------------------------------------------
  const adminStr = process.env.ADMIN_NOTIFY_USER_IDS || "";
  const adminIds = adminStr
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (adminIds.length > 0) {
    for (const adminId of adminIds) {
      try {
        await pushText(adminId, msg);
      } catch (err) {
        console.error(
          `[Helper Notify] 發送新預約通知給管理者 ${adminId} 失敗：`,
          err.message || err,
        );
      }
    }
  }
}

// ------------------------------------------------------------
// 🔔 3) 客戶預約成功通知：傳給「客戶」本人的 LINE
// ------------------------------------------------------------
async function notifyCustomerBooking(booking) {
  if (!CHANNEL_ACCESS_TOKEN) return;
  if (!booking) return;

  const {
    name,
    lineId,
    lineUserId, // 🔴 從 LIFF 帶進來的 userId
    serviceId,
    date,
    timeSlots,
    timeSlot,
  } = booking;

  let userId = null;

  // ✅ 1. 優先使用 LIFF 帶進來的 lineUserId（最精準）
  if (lineUserId && String(lineUserId).trim()) {
    userId = String(lineUserId).trim();
    console.log(`[LINE] 使用 lineUserId 直接推播：${userId}`);
  }
  // ✅ 2. 沒有 lineUserId，退回舊邏輯：用 lineId 去對照
  else if (lineId && String(lineId).trim()) {
    const trimmedLineId = String(lineId).trim();
    console.log(`[LINE] 沒有 lineUserId，改用 lineId 查找：${trimmedLineId}`);

    try {
      userId = findUserIdByLineId(trimmedLineId);
    } catch (err) {
      console.error(
        "[LINE] findUserIdByLineId 發生錯誤：",
        err?.message || err,
      );
      return;
    }

    if (!userId) {
      console.log(
        `[LINE] 找不到 lineId「${trimmedLineId}」對應的 LINE userId，略過客戶通知`,
      );
      return;
    }

    console.log(`[LINE] 使用 lineId 映射到的 userId 推播：${userId}`);
  } else {
    console.log(
      "[LINE] notifyCustomerBooking：沒有 lineUserId 或 lineId，略過客戶通知",
    );
    return;
  }

  // ✅ 下面這段：不管是 lineUserId 還是 lineId 映射，都共用同一份訊息內容
  const serviceName = getServiceName(serviceId);

  let slotText = "未選擇時段";
  if (Array.isArray(timeSlots) && timeSlots.length > 0) {
    slotText = timeSlots.join("、");
  } else if (timeSlot) {
    slotText = timeSlot;
  }

  const msg =
    `您好${name ? `，${name}` : ""}：\n` +
    `我們已收到您的預約。\n\n` +
    `項目：${serviceName}\n` +
    `日期：${date || "（未填寫）"}\n` +
    `時段：${slotText}\n\n` +
    `後續如果時間需要微調，我會再跟你確認。\n` +
    `有臨時狀況也可以直接在這個視窗跟我說。`;

  await pushText(userId, msg);
}
// ------------------------------------------------------------
////客戶預約成功 Hero Flex
// ------------------------------------------------------------
async function sendBookingSuccessHero(userId, booking) {
  const { name, date, timeSlots, serviceId, note, gender, birthRaw } = booking;

  const serviceName = getServiceName(serviceId);
  const finalTime = Array.isArray(timeSlots) ? timeSlots[0] : timeSlots;

  const heroImageUrl = "https://www.chen-yi.tw/images/booking-success-hero.jpg";
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
            /* ✅ 新增：性別 */
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "性別",
                  size: "sm",
                  color: "#aaaaaa",
                },
                {
                  type: "text",
                  text: gender || "（略過）",
                  size: "sm",
                  margin: "lg",
                  wrap: true,
                },
              ],
            },

            /* ✅ 新增：出生（不解析，原文顯示） */
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "出生",
                  size: "sm",
                  color: "#aaaaaa",
                },
                {
                  type: "text",
                  text: birthRaw || "（略過）",
                  size: "sm",
                  margin: "lg",
                  wrap: true,
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
          text: `${note || ""}`,
          size: "sm",
          wrap: true,
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
    /*暫時沒有修改預約的功能
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
    */
  };

  await pushFlex(userId, "預約成功", bubble);
}

// 通用：性別選擇 Flex（給六爻、八字測算共用）
// actionName 例： "liuyao_gender" 或 "minibazi_gender"
async function sendGenderSelectFlex(
  userId,
  { title = "性別選擇", actionName },
) {
  if (!actionName) throw new Error("sendGenderSelectFlex 缺少 actionName");

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
          text: title,
          weight: "bold",
          size: "md",
          color: "#6A4C93",
        },
        {
          type: "text",
          text: "請選擇：",
          size: "sm",
          color: "#555555",
          margin: "sm",
        },
        {
          type: "box",
          layout: "horizontal",
          spacing: "md",
          margin: "md",
          contents: [
            {
              type: "button",
              style: "secondary",
              color: "#d7e8f9ff",
              height: "md",
              flex: 1,
              action: {
                type: "postback",
                label: "男",
                displayText: "男命",
                data: `action=${actionName}&gender=male`,
              },
            },
            {
              type: "button",
              style: "secondary",
              color: "#facbcbff",
              height: "md",
              flex: 1,
              action: {
                type: "postback",
                label: "女",
                displayText: "女命",
                data: `action=${actionName}&gender=female`,
              },
            },
          ],
        },
      ],
    },
  };

  await pushFlex(userId, title, bubble);
}

//八字測算主選單Flex Message（過年喜氣版：梅紫＋玉白＋松綠，避開紅黃搭配）
async function sendBaziMenuFlex(userId) {
  const bubble = {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",

      /* =========================================================
         喜氣底色：用「玉白」當底，比純白更有年節禮盒感
         ========================================================= */
      backgroundColor: "#FFF7F0",

      contents: [
        /* =========================================================
           標題：梅紫＋節慶符號（不走大紅大黃）
           ========================================================= */
        {
          type: "text",
          text: "🧧✨ 梵和易學｜八字測算",
          weight: "bold",
          size: "lg",
          color: "#5B2A86", // 梅紫
        },

        /* =========================================================
           副標：用「墨灰」穩住整體，不會太跳
           ========================================================= */
        {
          type: "text",
          text: "過年前先看看：今年的節奏怎麼走 🙂",
          size: "sm",
          color: "#4B4B4B",
          margin: "sm",
          wrap: true,
        },

        /* =========================================================
           小分隔線：用淡淡的紫灰，像禮盒內襯
           ========================================================= */
        {
          type: "separator",
          margin: "md",
          color: "#E6D9F2",
        },

        /* =========================================================
           按鈕 1：格局（梅紫系）
           - 避開紅黃
           - 文字加「迎福」氛圍
           ========================================================= */
        {
          type: "button",
          style: "primary",
          color: "#6A4C93", // 梅紫
          margin: "md",
          action: {
            type: "postback",
            label: "🎐 看格局・迎福",
            displayText: "🎐 我想看格局分析（迎福一下）",
            data: "action=bazi_mode&mode=pattern",
          },
        },

        /* =========================================================
           按鈕 2：流年（松綠系，像年節盆栽/松柏）
           - 一樣喜氣，但不俗
           - 保留你要的馬年符號
           ========================================================= */
        {
          type: "button",
          style: "primary",
          color: "#C1121F", // 松綠
          margin: "sm",
          action: {
            type: "postback",
            label: "🐴🎊 看流年・走旺運",
            displayText: "🐴🎊 我想看流年分析（走旺運）",
            data: "action=bazi_mode&mode=year",
          },
        },

        /* =========================================================
           角落小提醒（像春聯小字）
           ========================================================= */
        {
          type: "text",
          text: "✨ 小提醒：越早知道節奏，越好把握方向。",
          size: "xs",
          color: "#6B6B6B",
          margin: "md",
          wrap: true,
        },
      ],
    },
  };

  await pushFlex(userId, "八字測算選單", bubble);
}

// 六爻占卜主選單 Flex
async function sendLiuYaoMenuFlex(userId) {
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
          text: "🔮 梵和易學｜六爻占卜",
          weight: "bold",
          size: "md",
          color: "#6A4C93",
        },
        {
          type: "text",
          text: "請先選擇你想占卜的主題：",
          size: "sm",
          color: "#555555",
          margin: "sm",
        },
        { type: "separator" },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "感情",
            displayText: "用六爻占卜感情",
            data: "action=liuyao_topic&topic=love",
          },
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "sm",
          action: {
            type: "postback",
            label: "事業",
            displayText: "用六爻占卜事業",
            data: "action=liuyao_topic&topic=career",
          },
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "sm",
          action: {
            type: "postback",
            label: "財運",
            displayText: "用六爻占卜財運",
            data: "action=liuyao_topic&topic=wealth",
          },
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "sm",
          action: {
            type: "postback",
            label: "健康",
            displayText: "用六爻占卜健康",
            data: "action=liuyao_topic&topic=health",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "六爻占卜主選單", bubble);
}

// 六爻占卜：起卦時間選擇 Flex
async function sendLiuYaoTimeModeFlex(userId) {
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
          text: "六爻起卦時間",
          weight: "bold",
          size: "md",
          color: "#6A4C93",
        },
        {
          type: "text",
          text: "起卦時間代表這個問題真正「扣動」的那一刻。",
          size: "sm",
          color: "#555555",
          wrap: true,
          margin: "sm",
        },
        {
          type: "text",
          text: "你可以直接用現在時間起卦，或輸入你覺得最代表此事的時間點。",
          size: "xs",
          color: "#888888",
          wrap: true,
          margin: "sm",
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "用現在時間起卦",
            displayText: "用現在時間起卦",
            data: "action=liuyao_time_mode&mode=now",
          },
        },
        {
          type: "button",
          style: "secondary",
          margin: "sm",
          action: {
            type: "postback",
            label: "指定時間起卦",
            displayText: "我要指定起卦時間",
            data: "action=liuyao_time_mode&mode=custom",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "選擇六爻起卦時間", bubble);
}

// 🔧 幫八字測算解析 AI 回傳 JSON 的小工具
function extractPureJSON(aiRaw) {
  if (!aiRaw || typeof aiRaw !== "string") return null;

  // 先把 ```json ... ``` 之類的外殼剝掉
  let cleaned = aiRaw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // 再從第一個 { 到最後一個 } 抓出來
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1) {
    console.warn("[extractPureJSON] 找不到大括號範圍");
    return null;
  }

  cleaned = cleaned.substring(first, last + 1);

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn("[extractPureJSON] JSON.parse 失敗：", err.message);
    console.warn("[extractPureJSON] cleaned content:", cleaned);
    return null;
  }
}

// 🔮 八字測算結果 Flex：把 AI_Reading_Text 包成好看的卡片丟給用戶
// lineClient.js
// 依你原本環境：pushFlex / pushText / extractPureJSON 應該都已存在

// lineClient.js

const MB_SECS = [
  { key: "personality", title: "人格特質", cmd: "看人格特質" },
  { key: "social", title: "人際關係", cmd: "看人際關係" },
  { key: "partner", title: "伴侶關係", cmd: "看伴侶關係" },
  { key: "family", title: "家庭互動", cmd: "看家庭互動" },
  { key: "study_work", title: "學業 / 工作", cmd: "看學業工作" },
];

function mbNextKey(key) {
  const i = MB_SECS.findIndex((s) => s.key === key);
  if (i < 0) return MB_SECS[0].key;
  return MB_SECS[Math.min(i + 1, MB_SECS.length - 1)].key;
}

// 一句話總結：若 AI 未提供 one_liner，先用 personality 前 55 字頂著
function mbPick(data) {
  if (data?.one_liner) return String(data.one_liner).trim();
  const base = data?.personality || data?.social || "";
  const s = String(base).replace(/\s+/g, " ").trim();
  if (!s) return "我先抓一個重點：你不是沒能力，你是標準太高，對自己不太客氣。";
  return s.slice(0, 55) + (s.length > 55 ? "…" : "");
}

/**
 * 乾淨版主題卡：header 只留 birthDesc
 * modeLabel 不放 header（你要求的）
 * 文字加大：body 用 md
 */
function mbCard({ birthDesc, secTitle, text, footer }) {
  const safeText =
    String(text || "").trim() ||
    "（這段目前沒有內容。你可以回總覽再選一次，或點下一頁看別的主題。）";

  const bubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: secTitle,
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        {
          type: "text",
          text: birthDesc,
          size: "sm",
          color: "#777777",
          wrap: true,
          margin: "sm",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "separator", margin: "md" },
        { type: "text", text: safeText, size: "md", wrap: true },
      ],
    },
  };

  if (footer) bubble.footer = footer;
  return bubble;
}

/**
 * 四柱/五行輔助頁：點一下才顯示（互動用）
 */
function mbInfoCard({ birthDesc, pillarsText, fiveElementsText }) {
  const bubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "四柱 / 五行資訊", weight: "bold", size: "lg" },
        {
          type: "text",
          text: birthDesc,
          size: "sm",
          color: "#777777",
          wrap: true,
          margin: "sm",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "separator", margin: "md" },
        {
          type: "text",
          text: pillarsText || "（四柱資料缺失）",
          size: "md",
          wrap: true,
        },
        {
          type: "text",
          text: fiveElementsText || "（五行資料缺失）",
          size: "md",
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
          style: "link",
          height: "sm",
          action: { type: "message", label: "⬅ 回總覽", text: "看總覽" },
        },
      ],
    },
  };
  return bubble;
}

// JSON 失敗 fallback（保留）
async function mbFallback(userId, payload, modeLabel) {
  const { birthDesc, aiText } = payload;

  const bubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "梵和易學｜八字測算",
          weight: "bold",
          size: "sm",
          color: "#B89B5E",
        },
        {
          type: "text",
          text: modeLabel || "整體命盤解析",
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
          text: birthDesc,
          size: "sm",
          color: "#666666",
          wrap: true,
        },
        { type: "separator", margin: "md" },
        { type: "text", text: aiText, size: "md", wrap: true },
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
          action: { type: "message", label: "再測一次", text: "八字測算" },
        },
        {
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "message",
            label: "想預約完整論命",
            text: "關於八字/紫微/占卜",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "八字測算結果", bubble);
}

/**
 * ✅ 測算完成：只送「1頁總覽」
 * - 一句話總結
 * - 5 主題按鈕（點了才出主題頁）
 * - 看全部
 * - 預約
 */
async function mbMenu(userId, payload) {
  const { birthDesc, mode, aiText } = payload;

  const data = extractPureJSON(aiText);

  const modeLabelMap = {
    pattern: "格局 / 命盤基調",
    year: "流年運勢",
    month: "流月節奏",
    day: "流日 / 近期提醒",
  };
  const modeLabel = modeLabelMap[mode] || "整體命盤解析";

  if (!data) {
    console.warn("[mbMenu] JSON 解析失敗，fallback 單頁");
    return mbFallback(userId, payload, modeLabel);
  }

  const oneLiner = mbPick(data);

  const menuBubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "八字測算總覽", weight: "bold", size: "lg" },
        {
          type: "text",
          text: birthDesc,
          size: "sm",
          color: "#777777",
          wrap: true,
          margin: "sm",
        },
        {
          type: "separator",
          margin: "md",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        // ===== 一句話總結 =====
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: "一句話總結",
              size: "sm",
              weight: "bold",
              color: "#555555",
            },
            {
              type: "text",
              text: oneLiner,
              size: "md",
              wrap: true,
            },
          ],
        },

        { type: "separator", margin: "md" },

        {
          type: "text",
          text: "你想先看哪個主題？",
          size: "sm",
          weight: "bold",
          color: "#555555",
        },

        // ===== 2×3 選單（box 當按鈕）=====
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            // Row 1
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                menuBox("人格特質", "看人格特質", "#F5EFE6"),
                menuBox("人際關係", "看人際關係", "#F0F4F8"),
              ],
            },

            // Row 2
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                menuBox("伴侶關係", "看伴侶關係", "#F7ECEC"),
                menuBox("家庭互動", "看家庭互動", "#EEF6F0"),
              ],
            },

            // Row 3
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                menuBox("學業／工作", "看學業工作", "#EEF1F8"),
                menuBox("四柱五行", "看四柱五行", "#EFEAF6"),
              ],
            },
          ],
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
          height: "sm",
          action: {
            type: "message",
            label: "我想看全部（一次給）",
            text: "看全部",
          },
        },
        {
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "message",
            label: "想預約完整論命",
            text: "關於八字/紫微/占卜",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "八字測算結果（總覽）", menuBubble);
}

///總覧2x3 button用
function menuBox(label, text, bgColor) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingAll: "md",
    cornerRadius: "12px",
    backgroundColor: bgColor,
    justifyContent: "center",
    alignItems: "center",
    action: {
      type: "message",
      label,
      text,
    },
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

/**
 * 主題頁：只放「下一頁 / 回總覽 / 看四柱五行」
 * - 你要求「每頁底下只要 下一頁 / 回總覽」，但你又要「點一下看四柱五行」
 * - 所以我把「看四柱五行」放在 footer 第 1 顆（互動入口），仍然維持簡潔
 */
async function mbPage(userId, payload, secKey) {
  const { birthDesc, mode, aiText } = payload;

  const data = extractPureJSON(aiText);

  const modeLabelMap = {
    pattern: "格局 / 命盤基調",
    year: "流年運勢",
    month: "流月節奏",
    day: "流日 / 近期提醒",
  };
  const modeLabel = modeLabelMap[mode] || "整體命盤解析";

  if (!data) {
    console.warn("[mbPage] JSON 解析失敗，fallback");
    return mbFallback(userId, payload, modeLabel);
  }

  const sec = MB_SECS.find((s) => s.key === secKey) || MB_SECS[0];
  const nextKey = mbNextKey(sec.key);
  const nextSec = MB_SECS.find((s) => s.key === nextKey);

  const footer = {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      {
        type: "button",
        style: "secondary",
        height: "sm",
        action: {
          type: "message",
          label: `➡ 下一頁${nextSec ? `（${nextSec.title}）` : ""}`,
          text: nextSec?.cmd || "下一頁",
        },
      },
      {
        type: "button",
        style: "link",
        height: "sm",
        action: { type: "message", label: "⬅ 回總覽", text: "看總覽" },
      },
    ],
  };

  const bubble = mbCard({
    birthDesc,
    secTitle: sec.title,
    text: String(data[sec.key] || "").trim(),
    footer,
  });

  await pushFlex(userId, `八字測算｜${sec.title}`, bubble);
}

/**
 * 四柱五行輔助頁
 */
async function mbInfo(userId, payload) {
  const { birthDesc, pillarsText, fiveElementsText } = payload;
  const bubble = mbInfoCard({ birthDesc, pillarsText, fiveElementsText });
  await pushFlex(userId, "四柱 / 五行", bubble);
}

/**
 * 看全部：一次丟 5 頁 carousel（不放 footer CTA）
 */
async function mbAll(userId, payload) {
  const { birthDesc, mode, aiText } = payload;

  const data = extractPureJSON(aiText);

  const modeLabelMap = {
    pattern: "格局 / 命盤基調",
    year: "流年運勢",
    month: "流月節奏",
    day: "流日 / 近期提醒",
  };
  const modeLabel = modeLabelMap[mode] || "整體命盤解析";

  if (!data) {
    console.warn("[mbAll] JSON 解析失敗，fallback");
    return mbFallback(userId, payload, modeLabel);
  }

  const bubbles = MB_SECS.filter((s) => data[s.key]).map((s) =>
    mbCard({
      birthDesc,
      secTitle: s.title,
      text: String(data[s.key] || "").trim(),
      footer: null,
    }),
  );

  const flexPayload =
    bubbles.length <= 1 ? bubbles[0] : { type: "carousel", contents: bubbles };
  await pushFlex(userId, "八字測算結果（全部）", flexPayload);
}

/**
 * ✅ 兼容：server.js 仍呼叫 sendMiniBaziResultFlex
 * 現在它等於 mbMenu（只送 1 頁總覽）
 */
async function sendMiniBaziResultFlex(userId, payload) {
  return mbMenu(userId, payload);
}

// 圖片 push（沿用 pushFlex 同一套 axios + LINE_PUSH_URL）
async function pushImage(to, originalContentUrl, previewImageUrl) {
  if (!CHANNEL_ACCESS_TOKEN) return;

  // LINE image 必填兩個網址，且必須 https
  if (!originalContentUrl || !previewImageUrl) {
    console.warn("[LINE] pushImage 缺少圖片網址，略過");
    return;
  }

  try {
    await axios.post(
      LINE_PUSH_URL,
      {
        to,
        messages: [
          {
            type: "image",
            originalContentUrl,
            previewImageUrl,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
      },
    );

    console.log("[LINE] pushImage 發送成功");
  } catch (err) {
    console.error(
      "[LINE] pushImage 發送失敗：",
      err.response?.data || err.message,
    );
  }
}

//    八字合婚測算結果
async function sendBaziMatchResultFlex(userId, payload) {
  const {
    aiText,
    matchDisplayText, // 目前沒顯示在 header，但先保留
    malePillars,
    femalePillars,

    // 新的「人話時間」欄位（優先用這個）
    maleBirthDisplay,
    femaleBirthDisplay,

    // 舊的 raw 欄位（當備用 / debug 用）
    maleBirthRaw,
    femaleBirthRaw,

    // ✅ 新增：是否為分享鎖定（首免預覽）
    shareLock = false,
  } = payload;

  const data = extractPureJSON(aiText);

  // 如果 JSON 爆掉，就直接回純文字
  if (!data || typeof data !== "object" || typeof data.score === "undefined") {
    const fallbackText =
      "【八字合婚結果】\n\n" +
      (typeof aiText === "string" && aiText.trim()
        ? aiText
        : "系統目前無法解析合婚結果，之後可以改成由老師手動說明。");

    await pushText(userId, fallbackText);
    return;
  }

  const score = data.score;
  const summary = String(data.summary || "").trim();
  const strengths = Array.isArray(data.strengths) ? data.strengths : [];
  const challenges = Array.isArray(data.challenges) ? data.challenges : [];
  const advice = String(data.advice || "").trim();

  // 🔹 真正要顯示在 header 上的「人話時間」
  const maleDisplay = maleBirthDisplay || maleBirthRaw || "未提供";
  const femaleDisplay = femaleBirthDisplay || femaleBirthRaw || "未提供";

  // ✅ 分享文字（你可改成自己的話）
  const shareText =
    "我剛用「梵和易學」做了八字合婚的小測驗，還蠻準的，你也一起來玩看看！👇\n" +
    "https://line.me/R/ti/p/@415kfyus";

  // LINE 分享
  //const shareUri = `https://line.me/R/msg/text/?${encodeURIComponent(
  //  shareText
  //)}`;

  // ✅ Threads 分享
  const shareUri = `https://liff.line.me/${
    process.env.LIFF_ID_SHARE
  }?text=${encodeURIComponent(shareText)}`;

  const flexPayload = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "梵和易學｜八字合婚",
          weight: "bold",
          size: "sm",
          color: "#B89B5E",
        },
        {
          type: "text",
          text: `合婚分數：${score} 分`,
          weight: "bold",
          size: "xl",
          margin: "md",
        },
        {
          type: "text",
          text: `男方：${maleDisplay}`,
          size: "xs",
          color: "#777777",
          margin: "md",
          wrap: true,
        },
        {
          type: "text",
          text: `女方：${femaleDisplay}`,
          size: "xs",
          color: "#777777",
          wrap: true,
        },
        {
          type: "text",
          text: shareLock
            ? "＊首次免費為預覽版：分享後可解鎖完整版＊"
            : "＊本合婚結果僅供參考，不做命定論＊",
          size: "xxs",
          color: "#999999",
          margin: "md",
          wrap: true,
        },
        // matchDisplayText 目前先不顯示，保留即可
      ],
    },

    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        // ---------- 整體總評 ----------
        {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "整體總評", weight: "bold", size: "sm" },
            {
              type: "text",
              text: summary,
              size: "xs",
              wrap: true,
              margin: "sm",
            },
          ],
        },

        // ---------- 優點 / 相處亮點 ----------
        ...(strengths.length
          ? [
              {
                type: "box",
                layout: "vertical",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "優點 / 相處亮點",
                    weight: "bold",
                    size: "sm",
                  },
                  ...strengths.map((s) => ({
                    type: "text",
                    text: `• ${s}`,
                    size: "xs",
                    wrap: true,
                    margin: "sm",
                  })),
                ],
              },
            ]
          : []),

        // ✅ shareLock：遮住 challenges + advice
        ...(shareLock
          ? [
              {
                type: "box",
                layout: "vertical",
                margin: "md",
                contents: [
                  { type: "separator", margin: "sm" },
                  {
                    type: "text",
                    text: "🔒 下面還有「更關鍵的磨合點」與「具體經營策略」，完成分享後即可解鎖完整版。",
                    size: "xs",
                    color: "#666666",
                    wrap: true,
                    margin: "md",
                  },
                ],
              },
            ]
          : [
              ...(challenges.length
                ? [
                    {
                      type: "box",
                      layout: "vertical",
                      margin: "md",
                      contents: [
                        {
                          type: "text",
                          text: "潛在磨合點",
                          weight: "bold",
                          size: "sm",
                        },
                        ...challenges.map((c) => ({
                          type: "text",
                          text: `• ${c}`,
                          size: "xs",
                          wrap: true,
                          margin: "sm",
                        })),
                      ],
                    },
                  ]
                : []),
              {
                type: "box",
                layout: "vertical",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "經營建議",
                    weight: "bold",
                    size: "sm",
                  },
                  {
                    type: "text",
                    text: advice,
                    size: "xs",
                    wrap: true,
                    margin: "sm",
                  },
                ],
              },
            ]),
      ],
    },

    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: shareLock
        ? [
            {
              type: "button",
              style: "primary",
              action: {
                type: "uri",
                label: "分享到Threads解鎖",
                uri: shareUri,
              },
            },
            {
              type: "button",
              style: "secondary",
              action: {
                type: "postback",
                label: "我已分享",
                data: "action=bazimatch_unlock",
              },
            },
            /*{
              type: "button",
              style: "link",
              action: {
                type: "message",
                label: "想預約完整合婚諮詢",
                text: "預約",
              },
            },*/
          ]
        : [
            {
              type: "button",
              style: "primary",
              action: {
                type: "message",
                label: "想預約完整合婚諮詢",
                text: "預約諮詢",
              },
            },
          ],
    },
  };

  await pushFlex(userId, "八字合婚結果", flexPayload);

  // ✅ 只有「最終版」才推圖片（預覽 shareLock 不推）
  if (!shareLock) {
    await pushImage(
      userId,
      "https://chen-yi.tw/bazimatch/bazimatch-scores.jpg",
      "https://chen-yi.tw/bazimatch/bazimatch-scores.jpg",
    );
  }
}

/* ==========================================================
✅ 奇門時空靈籤 Flex Message (修正版)
🔴 修正：移除不支援的 letterSpacing 屬性
========================================================= */
async function sendQimenResultFlex(userId, userNumber, question, aiData) {
  // 防呆：如果 AI 沒回傳好的 JSON，給預設值
  const spirit = aiData?.spirit_analysis || "氣場運轉中...";
  const conclusion = aiData?.main_conclusion || "正在解析天機...";
  const poem = aiData?.lucky_poem || "心誠則靈，靜待花開。";
  const suggestions = Array.isArray(aiData?.suggestions)
    ? aiData.suggestions
    : [];

  // 組合成建議清單文字
  const suggestionsText = suggestions.map((s, i) => `• ${s}`).join("\n");

  const bubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#2B2338", // 神秘紫黑底色
      paddingAll: "xl",
      contents: [
        {
          type: "text",
          text: "時空靈籤",
          color: "#D4AF37", // 金色文字
          size: "md", // 改大一點比較好看
          weight: "bold",
          align: "center",
          // 🔴 已移除 letterSpacing
        },
        {
          type: "text",
          text: userNumber || "888888", // 顯示觸機靈數
          color: "#FFFFFF",
          size: "3xl",
          weight: "bold",
          align: "center",
          margin: "md",
          // 🔴 已移除 letterSpacing
        },
        {
          type: "text",
          text: "━━━━━━━━",
          color: "#665C70",
          size: "xs",
          align: "center",
          margin: "sm",
        },
        {
          type: "text",
          text: poem, // 籤詩
          color: "#FFD700", // 亮金
          size: "md",
          weight: "bold",
          align: "center",
          margin: "md",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "lg",
      spacing: "md",
      contents: [
        /* 1. 用戶問題與靈數解析 */
        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#F7F8FA",
          cornerRadius: "md",
          paddingAll: "md",
          contents: [
            {
              type: "text",
              text: "💡 靈數氣場",
              size: "sm",
              weight: "bold",
              color: "#555555",
            },
            {
              type: "text",
              text: spirit,
              size: "sm",
              color: "#666666",
              wrap: true,
              margin: "sm",
            },
          ],
        },
        /* 2. 核心解析 */
        {
          type: "text",
          text: "🔮 盤面指引",
          weight: "bold",
          size: "md",
          color: "#333333",
          margin: "md",
        },
        {
          type: "text",
          text: conclusion,
          size: "sm",
          color: "#444444",
          wrap: true,
          lineSpacing: "4px", // lineSpacing 是支援的，保留
        },
        /* 3. 建議 (如果有) */
        ...(suggestionsText
          ? [
              {
                type: "separator",
                margin: "lg",
                color: "#EEEEEE",
              },
              {
                type: "text",
                text: "✍️ 行動建議",
                weight: "bold",
                size: "sm",
                color: "#333333",
                margin: "md",
              },
              {
                type: "text",
                text: suggestionsText,
                size: "sm",
                color: "#555555",
                wrap: true,
                margin: "sm",
                lineSpacing: "4px",
              },
            ]
          : []),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        /* {
          type: "button",
          style: "primary",
          color: "#2B2338",
          action: {
            type: "uri",
            label: "分享好運",
            uri: `https://line.me/R/msg/text/?${encodeURIComponent("我剛剛抽到了一時空靈籤，還蠻準的！\n你也來試試：https://line.me/R/ti/p/@415kfyus")}`,
          },
        }, */
        {
          type: "button",
          style: "primary",
          color: "#2B2338",
          action: {
            type: "message",
            label: "預約諮詢",
            text: "預約諮詢",
          },
        },
        {
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "message",
            label: "再問一題",
            text: "時空占卜",
          },
        },
      ],
    },
  };

  await pushFlex(userId, `【靈籤】${poem}`, bubble);
}

// ------------------------------------------------------------
// 導出方法（給 server.js 用）
// ------------------------------------------------------------
module.exports = {
  pushText,
  pushFlex,
  notifyNewBooking,
  notifyCustomerBooking,
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
  sendQimenResultFlex,
  getUserProfile,
};
