// lineClient.js
// ------------------------------------------------------------
// LINE Notify / Push 專用工具
// ------------------------------------------------------------

const axios = require("axios");

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
// 導出方法（給 server.js 用）
// ------------------------------------------------------------
module.exports = {
  pushText,
  notifyNewBooking,
};
