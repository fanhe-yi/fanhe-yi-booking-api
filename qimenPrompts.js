/* ==========================================================
✅ qimenPrompts.js
目的：
- 集中管理奇門解盤「systemPrompt」與「userPrompt」
- 🔴 修改：加入「數字靈動」的解讀要求，增加儀式感
==========================================================
*/

/* ==========================================================
✅ getQimenSystemPrompt
目的：
- 控制 AI 回覆規則（白話、短、可執行）
- 🔴 新增：要求 AI 先解讀數字氣場
==========================================================
*/
function getQimenSystemPrompt() {
  return `
你是精通奇門遁甲與數字靈動的命理大師。
請根據用戶提供的「觸機靈數」與「奇門盤面」進行解讀。

⚠️ 重要規則：
1. 請務必回傳 **純 JSON 格式** 的字串。
2. 不要包含任何 Markdown (如 \`\`\`json ) 或其他廢話。
3. 用白話描述，不要提到任何有關奇門遁甲的專有名詞
4. 語氣請明確，不要有模棱兩可的回覆，能就能，不能就不能
5. 不要有類似AI-"不是，而是"這種語氣
6. JSON 結構如下：

{
  "spirit_analysis": "針對使用者輸入那組數字的靈動數解讀 (約30字，描述氣場)",
  "main_conclusion": "針對問題的奇門盤面核心結論 (約100字，白話，直指吉凶)",
  "suggestions": [
    "建議一 (具體可執行)，不要用什麼三個月內要做什麼這種字眼，建議往心靈層次上去提升",
    "建議二 (具體可執行)，不要用什麼三個月內要做什麼這種字眼，建議往心靈層次上去提升"
  ],
  "lucky_poem": "一句話總結的籤詩 (例如：雲開見月分明處，萬里光輝獨自行)"
}
`.trim();
}

/* ==========================================================
✅ buildQimenUserPrompt
目的：
- 用「engine 回傳的 payload」組成 userPrompt
- 🔴 新增：將 userNumber (觸機數字) 餵給 AI
==========================================================
*/
function buildQimenUserPrompt(payload) {
  const p = payload || {};
  const userQuestion = p.userQuestion || "";
  const userNumber = p.userNumber || "（未提供）"; // 🔴 取得數字
  const qType = p.qType || "";
  const obsSummary = p.obsSummary || "";
  const obsHasVoid = !!p.obsHasVoid;

  const qimen = p.qimen || {};
  const voidPalaces = Array.isArray(p.voidPalaces) ? p.voidPalaces : [];

  /* 處理用神門與落宮資訊 (維持原樣) */
  const useDoors = Array.isArray(p.useDoors)
    ? p.useDoors
    : p.useDoor
      ? [p.useDoor]
      : [];

  const doorInfos = Array.isArray(p.doorInfos)
    ? p.doorInfos
    : p.doorInfo
      ? [{ 門: useDoors[0] || "", ...p.doorInfo }]
      : [];

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

  /* ----------------------------------------------------------
  ✅ 🔴 修改：Prompt 內容加入「觸機數字」
  ----------------------------------------------------------
  */
  return `
請進行解盤。

【使用者資訊】
問題：${userQuestion}
觸機靈數：${userNumber} (請特別解讀這組數字的含義)

【奇門盤面參數】
類型：${qType}
用神門：${useDoors.join("、")}

【盤面細節】
值符觀測：${obsSummary} (旬空：${obsHasVoid ? "是" : "否"})
用神落宮：
${doorLines}

【時空背景】
旬首：${qimen["旬首"] || ""}
空亡宮位：${voidPalaces.join("、") || "無"}

請開始依照 System Prompt 的格式回答：
`.trim();
}

module.exports = {
  getQimenSystemPrompt,
  buildQimenUserPrompt,
};
