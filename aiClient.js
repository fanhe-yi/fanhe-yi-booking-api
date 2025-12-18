// aiClient.js

// ---- OpenAI 設定（主力/備援鏈）----
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---- Gemini 設定（最後備援） -----
const { GoogleGenAI } = require("@google/genai");

const googleAi = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

// ---------- 小工具 ----------
function defaultFailText() {
  return "這次星星沒有成功排好隊，你可以等等再試一次～";
}

function isQuotaOrRateLimit(err) {
  const msg = err?.message || "";
  const code = err?.status || err?.code || "";
  return (
    code === 429 ||
    code === "insufficient_quota" ||
    /quota|rate limit|limit|insufficient_quota/i.test(msg)
  );
}

function isModelAccessOrNotFound(err) {
  const msg = err?.message || "";
  const code = err?.status || err?.code || "";
  // 常見：404 model not found / 403 not authorized / 400 invalid model
  return (
    code === 404 ||
    code === 403 ||
    code === 400 ||
    /model|not found|does not exist|permission|unauthorized|access/i.test(msg)
  );
}

function getResponseOutputText(resp) {
  // 官方最常用
  if (resp?.output_text && typeof resp.output_text === "string")
    return resp.output_text.trim();

  // 保底：從 output[] 裡找文字片段（避免 SDK 版本差異）
  const chunks = [];
  const output = resp?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c?.text === "string") chunks.push(c.text);
        }
      }
    }
  }
  const joined = chunks.join("").trim();
  return joined || "";
}

// ---------- OpenAI：三段式 ----------
async function callOpenAI_51(userPrompt, systemPrompt) {
  const resp = await openai.responses.create({
    model: "gpt-5.1",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    // 想更嚴謹可開：reasoning: { effort: "medium" },
  });

  const text = getResponseOutputText(resp) || defaultFailText();
  console.log("[AI_Reading][OpenAI][gpt-5.1] 發送成功");
  return text;
}

async function callOpenAI_41(userPrompt, systemPrompt) {
  const resp = await openai.responses.create({
    model: "gpt-4.1",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = getResponseOutputText(resp) || defaultFailText();
  console.log("[AI_Reading][OpenAI][gpt-4.1] 發送成功");
  return text;
}

async function callOpenAI_4oMini(userPrompt, systemPrompt) {
  // 先維持你原本的 Chat Completions 寫法（最少改動）
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || defaultFailText();

  console.log("[AI_Reading][OpenAI][gpt-4o-mini] 發送成功");
  return text;
}

// ---------- Gemini（最後備援） ----------
async function callGemini(userPrompt, systemPrompt) {
  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "user", parts: [{ text: userPrompt }] },
  ];

  const resp = await googleAi.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: { temperature: 0.7 },
  });

  const text = resp.text?.trim() || defaultFailText();
  console.log("[AI_Reading][Gemini][gemini-2.5-flash] 發送成功");
  return text;
}

// ---- 對外：統一入口，依序：5.1 → 4.1 → 4o-mini → Gemini ----
async function AI_Reading(userPrompt, systemPrompt) {
  const chain = [
    { name: "OpenAI gpt-5.1", fn: callOpenAI_51 },
    { name: "OpenAI gpt-4.1", fn: callOpenAI_41 },
    { name: "OpenAI gpt-4o-mini", fn: callOpenAI_4oMini },
    { name: "Gemini gemini-2.5-flash", fn: callGemini },
  ];

  let lastErr = null;

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    try {
      return await step.fn(userPrompt, systemPrompt);
    } catch (err) {
      lastErr = err;

      const msg = err?.message || "";
      const code = err?.status || err?.code || "";

      console.error(`[AI_Reading] ${step.name} 發生錯誤：`, err);

      // 這三種最常見：配額/速率、模型不可用/無權限、其它暫時性錯誤
      if (isQuotaOrRateLimit(err)) {
        console.warn(
          `[AI_Reading] ${step.name} quota/rate limit（${code}）→ 換下一個`
        );
      } else if (isModelAccessOrNotFound(err)) {
        console.warn(
          `[AI_Reading] ${step.name} model access/not found（${code}）→ 換下一個`
        );
      } else {
        console.warn(`[AI_Reading] ${step.name} 其它錯誤 → 換下一個`);
      }
    }
  }

  console.error(
    "[AI_Reading] 全部模型都失敗，回傳保底文字。最後錯誤：",
    lastErr
  );
  return "我這邊在幫你看盤的時候小當機了一下，可以晚點再試一次，好嗎？";
}

module.exports = {
  AI_Reading,
};
