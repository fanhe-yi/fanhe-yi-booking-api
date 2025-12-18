// aiClient.js (CommonJS)
// OpenAI: 全模型統一用 Responses API（避免 gpt-5.1 不支援 chat.completions 的坑）
//
// 功能：
// 1) 用環境變數 AI_MODELS 控制模型順序（不必改檔）
// 2) 每次呼叫 console.log 顯示 token 用量（input/output/total）
// 3) fallback：依序嘗試 OpenAI 模型 → 最後 Gemini 保命
//
// 必要環境變數：
// - OPENAI_API_KEY
// - GOOGLE_API_KEY（若要啟用 Gemini 備援）
// - AI_MODELS（可選，逗號分隔，例如：gpt-4.1-nano,gpt-4o-mini,gpt-5.1）

// ---- OpenAI 設定 ----
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

function isModelNotFound(err) {
  const msg = err?.message || "";
  const code = err?.status || err?.code || "";
  return code === 404 || /model.*not found|does not exist/i.test(msg);
}

// 讀取模型鏈：用 AI_MODELS 控制，不用改檔
function getModelChain() {
  const raw = (process.env.AI_MODELS || "").trim();
  if (!raw) {
    // ✅ 預設：便宜優先 → 你能用的 → 高階撿到算賺到
    return ["gpt-4.1-nano", "gpt-4o-mini", "gpt-5.1"];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- OpenAI（Responses API）----
// 任何 OpenAI 模型都走這裡（包含 gpt-5.1 / 4o-mini / 4.1-nano）
async function callOpenAI(model, userPrompt, systemPrompt) {
  const resp = await openai.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = resp.output_text?.trim() || defaultFailText();

  // ✅ 顯示 token 用量（之後你要寫 DB 再接這裡）
  const u = resp.usage || {};
  console.log(
    `[AI_USAGE] model=${model} input=${u.input_tokens ?? "?"} output=${
      u.output_tokens ?? "?"
    } total=${u.total_tokens ?? "?"}`
  );

  console.log(`[AI_Reading][OpenAI][${model}] 發送成功`);
  return text;
}

// ---- Gemini（最後備援） ----
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

// ---- 對外：統一入口 ----
// OpenAI 依 AI_MODELS 順序嘗試；全掛才用 Gemini
async function AI_Reading(userPrompt, systemPrompt) {
  const chain = getModelChain();

  let lastErr = null;

  for (const model of chain) {
    try {
      return await callOpenAI(model, userPrompt, systemPrompt);
    } catch (err) {
      lastErr = err;
      const code = err?.status || err?.code || "";

      if (isQuotaOrRateLimit(err)) {
        console.warn(`[AI_Reading] ${model} 額度/限流（${code}）→ 換下一個`);
      } else if (isModelNotFound(err)) {
        console.warn(
          `[AI_Reading] ${model} 模型不存在/無權限（${code}）→ 換下一個`
        );
      } else {
        console.warn(`[AI_Reading] ${model} 其它錯誤（${code}）→ 換下一個`);
      }
    }
  }

  // OpenAI 全部失敗 → Gemini
  try {
    console.warn("[AI_Reading] OpenAI 全部失敗，改用 Gemini");
    return await callGemini(userPrompt, systemPrompt);
  } catch (err) {
    console.error(
      "[AI_Reading] 全部模型都失敗，回傳保底文字。最後錯誤：",
      lastErr || err
    );
    return "我這邊在幫你看盤的時候小當機了一下，可以晚點再試一次，好嗎？";
  }
}

module.exports = {
  AI_Reading,
};
