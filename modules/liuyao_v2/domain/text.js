/***************************************
 * [Step 1-3] domain/text.js
 * 目的：提供 toTW()（繁簡轉換）給 UI 用
 * - 有裝 opencc-js：就轉
 * - 沒裝：就原樣回傳
 ***************************************/
let toTW = (s) => String(s || "");

try {
  const OpenCC = require("opencc-js");
  const converter = OpenCC.Converter({ from: "cn", to: "tw" });
  toTW = (s) => converter(String(s || ""));
} catch (e) {
  // no-op
}

module.exports = { toTW };
