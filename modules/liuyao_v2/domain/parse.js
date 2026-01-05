/***************************************
 * [Step 1-2] domain/parse.js
 * 目的：把 AI 回覆拆成 ①過去 ②現在 ③未來 + 總結
 ***************************************/
function lyParse(aiText = "") {
  const text = String(aiText || "").trim();

  const sumMatch = text.match(/(?:總結|結論)[\s：:]*([\s\S]*)$/);
  const summary = sumMatch ? `總結：${sumMatch[1].trim()}` : "";

  const p1 = pickBlock(text, /①[\s\S]*?(?=②|$)/);
  const p2 = pickBlock(text, /②[\s\S]*?(?=③|$)/);
  const p3 = pickBlock(text, /③[\s\S]*?(?=$)/);

  // 清掉③末尾的總結，避免重複
  const future = summary ? p3.replace(/(?:總結|結論)[\s\S]*$/g, "").trim() : p3;

  return {
    past: p1.trim(),
    now: p2.trim(),
    future: future.trim(),
    summary: summary.trim(),
    raw: text,
  };

  function pickBlock(src, re) {
    const m = src.match(re);
    return m ? m[0] : "";
  }
}

module.exports = { lyParse };
