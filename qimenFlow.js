/* 
==========================================================
✅ flows/qimenFlow.js
目的：
- 奇門問事流程（第一版）
- 只做到：收問題 → 起盤 → 產出 payload → 回覆摘要
- 暫時不接 AI（先讓流程穩定）
- 不直接依賴 server.js 的 conversationStates（由外部注入）
==========================================================
*/

const { pushText } = require("./lineClient.js");
const { buildQimenPayloadFromQuestion } = require("./qimenEngine.js");

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
  data: { prompt?, userQuestion?, qType?, useDoor? }
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
    ✅ 產出奇門 payload（包含：分類/用神門/落宮/摘要/prompt）
    ----------------------------------------------------------
    */
    const payload = buildQimenPayloadFromQuestion(t);

    /* 
    ----------------------------------------------------------
    ✅ 回覆摘要（先不接 AI）
    目的：
    - 先讓你確認「LINE 流程串起來」且資料正確
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
    ✅ 存 prompt（下一步接 AI 用）
    ----------------------------------------------------------
    */
    state.stage = "ready_ai";
    state.data = {
      userQuestion: payload.userQuestion,
      prompt: payload.prompt,
      qType: payload.qType,
      useDoor: payload.useDoor,
    };

    conversationStates[userId] = state;

    await pushText(
      userId,
      "如果要我直接解盤回覆，輸入：開始解盤\n（或輸入「取消」退出）",
    );
    return true;
  }

  /* 
  ----------------------------------------------------------
  ✅ Step 4：ready_ai（先不呼叫 AI）
  ----------------------------------------------------------
  */
  if (state.stage === "ready_ai") {
    if (t === "開始解盤") {
      await pushText(userId, "OK，我準備解盤（下一步會接 AI 回覆）");
      return true;
    }

    await pushText(userId, "要我解盤就輸入：開始解盤\n或輸入「取消」退出。");
    return true;
  }

  return false;
}

module.exports = { handleQimenFlow };
