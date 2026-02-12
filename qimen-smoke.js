/* 
==========================================================
✅ scripts/qimen-smoke.js
目的：
- 純 smoke test：驗證 qimenEngine 能產出完整 payload
==========================================================
*/

const { buildQimenPayloadFromQuestion } = require("./qimenEngine.js");

/* 
----------------------------------------------------------
✅ 測試問題
----------------------------------------------------------
*/
const userQuestion = "身體健康嗎";

/* 
----------------------------------------------------------
✅ 產出 payload
----------------------------------------------------------
*/
const payload = buildQimenPayloadFromQuestion(userQuestion);

/* 
----------------------------------------------------------
✅ 輸出重點
----------------------------------------------------------
*/
console.log("\n=== 自動分類 → 用神門 → 落宮（測試） ===");
console.log("問題:", payload.userQuestion);
console.log("判定類型:", payload.qType);
console.log("用神門:", payload.useDoor);
console.log("用神門所在宮資訊:", payload.doorInfo);

console.log("\n=== 值符觀測宮摘要（一行） ===");
console.log(payload.obsSummary);

console.log("\n=== 空亡 ===");
console.log("空亡地支:", payload.voidBranches);
console.log("空亡宮位:", payload.voidPalaces);

console.log("\n=== AI Prompt（待送 AI） ===");
console.log(payload.prompt);
