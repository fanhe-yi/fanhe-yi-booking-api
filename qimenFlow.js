/* ==========================================================
✅ qimenFlow.js
目的：
- 奇門問事流程控制 (狀態機)
- 流程：Waiting Question -> Waiting Number -> Ready AI
==========================================================
*/

const { pushText, pushFlex, sendQimenResultFlex } = require("./lineClient.js");
const { buildQimenPayloadFromQuestion } = require("./qimenEngine.js");
const {
  getQimenSystemPrompt,
  buildQimenUserPrompt,
} = require("./qimenPrompts.js");
const { AI_Reading } = require("./aiClient.js");

/* ==========================================================
✅ handleQimenFlow
==========================================================
*/
async function handleQimenFlow(userId, text, state, event, conversationStates) {
  const t = String(text || "").trim();

  /* ----------------------------------------------------------
  ✅ 通用指令：取消/退出
  ----------------------------------------------------------
  */
  if (t === "取消" || t === "結束" || t === "退出") {
    delete conversationStates[userId];
    await pushText(userId, "已退出奇門問事 ✅");
    return true;
  }

  /* ----------------------------------------------------------
  ✅ Stage 1：等待輸入問題
  ----------------------------------------------------------
  */
  if (state.stage === "waiting_question") {
    /* 防呆 */
    if (!t) {
      await pushText(userId, "你可以直接輸入一句你想問的問題～");
      return true;
    }

    /* 🔴 修改：不直接起盤，而是存問題，進下一關 (問數字)
     */
    state.data = { tempQuestion: t };
    state.stage = "waiting_number"; // 切換狀態
    conversationStates[userId] = state;

    await pushText(
      userId,
      `收到問題：\n「${t}」\n\n接下來，請靜心默想你的問題，並輸入一組「6位數的數字」\n（例如：168888、357912）\n\n或「取消」退出。`,
    );
    return true;
  }

  /* ----------------------------------------------------------
  ✅ Stage 2：等待輸入數字 (時空數)
  ----------------------------------------------------------
  */
  if (state.stage === "waiting_number") {
    // 簡單驗證：是否為純數字
    if (!/^\d+$/.test(t)) {
      await pushText(userId, "請輸入純數字喔！(建議 6 位數，例如 357159)");
      return true;
    }

    const question = state.data.tempQuestion;
    const userNumber = t; // 使用者輸入的數字

    /* ✅ 呼叫引擎：產出 Payload (帶入數字)
     */
    const payload = buildQimenPayloadFromQuestion(question, userNumber);

    // 存 payload，準備讓 AI 解讀
    state.stage = "ready_ai";
    state.data = { payload };
    conversationStates[userId] = state;

    /* 🌟 改用 Flex Message 呈現確認卡片與「開始解盤 / 取消」按鈕 */
    const confirmFlex = {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "時空占卜確認",
            weight: "bold",
            size: "xl",
            color: "#3B2E40", // 呼應玄紫色設計
          },
          {
            type: "text",
            text: `時空運數：${userNumber}`,
            size: "sm",
            color: "#8B7355", // 燙金色
            weight: "bold",
          },
          {
            type: "text",
            text: `問題：${payload.userQuestion}`,
            size: "sm",
            color: "#4A4A4A",
            wrap: true,
          },
          {
            type: "text",
            text: `類型：${payload.qType}`,
            size: "sm",
            color: "#999999",
          },
          { type: "separator", margin: "md" },
          {
            type: "text",
            text: "若確認無誤，請點擊下方開始解盤。",
            size: "xs",
            color: "#888888",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal", // 讓兩個按鈕並排
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#3B2E40", // 玄紫色主按鈕
            height: "sm",
            action: {
              type: "message",
              label: "開始解盤",
              text: "開始解盤", // 👈 觸發 ready_ai 階段的邏輯
            },
          },
          {
            type: "button",
            style: "secondary", // 灰色取消按鈕
            height: "sm",
            action: {
              type: "message",
              label: "取消",
              text: "取消", // 👈 觸發最上方的 t === "取消"
            },
          },
        ],
      },
    };

    await pushFlex(userId, "奇門問事確認", confirmFlex);
    return true;
  }

  /* ----------------------------------------------------------
  ✅ Stage 3：準備解盤 (AI)
  ----------------------------------------------------------
  */
  if (state.stage === "ready_ai") {
    /* 確認指令 */
    if (t === "開始解盤") {
      const payload = state?.data?.payload;

      /* 防呆：資料遺失 */
      if (!payload) {
        delete conversationStates[userId];
        await pushText(userId, "資料已過期，請重新輸入：奇門問事");
        return true;
      }

      /* ✅ 呼叫 AI
       */
      const systemPrompt = getQimenSystemPrompt();
      const userPrompt = buildQimenUserPrompt(payload);

      // (可選) 提示使用者正在運算
      // await pushText(userId, "🔍 正在排盤解析中，請稍候...");

      let aiText = "";
      try {
        aiText = await AI_Reading(userPrompt, systemPrompt);
      } catch (err) {
        console.error("[QIMEN][AI] reading failed:", err?.message || err);
        delete conversationStates[userId];
        await pushText(userId, "AI 連線忙碌中，請稍後再試一次。");
        return true;
      }

      const aiData = parseAiJson(aiText);

      if (aiData) {
        // 成功解析 JSON -> 送卡片
        const userNumber = payload.userNumber;
        const question = payload.userQuestion;

        await sendQimenResultFlex(userId, userNumber, question, aiData);
      } else {
        // 解析失敗 (AI 可能講廢話) -> 直接送純文字 (Fallback)
        await pushText(userId, aiText);
      }

      delete conversationStates[userId];
      return true;
    }

    /* 沒輸入開始解盤 */
    await pushText(
      userId,
      "要我解盤請點擊按鈕或輸入：開始解盤\n或「取消」退出。",
    );
    return true;
  }

  return false;
}

// 簡易 JSON 解析器 (貼在 qimenFlow.js 檔案最下方即可)
function parseAiJson(text) {
  try {
    // 移除 markdown 符號
    const clean = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("JSON Parse Error:", e);
    return null;
  }
}

module.exports = { handleQimenFlow };
