// aiClient.js
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 八字小提醒
 * @param {string} userPrompt - 你組好的 userPrompt
 * @param {string} systemPrompt - 系統提示（命理老師角色）
 * @returns {Promise<string>} - 回傳 AI 產出的文字
 */
async function AI_Reading(userPrompt, systemPrompt) {
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    });

    const text =
      resp.choices[0]?.message?.content?.trim() ||
      "這次星星沒有成功排好隊，你可以等等再試一次～";

    return text;
  } catch (err) {
    console.error("[AI_Reading] AI 發生錯誤：", err);
    return "我這邊在幫你看盤的時候小當機了一下，可以晚點再試一次，好嗎？";
  }
}

module.exports = {
  AI_Reading,
};
