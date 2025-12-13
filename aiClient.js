// aiClient.js
const OpenAI = require("openai");
const { GoogleGenAI } = require("@google/genai");

// ---- OpenAI 設定 ----
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---- Gemini 設定 ----
const googleAi = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

// ---- 內部：呼叫 OpenAI ----
async function callOpenAI(userPrompt, systemPrompt) {
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

  console.log("[AI_Reading][OpenAI] 發送成功");
  return text;
}

// ---- 內部：呼叫 Gemini ----
async function callGemini(userPrompt, systemPrompt) {
  // 建議：用 systemInstruction 來放你的命理老師人設
  const model = googleAi.getGenerativeModel({
    model: "gemini-2.5-flash", // 先用 flash，比較省錢又快
    systemInstruction: systemPrompt,
  });

  const resp = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
    },
  });

  // 不同 SDK 版本取字串的方式會不太一樣，這裡多做幾層保險
  let text = "這次星星沒有成功排好隊，你可以等等再試一次～";

  if (resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
    text = resp.response.candidates[0].content.parts[0].text.trim();
  } else if (typeof resp?.response?.text === "function") {
    text = resp.response.text().trim();
  } else if (typeof resp?.text === "function") {
    text = resp.text().trim();
  } else if (typeof resp?.text === "string") {
    text = resp.text.trim();
  }

  console.log("[AI_Reading][Gemini] 發送成功");
  return text;
}

// ---- 對外：統一入口，預設 Gemini，quota 爆了再用 GPT ----
async function AI_Reading(userPrompt, systemPrompt) {
  try {
    // 先試 Gemini
    return await callGemini(userPrompt, systemPrompt);
  } catch (err) {
    console.error("[AI_Reading] Gemini 發生錯誤：", err);

    const msg = err?.message || "";
    const code = err?.code || err?.status || "";

    const isQuotaError =
      code === 429 ||
      code === "RESOURCE_EXHAUSTED" ||
      /quota|exceeded|RESOURCE_EXHAUSTED/i.test(msg);

    if (isQuotaError) {
      console.warn("[AI_Reading] Gemini quota 爆了，改用 OpenAI 備援");
    } else {
      console.warn("[AI_Reading] Gemini 其它錯誤，也先用 OpenAI 撐場");
    }

    try {
      return await callOpenAI(userPrompt, systemPrompt);
    } catch (err2) {
      console.error("[AI_Reading] OpenAI 備援也失敗：", err2);
      return "我這邊在幫你看盤的時候小當機了一下，可以晚點再試一次，好嗎？";
    }
  }
}

module.exports = {
  AI_Reading,
};
