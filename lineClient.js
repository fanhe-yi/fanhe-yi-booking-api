// lineClient.js
const axios = require("axios");

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ADMIN_USER_ID = process.env.LINE_ADMIN_USER_ID;

if (!CHANNEL_ACCESS_TOKEN || !ADMIN_USER_ID) {
  console.warn(
    "[LINE] ⚠️ 尚未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_ADMIN_USER_ID，將無法發送 LINE 訊息"
  );
}

// 發送純文字
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

// 專門給「新預約」用的通知
async function notifyNewBooking(booking) {
  if (!CHANNEL_ACCESS_TOKEN || !ADMIN_USER_ID) return;

  const {
    serviceId,
    name,
    contact,
    date,
    timeSlots,
    timeSlot,
    note,
    createdAt,
  } = booking;

  // 服務名稱轉人話
  const serviceNameMap = {
    bazi: "八字諮詢",
    ziwei: "紫微斗數",
    name: "改名 / 姓名學",
    fengshui: "風水勘察",
  };

  const serviceName =
    serviceNameMap[serviceId] || `其他服務 (${serviceId || "未填寫"})`;

  // 時段文字：優先用多選 timeSlots，沒有再用單一 timeSlot
  let slotText = "未選擇時段";

  if (Array.isArray(timeSlots) && timeSlots.length > 0) {
    // 你現在是「全部都塞進來」，所以會全部列出來
    // 如果之後改回單選 / 限制數量，這裡不用動
    slotText = timeSlots.join("、");
  } else if (timeSlot) {
    slotText = timeSlot;
  }

  const msg =
    `📣 新預約通知\n` +
    `-----------------\n` +
    `項目：${serviceName}\n` +
    `姓名：${name || "（未填寫）"}\n` +
    `聯絡方式：${contact || "（未填寫）"}\n` +
    `日期：${date || "（未填寫）"}\n` +
    `時段：${slotText}\n` +
    (note ? `備註：${note}\n` : "") +
    `-----------------\n` +
    `建立時間：${
      createdAt
        ? new Date(createdAt).toLocaleString("zh-TW")
        : new Date().toLocaleString("zh-TW")
    }`;

  await pushText(ADMIN_USER_ID, msg);
}

module.exports = {
  pushText,
  notifyNewBooking,
};
