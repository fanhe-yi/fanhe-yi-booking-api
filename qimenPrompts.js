/* 
==========================================================
✅ src/qimen/qimenPrompts.js
目的：
- 集中管理奇門解盤「systemPrompt」與「userPrompt」
- 之後要調口吻/長度/格式 → 只改這支
==========================================================
*/

/* 
==========================================================
✅ getQimenSystemPrompt
目的：
- 控制 AI 回覆規則（白話、短、可執行）
==========================================================
*/
function getQimenSystemPrompt() {
  return `
你是奇門遁甲老師，回覆要像真人口吻、白話、直接。
規則：
- 先一句結論
- 再 2~4 個理由（用白話描述，不要提到任何有關奇門遁甲的專有名詞）
- 最後給 2 個可執行建議
- 不要超過 180 字
- 若出現「旬空」，用「變數/延遲/需要再確認」來解釋
`.trim();
}

/* 
==========================================================
✅ buildQimenUserPrompt
目的：
- 用「engine 回傳的 payload」組成 userPrompt
- 這裡放盤面摘要、用神門落宮、空亡等資料
==========================================================
*/
function buildQimenUserPrompt(payload) {
  /* 
  ----------------------------------------------------------
  ✅ Step 1：防呆（避免 payload 不完整）
  ----------------------------------------------------------
  */
  const p = payload || {};
  const userQuestion = p.userQuestion || "";
  const qType = p.qType || "";
  const useDoor = p.useDoor || "";
  const obsSummary = p.obsSummary || "";
  const obsHasVoid = !!p.obsHasVoid;

  const doorInfo = p.doorInfo || null;
  const voidPalaces = Array.isArray(p.voidPalaces) ? p.voidPalaces : [];
  const qimen = p.qimen || {};

  /* 
  ----------------------------------------------------------
  ✅ Step 2：計算「用神宮是否旬空」
  ----------------------------------------------------------
  */
  const doorPalace = doorInfo?.["宮位"];
  const doorHasVoid = doorPalace ? voidPalaces.includes(doorPalace) : false;

  /* 
  ----------------------------------------------------------
  ✅ Step 3：組成 userPrompt（給 AI 的盤面內容）
  ----------------------------------------------------------
  */
  return `
請根據以下盤面資料，回答使用者問題（白話、直接）。

【使用者問題】
${userQuestion}

【自動判定】
類型：${qType}
用神門：${useDoor}

【值符觀測宮摘要】
${obsSummary}
（值符觀測宮旬空：${obsHasVoid ? "是" : "否"}）

【用神門落宮資訊】
${
  doorInfo
    ? `${doorInfo["八神"]}+${doorInfo["九星"]}+${doorInfo["八門"]}｜落${doorInfo["宮位"]}`
    : "找不到用神門落宮資訊"
}
（用神宮旬空：${doorHasVoid ? "是" : "否"}）

【旬首與空亡】
旬首：${qimen["旬首"] || ""}
空亡宮位：${voidPalaces.join("、") || "無"}

請開始回答：
`.trim();
}

module.exports = {
  getQimenSystemPrompt,
  buildQimenUserPrompt,
};
