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
    ✅ Step 4-1：取出 prompt
    目的：
    - 我們前一步已把 prompt 存在 state.data.prompt
    - 這裡直接拿來丟給 AI
    ----------------------------------------------------------
    */
      const prompt = state?.data?.prompt || "";

      /* ✅ 防呆：沒有 prompt 就請他重來 */
      if (!prompt) {
        delete conversationStates[userId];
        await pushText(
          userId,
          "我這邊沒有拿到盤面資料，可能流程被中斷了。\n\n請重新輸入：奇門問事",
        );
        return true;
      }

      /* 
    ----------------------------------------------------------
    ✅ Step 4-2：呼叫 AI_Reading
    目的：
    - systemPrompt：放你希望 AI 遵守的規則（口吻、長度、格式）
    - userPrompt：放我們組好的奇門 prompt（盤面資料 + 問題）
    ----------------------------------------------------------
    */
      const systemPrompt = `
        你是奇門遁甲老師，回覆要像真人口吻、白話、直接。
        規則：
        - 先一句結論
        - 再 2~4 個理由（用白話描述，不要講教科書定義）
        - 最後給 2 個可執行建議
        - 不要超過 180 字
        - 若出現「旬空」，用「變數/延遲/需要再確認」來解釋
        `.trim();

      let aiText = "";

      try {
        aiText = await AI_Reading(prompt, systemPrompt);
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
    ✅ Step 4-3：回覆使用者
    目的：
    - 直接把 AI 解盤文字 push 回去
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
    ✅ Step 4-4：結束 qimen 流程（避免狀態殘留）
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
