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

// ---- DeepSeek 設定（一般情境備援、六爻主力） ----
// 用 OpenAI 相容 SDK + custom baseURL，走 chat.completions（不是 Responses API）
// Lazy init：避免 .env 沒設 DEEPSEEK_API_KEY 時 server 啟動就炸
let _deepseek = null;
function getDeepSeekClient() {
  if (_deepseek) return _deepseek;
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }
  _deepseek = new OpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
  return _deepseek;
}

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

// ---- DeepSeek（chat.completions 風格） ----
// model + thinking + reasoning_effort 都由 env 控制
async function callDeepSeek(userPrompt, systemPrompt) {
  const deepseek = getDeepSeekClient(); // 沒設 key 會 throw，由上層 tryDeepSeek 接住

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

  // 推理參數（依模型支援度）
  // - deepseek-v4-pro 等支援 thinking + reasoning_effort
  // - deepseek-chat 不支援 → DEEPSEEK_THINKING=false 關掉
  const useThinking = (process.env.DEEPSEEK_THINKING || "true") === "true";

  const params = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: false,
  };

  if (useThinking) {
    params.thinking = { type: "enabled" };
    params.reasoning_effort = process.env.DEEPSEEK_REASONING_EFFORT || "high";
  }

  const resp = await deepseek.chat.completions.create(params);
  const text = resp.choices?.[0]?.message?.content?.trim() || defaultFailText();

  // ✅ Token log（注意：DeepSeek 用 prompt_tokens/completion_tokens 命名）
  const u = resp.usage || {};
  console.log(
    `[AI_USAGE][DeepSeek] model=${model} prompt=${
      u.prompt_tokens ?? "?"
    } completion=${u.completion_tokens ?? "?"} total=${u.total_tokens ?? "?"}`
  );

  console.log(`[AI_Reading][DeepSeek][${model}] 發送成功`);
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

/* =========================
   小工具：嘗試 AI_MODELS chain（依順序，自動 dispatch）
   - 模型名 deepseek-* → 走 DeepSeek client
   - 其他（gpt-*, o1-*, o3-* 等）→ 走 OpenAI client
   - 全失敗回傳 { _failed, lastErr }
========================== */
function dispatchByModel(model, userPrompt, systemPrompt) {
  // deepseek-* 走 DeepSeek client（temp 覆寫 env model 給 callDeepSeek 用）
  if (/^deepseek[-_]/i.test(model)) {
    const orig = process.env.DEEPSEEK_MODEL;
    process.env.DEEPSEEK_MODEL = model;
    return callDeepSeek(userPrompt, systemPrompt).finally(() => {
      // 還原原本 env（避免 LiuYao path 也呼叫時被覆蓋）
      if (orig === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = orig;
    });
  }
  // 其他模型 → OpenAI Responses API
  return callOpenAI(model, userPrompt, systemPrompt);
}

async function tryModelChain(userPrompt, systemPrompt, tag = "AI_Reading") {
  const chain = getModelChain();
  let lastErr = null;

  for (const model of chain) {
    try {
      return await dispatchByModel(model, userPrompt, systemPrompt);
    } catch (err) {
      lastErr = err;
      const code = err?.status || err?.code || "";

      if (isQuotaOrRateLimit(err)) {
        console.warn(`[${tag}] ${model} 額度/限流（${code}）→ 換下一個`);
      } else if (isModelNotFound(err)) {
        console.warn(
          `[${tag}] ${model} 模型不存在/無權限（${code}）→ 換下一個`
        );
      } else {
        console.warn(`[${tag}] ${model} 其它錯誤（${code}）→ 換下一個`);
      }
    }
  }

  return { _failed: true, lastErr };
}

/* =========================
   小工具：嘗試 DeepSeek（單次）
   - 失敗回 { _failed, err }
========================== */
async function tryDeepSeek(userPrompt, systemPrompt, tag = "AI_Reading") {
  try {
    return await callDeepSeek(userPrompt, systemPrompt);
  } catch (err) {
    const code = err?.status || err?.code || "";
    if (isQuotaOrRateLimit(err)) {
      console.warn(`[${tag}] DeepSeek 額度/限流（${code}）→ fallback`);
    } else if (isModelNotFound(err)) {
      console.warn(`[${tag}] DeepSeek 模型不存在/無權限（${code}）→ fallback`);
    } else {
      console.warn(
        `[${tag}] DeepSeek 其它錯誤（${code} / ${err?.message || ""}）→ fallback`
      );
    }
    return { _failed: true, err };
  }
}

/* =========================
   小工具：保底 Gemini + 最終 fallback 文字
========================== */
async function finalGeminiFallback(userPrompt, systemPrompt, lastErr, tag) {
  try {
    console.warn(`[${tag}] 改用 Gemini`);
    return await callGemini(userPrompt, systemPrompt);
  } catch (err) {
    console.error(`[${tag}] 全部模型都失敗，回傳保底文字。最後錯誤：`, lastErr || err);
    return "我這邊在幫你看盤的時候小當機了一下，可以晚點再試一次，好嗎？";
  }
}

// ---- 對外：一般情境統一入口 ----
// 完全依照 AI_MODELS chain 順序（含 deepseek-*）→ Gemini
// 例：AI_MODELS=gpt-5.1,deepseek-v4-pro,gpt-4o-mini
//      → 5.1 失敗 → deepseek 試 → 失敗 → 4o-mini → 全失敗 → Gemini
async function AI_Reading(userPrompt, systemPrompt) {
  const r = await tryModelChain(userPrompt, systemPrompt, "AI_Reading");
  if (typeof r === "string") return r;
  return finalGeminiFallback(
    userPrompt,
    systemPrompt,
    r.lastErr,
    "AI_Reading"
  );
}

// ---- 對外：六爻專用入口 ----
// 強制 DeepSeek 優先 → 再走 AI_MODELS chain → Gemini
// （即使 AI_MODELS 沒有 deepseek，六爻仍會先試 DeepSeek）
async function AI_Reading_LiuYao(userPrompt, systemPrompt) {
  // 1) DeepSeek 主力
  const r1 = await tryDeepSeek(userPrompt, systemPrompt, "AI_Reading_LiuYao");
  if (typeof r1 === "string") return r1;

  // 2) AI_MODELS chain 備援
  // 註：如果 chain 內也有 deepseek-*，會再被 dispatch 試一次。
  // 通常會跟剛才同樣失敗，但若是暫時性錯誤可能成功，視為合理重試。
  console.warn("[AI_Reading_LiuYao] DeepSeek 失敗，改走 AI_MODELS chain");
  const r2 = await tryModelChain(
    userPrompt,
    systemPrompt,
    "AI_Reading_LiuYao"
  );
  if (typeof r2 === "string") return r2;

  // 3) Gemini 保底
  return finalGeminiFallback(
    userPrompt,
    systemPrompt,
    r1.err || r2.lastErr,
    "AI_Reading_LiuYao"
  );
}

module.exports = {
  AI_Reading,
  AI_Reading_LiuYao,
};
