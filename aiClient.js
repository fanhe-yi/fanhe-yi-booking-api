// aiClient.js
const { GoogleGenAI } = require("@google/genai");

// 初始化 GoogleGenAI 實例
// SDK 會自動查找環境變數 GOOGLE_API_KEY
const ai = new GoogleGenAI({});

/**
 * 八字小提醒
 * @param {string} userPrompt - 你組好的 userPrompt
 * @param {string} systemPrompt - 系統提示（命理老師角色）
 * @returns {Promise<string>} - 回傳 AI 產出的文字
 */
async function AI_Reading(userPrompt, systemPrompt) {
  try {
    // 構造發送到 Gemini API 的內容
    const contents = [
      // 將 systemPrompt 放在第一個內容塊中
      { role: "user", parts: [{ text: systemPrompt }] },
      // 接著是使用者提示
      { role: "user", parts: [{ text: userPrompt }] },
    ];

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash", // 推薦使用 gemini-2.5-flash 快速且強大
      contents: contents,
      config: {
        // 在 Gemini 1.5/2.5 模型中，建議使用 systemInstruction 來設定角色
        // 但為了與您的原始結構保持相似，我們將 systemPrompt 放在 contents 的第一個 user 角色中。
        // 如果想要使用專門的 systemInstruction，可以替換成：
        // systemInstruction: systemPrompt,
        // contents: [{ role: "user", parts: [{ text: userPrompt }] }],

        temperature: 0.7,
      },
    });

    // 取得模型回傳的文字
    const text =
      resp.text?.trim() || "這次星星沒有成功排好隊，你可以等等再試一次～";

    console.log("[LINE] AI_Reading,Text 發送成功");
    return text;
  } catch (err) {
    console.error("[AI_Reading] AI 發生錯誤：", err);
    return "我這邊在幫你看盤的時候小當機了一下，可以晚點再試一次，好嗎？";
  }
}

module.exports = {
  AI_Reading,
};
