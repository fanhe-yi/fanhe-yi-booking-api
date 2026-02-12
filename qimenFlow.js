/* 
==========================================================
✅ flows/qimenFlow.js
目的：
- 奇門問事流程（第一版）
- 收問題 → 起盤 → 產出 payload → 回覆摘要
- 使用者輸入「開始解盤」→ 呼叫 AI_Reading → 回覆解盤
- 不直接依賴 server.js 的 conversationStates（由外部注入）
==========================================================
*/

const { pushText } = require("./lineClient.js");
const { buildQimenPayloadFromQuestion } = require("./qimenEngine.js");
const {
  getQimenSystemPrompt,
  buildQimenUserPrompt,
} = require("./qimenPrompts.js");
const { AI_Reading } = require("./aiClient.js");

/* 
==========================================================
✅ handleQimenFlow
參數：
- userId / text / state / event：沿用你現有 flow 介面
- conversationStates：由 server.js 注入（避免 global）
state 結構建議：
{
  mode: "qimen",
  stage: "waiting_question" | "ready_ai",
  data: {
    payload?: object   // ✅ 存盤面資料，避免下一步重起盤
  }
}
==========================================================
*/
async function handleQimenFlow(userId, text, state, event, conversationStates) {
  /* 
  ----------------------------------------------------------
  ✅ Step 1：前處理
  ----------------------------------------------------------
  */
  const t = String(text || "").trim();

  /* 
  ----------------------------------------------------------
  ✅ Step 2：取消指令（通用）
  ----------------------------------------------------------
  */
  if (t === "取消" || t === "結束" || t === "退出") {
    delete conversationStates[userId];
    await pushText(userId, "已退出奇門問事 ✅");
    return true;
  }

  /* 
  ----------------------------------------------------------
  ✅ Step 3：等待使用者輸入問題
  ----------------------------------------------------------
  */
  if (state.stage === "waiting_question") {
    /* ✅ 空字防呆 */
    if (!t) {
      await pushText(userId, "你可以直接輸入一句你想問的問題～");
      return true;
    }

    /* 
    ----------------------------------------------------------
    ✅ Step 3-1：產出奇門 payload（盤面資料）
    目的：
    - 起盤 + 分類 + 用神門 + 空亡 + 摘要 + 用神門落宮資訊
    ----------------------------------------------------------
    */
    const payload = buildQimenPayloadFromQuestion(t);

    /* 
    ----------------------------------------------------------
    ✅ Step 3-2：回覆摘要（先讓你確認資料是對的）
    ----------------------------------------------------------
    */
    const msg =
      `收到 ✅\n` +
      `問題：${payload.userQuestion}\n` +
      `類型：${payload.qType}\n` +
      `用神門：${payload.useDoor}\n` +
      `用神門落宮：${payload.doorInfo?.["宮位"] || "?"}\n` +
      `盤面摘要：${payload.obsSummary}`;

    await pushText(userId, msg);

    /* 
    ----------------------------------------------------------
    ✅ Step 3-3：存 payload（下一步「開始解盤」用）
    目的：
    - 避免下一步再起盤造成盤面變動
    ----------------------------------------------------------
    */
    state.stage = "ready_ai";
    state.data = { payload };
    conversationStates[userId] = state;

    await pushText(
      userId,
      "如果要我直接解盤回覆，輸入：開始解盤\n（或輸入「取消」退出）",
    );
    return true;
  }

  /* 
  ----------------------------------------------------------
  ✅ Step 4：ready_ai（接 AI 解盤）
  ----------------------------------------------------------
  */
  if (state.stage === "ready_ai") {
    /* ✅ 使用者確認要解盤 */
    if (t === "開始解盤") {
      /* 
      ----------------------------------------------------------
      ✅ Step 4-1：取出 payload
      目的：
      - payload 是上一階段起盤產出的資料
      ----------------------------------------------------------
      */
      const payload = state?.data?.payload;

      /* ✅ 防呆：沒有 payload 就請他重來 */
      if (!payload) {
        delete conversationStates[userId];
        await pushText(
          userId,
          "我這邊沒有拿到盤面資料，可能流程被中斷了。\n\n請重新輸入：奇門問事",
        );
        return true;
      }

      /* 
      ----------------------------------------------------------
      ✅ Step 4-2：用 qimenPrompts 組出 system/user prompt
      目的：
      - systemPrompt：控制口吻/長度/結構
      - userPrompt：帶入盤面摘要、用神門落宮、空亡等資料
      ----------------------------------------------------------
      */
      const systemPrompt = getQimenSystemPrompt();
      const userPrompt = buildQimenUserPrompt(payload);

      /* 
      ----------------------------------------------------------
      ✅ Step 4-3：呼叫 AI_Reading
      ----------------------------------------------------------
      */
      let aiText = "";
      try {
        aiText = await AI_Reading(userPrompt, systemPrompt);
      } catch (err) {
        console.error("[QIMEN][AI] reading failed:", err?.message || err);

        /* ✅ AI 掛了就友善回覆，並結束流程避免卡住 */
        delete conversationStates[userId];
        await pushText(
          userId,
          "我剛剛解盤時卡了一下（可能是 AI 忙碌）。\n你可以再輸入一次：奇門問事",
        );
        return true;
      }

      /* 
      ----------------------------------------------------------
      ✅ Step 4-4：回覆使用者
      ----------------------------------------------------------
      */
      const out = String(aiText || "").trim();
      if (!out) {
        delete conversationStates[userId];
        await pushText(
          userId,
          "我剛剛沒有拿到解盤內容（可能是 AI 回傳空白）。\n你可以再輸入一次：奇門問事",
        );
        return true;
      }

      await pushText(userId, out);

      /* 
      ----------------------------------------------------------
      ✅ Step 4-5：結束 qimen 流程（避免狀態殘留）
      ----------------------------------------------------------
      */
      delete conversationStates[userId];

      /* ✅ 可選：丟一句收尾 */
      await pushText(userId, "如果你想再問一題，直接輸入：奇門問事");

      return true;
    }

    /* ✅ 沒輸入開始解盤 → 提示 */
    await pushText(userId, "要我解盤就輸入：開始解盤\n或輸入「取消」退出。");
    return true;
  }

  return false;
}

module.exports = { handleQimenFlow };
