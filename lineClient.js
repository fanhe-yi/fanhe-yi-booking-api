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
  const serviceNameMap = {
    bazi: "八字諮詢",
    ziwei: "紫微斗數",
    name: "改名 / 姓名學",
    fengshui: "風水勘察",
  };

  const serviceName =
    serviceNameMap[serviceId] || `其他服務 (${serviceId || "未填寫"})`;

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
  const serviceNameMap = {
    bazi: "八字諮詢",
    ziwei: "紫微斗數",
    name: "改名 / 姓名學",
    fengshui: "風水勘察",
  };

  const serviceName =
    serviceNameMap[serviceId] || `命理諮詢（${serviceId || "未指定"}）`;

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
// 導出方法（給 server.js 用）
// ------------------------------------------------------------
module.exports = {
  pushText,
  pushFlex,
  notifyNewBooking,
  notifyCustomerBooking,
};
