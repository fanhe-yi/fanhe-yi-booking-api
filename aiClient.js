// aiClient.js
const OpenAI = require("openai");

// ===== OpenAI Client =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== OpenAI 共用呼叫（Responses API，適用所有模型）=====
async function callOpenAI(model, userPrompt, systemPrompt) {
  const resp = await openai.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return resp.output_text?.trim();
}

// ===== Gemini（沿用你原本的實作即可）=====
async function callGemini(userPrompt, systemPrompt) {
  // ⚠️ 請替換成你現有的 Gemini 呼叫
  throw new Error("Gemini 尚未實作");
}

// ===== 主流程：fallback chain =====
// 順序：4.1-nano > 4o-mini > 5.1 > Gemini
async function AI_Reading(userPrompt, systemPrompt) {
  const models = ["gpt-4.1-nano", "gpt-4o-mini", "gpt-5.1"];

  for (const model of models) {
    try {
      const text = await callOpenAI(model, userPrompt, systemPrompt);
      if (text) {
        console.log(`[AI_Reading] 使用模型成功：${model}`);
        return text;
      }
    } catch (err) {
      console.warn(
        `[AI_Reading] ${model} 失敗，嘗試下一個`,
        err?.status || err?.code || err?.message
      );
    }
  }

  // OpenAI 全部失敗，最後才用 Gemini
  console.warn("[AI_Reading] OpenAI 全部失敗，改用 Gemini");
  return await callGemini(userPrompt, systemPrompt);
}

module.exports = { AI_Reading };
