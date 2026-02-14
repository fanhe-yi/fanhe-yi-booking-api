/* 
==========================================================
✅ qimenPrompts.js
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
- 支援：
  1) 單門：useDoor + doorInfo
  2) 多門：useDoors[] + doorInfos[]
==========================================================
*/
function buildQimenUserPrompt(payload) {
  /* 
  ----------------------------------------------------------
  ✅ Step 1：防呆 + 取值
  ----------------------------------------------------------
  */
  const p = payload || {};
  const userQuestion = p.userQuestion || "";
  const qType = p.qType || "";
  const obsSummary = p.obsSummary || "";
  const obsHasVoid = !!p.obsHasVoid;

  const qimen = p.qimen || {};
  const voidPalaces = Array.isArray(p.voidPalaces) ? p.voidPalaces : [];

  /* 
  ----------------------------------------------------------
  ✅ Step 2：統一取得「用神門列表」
  目的：
  - 新版：useDoors（陣列）
  - 舊版：useDoor（字串）
  ----------------------------------------------------------
  */
  const useDoors = Array.isArray(p.useDoors)
    ? p.useDoors
    : p.useDoor
      ? [p.useDoor]
      : [];

  /* 
  ----------------------------------------------------------
  ✅ Step 3：統一取得「用神門落宮資訊列表」
  目的：
  - 新版：doorInfos（陣列）
  - 舊版：doorInfo（單筆）
  ----------------------------------------------------------
  */
  const doorInfos = Array.isArray(p.doorInfos)
    ? p.doorInfos
    : p.doorInfo
      ? [{ 門: useDoors[0] || "", ...p.doorInfo }]
      : [];

  /* 
  ----------------------------------------------------------
  ✅ Step 4：把多門資訊組成可讀字串
  需求：
  - 每一門都顯示：八神+九星+八門｜落宮｜(旬空：是/否)
  ----------------------------------------------------------
  */
  const doorLines =
    doorInfos.length > 0
      ? doorInfos
          .map((d) => {
            const doorName = d["門"] || "";
            const palace = d["宮位"] || "";
            const hasVoid = palace ? voidPalaces.includes(palace) : false;

            const part = `${d["八神"]}+${d["九星"]}+${d["八門"]}`;
            const voidText = hasVoid ? "是" : "否";

            return `${doorName}：${part}｜落${palace}（旬空：${voidText}）`;
          })
          .join("\n")
      : "找不到用神門落宮資訊";

  /* 
  ----------------------------------------------------------
  ✅ Step 5：組成 userPrompt
  ----------------------------------------------------------
  */
  return `
請根據以下盤面資料，回答使用者問題（白話、直接）。

【使用者問題】
${userQuestion}

【自動判定】
類型：${qType}
用神門：${useDoors.length ? useDoors.join("、") : "（未判定）"}

【值符觀測宮摘要】
${obsSummary}
（值符觀測宮旬空：${obsHasVoid ? "是" : "否"}）

【用神門落宮資訊】
${doorLines}

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
