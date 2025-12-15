// aiClient.js

// ---- OpenAI 設定（現在當主力）----
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---- Gemini 設定（當備援） -----
const { GoogleGenAI } = require("@google/genai");

const googleAi = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

// ---- 內部：呼叫 OpenAI（主力）----
async function callOpenAI(userPrompt, systemPrompt) {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini", // ✅ 預設用 GPT
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  const text =
    resp.choices?.[0]?.message?.content?.trim() ||
    "這次星星沒有成功排好隊，你可以等等再試一次～";

  console.log("[AI_Reading][OpenAI] 發送成功");
  return text;
}

// ---- 內部：呼叫 Gemini（改成備援）----
async function callGemini(userPrompt, systemPrompt) {
  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "user", parts: [{ text: userPrompt }] },
  ];

  const resp = await googleAi.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      temperature: 0.7,
    },
  });

  const text =
    resp.text?.trim() || "這次星星沒有成功排好隊，你可以等等再試一次～";

  console.log("[AI_Reading][Gemini] 發送成功");
  return text;
}

// ---- 對外：統一入口，✅ 先 GPT，再 Gemini 備援 ----
async function AI_Reading(userPrompt, systemPrompt) {
  // 1) 先試 OpenAI（GPT）
  try {
    return await callOpenAI(userPrompt, systemPrompt);
  } catch (err) {
    console.error("[AI_Reading] OpenAI 發生錯誤：", err);

    const msg = err?.message || "";
    const code = err?.status || err?.code || "";

    const isQuotaError =
      code === 429 ||
      code === "insufficient_quota" ||
      /quota|limit|insufficient_quota/i.test(msg);

    if (isQuotaError) {
      console.warn("[AI_Reading] OpenAI quota 爆了，改用 Gemini 備援");
    } else {
      console.warn("[AI_Reading] OpenAI 其它錯誤，改用 Gemini 撐場");
    }

    // 2) GPT 掛了 → 試 Gemini
    try {
      return await callGemini(userPrompt, systemPrompt);
    } catch (err2) {
      console.error("[AI_Reading] Gemini 備援也失敗：", err2);
      // 3) 兩個都掛掉 → 回一段溫柔道歉文字
      return "我這邊在幫你看盤的時候小當機了一下，可以晚點再試一次，好嗎？";
    }
  }
}

module.exports = {
  AI_Reading,
};
