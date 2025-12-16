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
async function sendMiniBaziResultFlex(userId, payload) {
  const { birthDesc, mode, aiText, pillarsText, fiveElementsText } = payload;

  // 1) 嘗試把 AI 回傳文字轉成結構化 JSON
  const data = extractPureJSON(aiText);

  // 測算模式的標題（放在 header 第二行）
  const modeLabelMap = {
    pattern: "格局 / 命盤基調",
    year: "流年運勢",
    month: "流月節奏",
    day: "流日 / 近期提醒",
  };
  const modeLabel = modeLabelMap[mode] || "整體命盤解析";

  // 如果 JSON 解析失敗，就用舊版單頁 fallback
  if (!data) {
    console.warn(
      "[sendMiniBaziResultFlex] 無法解析 JSON，改用純文字單頁 bubble。"
    );

    const fallbackBubble = {
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
          {
            type: "separator",
            margin: "md",
          },
          {
            type: "text",
            text: aiText,
            size: "sm",
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
            style: "secondary",
            height: "sm",
            action: {
              type: "message",
              label: "再測一次",
              text: "八字測算",
            },
          },
          {
            type: "button",
            style: "link",
            height: "sm",
            action: {
              type: "message",
              label: "想預約完整論命",
              text: "預約",
            },
          },
        ],
      },
    };

    await pushFlex(userId, "八字測算結果", fallbackBubble);
    return;
  }

  // 2) 定義五個欄位：key + 中文標題
  const sections = [
    { key: "personality", title: "人格特質" },
    { key: "social", title: "人際關係" },
    { key: "partner", title: "伴侶關係" },
    { key: "family", title: "家庭互動" },
    { key: "study_work", title: "學業 / 工作" },
  ];

  // 3) 把每一欄做成一個 bubble
  const bubbles = sections
    .filter((sec) => data[sec.key]) // 只拿有內容的欄位
    .map((sec, index) => {
      const text = String(data[sec.key] || "").trim();

      // 先算出「這是最後一頁嗎」
      const lastIndex = sections.length - 1;

      // 先組共用的 bubble 結構
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
              text: sec.title,
              size: "sm",
              color: "#555555",
              margin: "sm",
            },
            {
              type: "text",
              text: birthDesc,
              size: "xs",
              color: "#777777",
              wrap: true,
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
            {
              type: "separator",
              margin: "md",
            },
            {
              type: "text",
              text,
              size: "sm",
              wrap: true,
            },
          ],
        },
      };

      // 只有「最後一頁」加 footer CTA
      if (index === lastIndex) {
        bubble.footer = {
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
                label: "再測一次",
                text: "八字測算",
              },
            },
            {
              type: "button",
              style: "link",
              height: "sm",
              action: {
                type: "message",
                label: "想預約完整論命",
                text: "預約",
              },
            },
          ],
        };
      }

      return bubble;
    });

  // 理論上會有 5 頁，但保險處理一下極端情況
  let flexPayload;
  if (bubbles.length === 1) {
    flexPayload = bubbles[0];
  } else {
    flexPayload = {
      type: "carousel",
      contents: bubbles,
    };
  }

  await pushFlex(userId, "八字測算結果", flexPayload);
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
};
