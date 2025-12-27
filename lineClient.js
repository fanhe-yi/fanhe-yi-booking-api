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
    "[LINE] ⚠️ 尚未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_ADMIN_USER_ID，將無法發送 LINE 訊息"
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
    fengshui: "風水勘察",
    chat_line: "命理諮詢",
  };
  return map[serviceId] || `命理諮詢（${serviceId || "未指定"}）`;
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
      }
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
      }
    );

    console.log("[LINE] pushFlex 發送成功");
  } catch (err) {
    console.error(
      "[LINE] pushFlex 發送失敗：",
      err.response?.data || err.message
    );
  }
}

// ------------------------------------------------------------
// 🔔 2) 新預約通知：傳給「管理者（=你自己）」
// ------------------------------------------------------------
async function notifyNewBooking(booking) {
  if (!CHANNEL_ACCESS_TOKEN || !ADMIN_USER_ID) return;

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
  } = booking;

  // 服務名稱（轉中文）
  const serviceName = getServiceName(serviceId);

  // 時段（多選優先）
  let slotText = "未選擇時段";
  if (Array.isArray(timeSlots) && timeSlots.length > 0) {
    slotText = timeSlots.join("、");
  } else if (timeSlot) {
    slotText = timeSlot;
  }

  // 聯絡方式整理
  const contactLines = [];

  if (phone && String(phone).trim()) {
    contactLines.push(`電話：${String(phone).trim()}`);
  }
  if (lineId && String(lineId).trim()) {
    contactLines.push(`LINE ID：${String(lineId).trim()}`);
  }
  if (email && String(email).trim()) {
    contactLines.push(`Email：${String(email).trim()}`);
  }

  // 若 email/phone/lineId 都沒填，但有 contact，就使用 contact
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
    `姓名：${name || "（未填寫）"}\n` +
    `日期：${date || "（未填寫）"}\n` +
    `時段：${slotText}\n` +
    `-----------------\n` +
    `聯絡方式：\n${contactBlock}\n` +
    (note ? `-----------------\n備註：${note}\n` : "") +
    `-----------------\n` +
    `建立時間：${convertToTaiwanTime(createdAt)}`;

  // 發送
  await pushText(ADMIN_USER_ID, msg);
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
        err?.message || err
      );
      return;
    }

    if (!userId) {
      console.log(
        `[LINE] 找不到 lineId「${trimmedLineId}」對應的 LINE userId，略過客戶通知`
      );
      return;
    }

    console.log(`[LINE] 使用 lineId 映射到的 userId 推播：${userId}`);
  } else {
    console.log(
      "[LINE] notifyCustomerBooking：沒有 lineUserId 或 lineId，略過客戶通知"
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
  const { name, date, timeSlots, serviceId } = booking;

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

//八字測算主選單Flex Message
async function sendBaziMenuFlex(userId) {
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
          text: "🔮 梵和易學｜八字測算",
          weight: "bold",
          size: "md",
          color: "#6A4C93",
        },
        {
          type: "text",
          text: "請選擇你想進行的測算類型：",
          size: "sm",
          color: "#555555",
          margin: "sm",
        },

        // 4 個按鈕
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "md",
          action: {
            type: "postback",
            label: "格局分析",
            displayText: "想看格局分析",
            data: "action=bazi_mode&mode=pattern",
          },
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "sm",
          action: {
            type: "postback",
            label: "流年分析",
            displayText: "想看流年分析",
            data: "action=bazi_mode&mode=year",
          },
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "sm",
          action: {
            type: "postback",
            label: "流月占卜",
            displayText: "想看流月占卜",
            data: "action=bazi_mode&mode=month",
          },
        },
        {
          type: "button",
          style: "primary",
          color: "#8E6CEF",
          margin: "sm",
          action: {
            type: "postback",
            label: "流日占卜",
            displayText: "想看流日占卜",
            data: "action=bazi_mode&mode=day",
          },
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

const MB_SECS = [
  { key: "personality", title: "人格特質" },
  { key: "social", title: "人際關係" },
  { key: "partner", title: "伴侶關係" },
  { key: "family", title: "家庭互動" },
  { key: "study_work", title: "學業 / 工作" },
];

function mbNext(key) {
  const i = MB_SECS.findIndex((s) => s.key === key);
  if (i < 0) return MB_SECS[0].key;
  return MB_SECS[Math.min(i + 1, MB_SECS.length - 1)].key;
}

// 一句話總結：若 AI 未提供 one_liner，先用 personality 前 55 字頂著（可跑就好）
function mbPick(data) {
  if (data?.one_liner) return String(data.one_liner).trim();

  const base = data?.personality || data?.social || "";
  const s = String(base).replace(/\s+/g, " ").trim();
  if (!s) return "我先抓一個重點：你不是沒能力，你是標準太高，對自己不太客氣。";
  return s.slice(0, 55) + (s.length > 55 ? "…" : "");
}

function mbCard({
  modeLabel,
  secTitle,
  birthDesc,
  pillarsText,
  fiveElementsText,
  text,
  footer,
}) {
  // 小防呆：避免空字串造成 bubble 看起來像壞掉
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
          text: "梵和易學｜八字測算",
          weight: "bold",
          size: "sm",
          color: "#B89B5E",
        },
        {
          type: "text",
          text: modeLabel,
          weight: "bold",
          size: "md",
          margin: "sm",
        },
        {
          type: "text",
          text: secTitle,
          size: "sm",
          color: "#555555",
          margin: "sm",
        },
        // header 資訊建議別塞太多，但你目前想保留也 OK
        {
          type: "text",
          text: birthDesc,
          size: "xs",
          color: "#777777",
          wrap: true,
          margin: "sm",
        },
        {
          type: "text",
          text: pillarsText,
          size: "xs",
          color: "#777777",
          wrap: true,
        },
        {
          type: "text",
          text: fiveElementsText,
          size: "xs",
          color: "#777777",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      contents: [
        { type: "separator", margin: "md" },
        { type: "text", text: safeText, size: "sm", wrap: true },
      ],
    },
  };

  if (footer) bubble.footer = footer;
  return bubble;
}

/**
 * mbMenu：送「總覽 + 1 張重點」(2頁 carousel)
 * - 第一頁：一句總結 + 主題按鈕 + 看全部 + 預約
 * - 第二頁：人格特質（重點頁，不放下一頁，避免混焦）
 */
async function mbMenu(userId, payload) {
  const { birthDesc, mode, aiText, pillarsText, fiveElementsText } = payload;

  const data = extractPureJSON(aiText);

  const modeLabelMap = {
    pattern: "格局 / 命盤基調",
    year: "流年運勢",
    month: "流月節奏",
    day: "流日 / 近期提醒",
  };
  const modeLabel = modeLabelMap[mode] || "整體命盤解析";

  // 解析失敗 → fallback 單頁（你原本行為）
  if (!data) {
    console.warn("[mbMenu] JSON 解析失敗，fallback 單頁");
    return mbFallback(userId, payload, modeLabel);
  }

  const oneLiner = mbPick(data);

  // 1) 總覽頁
  const menuBubble = {
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
          text: modeLabel,
          weight: "bold",
          size: "md",
          margin: "sm",
        },
        {
          type: "text",
          text: birthDesc,
          size: "xs",
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
            { type: "text", text: oneLiner, size: "sm", wrap: true },
          ],
        },
        { type: "separator", margin: "md" },
        {
          type: "text",
          text: "你最在意哪塊？先點你想看的。",
          size: "sm",
          weight: "bold",
          color: "#555555",
        },
        ...MB_SECS.map((s) => ({
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "message", label: s.title, text: `MB|sec|${s.key}` },
        })),
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
            text: "MB|all",
          },
        },
        {
          type: "button",
          style: "link",
          height: "sm",
          action: { type: "message", label: "想預約完整論命", text: "預約" },
        },
      ],
    },
  };

  // 2) 重點頁：人格特質（不放下一頁）
  const focusBubble = mbCard({
    modeLabel,
    secTitle: "人格特質",
    birthDesc,
    pillarsText,
    fiveElementsText,
    text: String(data.personality || "").trim(),
    footer: null,
  });

  const flexPayload = { type: "carousel", contents: [menuBubble, focusBubble] };
  await pushFlex(userId, "八字測算結果", flexPayload);
}

// 你原本的 fallback（單頁純文字），我改名叫 mbFallback
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
          text: modeLabel,
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
          size: "xs",
          color: "#666666",
          wrap: true,
        },
        { type: "separator", margin: "md" },
        { type: "text", text: aiText, size: "sm", wrap: true },
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
          action: { type: "message", label: "想預約完整論命", text: "預約" },
        },
      ],
    },
  };

  await pushFlex(userId, "八字測算結果", bubble);
}

/**
 * mbPage：送單一主題頁（含 下一頁 / 回總覽）
 * 注意：預約不放這裡（依你需求，只放在第一則 menu）
 */
async function mbPage(userId, payload, secKey) {
  const { birthDesc, mode, aiText, pillarsText, fiveElementsText } = payload;

  const data = extractPureJSON(aiText);

  const modeLabelMap = {
    pattern: "格局 / 命盤基調",
    year: "流年運勢",
    month: "流月節奏",
    day: "流日 / 近期提醒",
  };
  const modeLabel = modeLabelMap[mode] || "整體命盤解析";

  if (!data) {
    console.warn("[mbPage] JSON 解析失敗，改回 mbMenu fallback");
    return mbFallback(userId, payload, modeLabel);
  }

  const sec = MB_SECS.find((s) => s.key === secKey) || MB_SECS[0];
  const nextKey = mbNext(sec.key);

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
          label: "➡ 下一頁",
          text: `MB|sec|${nextKey}`,
        },
      },
      {
        type: "button",
        style: "link",
        height: "sm",
        action: { type: "message", label: "⬅ 回總覽", text: "MB|menu" },
      },
    ],
  };

  const bubble = mbCard({
    modeLabel,
    secTitle: sec.title,
    birthDesc,
    pillarsText,
    fiveElementsText,
    text: String(data[sec.key] || "").trim(),
    footer,
  });

  await pushFlex(userId, `八字測算｜${sec.title}`, bubble);
}

/**
 * mbAll：一次送 5 頁 carousel（你原本的行為）
 * 我把你的原 sendMiniBaziResultFlex 的「5頁 carousel」搬到這裡（改名 mbAll）
 */
async function mbAll(userId, payload) {
  const { birthDesc, mode, aiText, pillarsText, fiveElementsText } = payload;

  const data = extractPureJSON(aiText);

  const modeLabelMap = {
    pattern: "格局 / 命盤基調",
    year: "流年運勢",
    month: "流月節奏",
    day: "流日 / 近期提醒",
  };
  const modeLabel = modeLabelMap[mode] || "整體命盤解析";

  if (!data) {
    console.warn("[mbAll] JSON 解析失敗，fallback 單頁");
    return mbFallback(userId, payload, modeLabel);
  }

  // 產 5 頁 bubble（不放 footer CTA，避免每頁都在叫人按）
  const bubbles = MB_SECS.filter((s) => data[s.key]).map((s) =>
    mbCard({
      modeLabel,
      secTitle: s.title,
      birthDesc,
      pillarsText,
      fiveElementsText,
      text: String(data[s.key] || "").trim(),
      footer: null,
    })
  );

  const flexPayload =
    bubbles.length <= 1 ? bubbles[0] : { type: "carousel", contents: bubbles };

  await pushFlex(userId, "八字測算結果（全部）", flexPayload);
}

/**
 * ✅ 兼容：你的 server.js 目前呼叫的是 sendMiniBaziResultFlex
 * 我保留這個名字，但它現在做的是 mbMenu（總覽 + 1 張重點）
 */
async function sendMiniBaziResultFlex(userId, payload) {
  return mbMenu(userId, payload);
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
  const maleDisplay = maleBirthDisplay || maleBirthRaw || "未提供"; // 有 display 用 display，沒有就退回 raw
  const femaleDisplay = femaleBirthDisplay || femaleBirthRaw || "未提供";

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
          text: `男方：${maleDisplay}`, // ✅ 人話時間（或至少是原始字串）
          size: "xs",
          color: "#777777",
          margin: "md",
          wrap: true,
        },
        {
          type: "text",
          text: `女方：${femaleDisplay}`, // ✅ 人話時間（或至少是原始字串）
          size: "xs",
          color: "#777777",
          wrap: true,
        },
        {
          type: "text",
          text: "＊本合婚結果僅供參考，不做命定論＊",
          size: "xxs",
          color: "#999999",
          margin: "md",
          wrap: true,
        },
        // 如果之後你想多一行描述可以再打開這段
        // {
        //   type: "text",
        //   text: matchDisplayText || "",
        //   size: "xs",
        //   color: "#777777",
        //   wrap: true,
        //   margin: "md",
        // },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
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
          action: {
            type: "message",
            label: "想預約完整合婚諮詢",
            text: "預約",
          },
        },
      ],
    },
  };

  await pushFlex(userId, "八字合婚結果", flexPayload);
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
  mbMenu,
  mbPage,
  mbAll,
  sendBaziMatchResultFlex,
  sendLiuYaoMenuFlex,
  sendLiuYaoTimeModeFlex,
};
