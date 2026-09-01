const fs = require("fs");
const path = require("path");
const { AI_Reading_DeepSeekPro } = require("./aiClient");
const { createBaziChart, createZiweiChart } = require("./toolsChartEngine");

const PROMPTS_DIR = path.join(__dirname, "prompts");
const TEMPLATES_DIR = path.join(__dirname, "templates");

const DIM_KEYS = ["career", "wealth", "marriage", "children", "family", "health"];
const DIM_LABELS = {
  career: "事業",
  wealth: "財運",
  marriage: "婚戀",
  children: "子女",
  family: "六親",
  health: "健康",
};

function readText(filePath) {
  return fs.readFileSync(filePath, "utf-8");
}

function prompt(name) {
  return readText(path.join(PROMPTS_DIR, name));
}

function template(name) {
  return readText(path.join(TEMPLATES_DIR, name));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObject(text) {
  const raw = stripCodeFence(text);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("POSTER_JSON_NOT_FOUND");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function listOfLength(value, length, fallbackFactory) {
  const input = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => input[index] || fallbackFactory(index));
}

function normalizePosterJson(input, charts) {
  const currentYear = new Date().getFullYear();
  const currentAge = Math.max(1, currentYear - Number(charts.baziChart.birth.year) + 1);
  const fallbackDim = (label) => ({
    bazi: "需合原局與大運觀察",
    ziwei: "需合命宮與大限觀察",
    verdict: "⚠ 部分衝突",
    verdict_class: "verdict-partial",
    fused: `${label}先保守評估`,
  });
  const dim = {};
  DIM_KEYS.forEach((key) => {
    const item = input?.dim?.[key] || {};
    dim[key] = {
      bazi: item.bazi || fallbackDim(DIM_LABELS[key]).bazi,
      ziwei: item.ziwei || fallbackDim(DIM_LABELS[key]).ziwei,
      verdict: item.verdict || fallbackDim(DIM_LABELS[key]).verdict,
      verdict_class: ["verdict-yes", "verdict-partial", "verdict-no"].includes(item.verdict_class)
        ? item.verdict_class
        : "verdict-partial",
      fused: item.fused || fallbackDim(DIM_LABELS[key]).fused,
    };
  });

  return {
    meta: {
      archetype_name: input?.meta?.archetype_name || "雙盤印證",
      axis_oneliner: input?.meta?.axis_oneliner || "八字紫微交叉看人生主軸",
    },
    axes: {
      bazi_main: input?.axes?.bazi_main || `${charts.baziChart.dayMaster}${charts.baziChart.dayMasterElement}日主，需合五行大運看格局。`,
      ziwei_main: input?.axes?.ziwei_main || `${charts.ziweiChart.fiveElementsClass || "紫微命盤"}，需合命宮身宮看主軸。`,
    },
    consistency: input?.consistency || "互補印證",
    strengths: listOfLength(input?.strengths, 3, () => ({
      title: "可發揮",
      desc: "優勢需配合行動放大",
    })),
    weaknesses: listOfLength(input?.weaknesses, 3, () => ({
      title: "需留意",
      desc: "課題需用現實回饋修正",
    })),
    section_01: {
      text: input?.section_01?.text || "兩盤資料可作為交叉參考，但仍需以實際人生選擇與客觀條件修正判斷。",
      word_count: Number(input?.section_01?.word_count || 0),
    },
    section_02: {
      conclusion: input?.section_02?.conclusion || "目前階段需同時觀察八字大運與紫微大限，不宜單看一套系統下定論。",
    },
    dim,
    conflicts: listOfLength(input?.conflicts, 3, () => ({
      point: "待觀察",
      bazi: "訊號不明",
      ziwei: "訊號不明",
      impact: "低",
      impact_class: "low",
      advice: "以實際回饋修正",
    })),
    final: {
      life_axis: input?.final?.life_axis || "穩住主軸，順勢調整",
      nodes: listOfLength(input?.final?.nodes, 5, (index) => ({
        age: currentAge + index,
        year: currentYear + index,
        event: "持續觀察階段變化",
      })),
      risks: listOfLength(input?.final?.risks, 3, () => ({
        range: `${currentYear}-${currentYear + 1}`,
        desc: "重大決策先保守驗證",
      })),
      leverage: listOfLength(input?.final?.leverage, 2, () => ({
        title: "穩定累積",
        desc: "把可控資源集中在長期方向",
      })),
      advice: listOfLength(input?.final?.advice, 4, () => "重大選擇先做資料驗證"),
    },
    confidence: {
      bazi_level: input?.confidence?.bazi_level || "中",
      bazi_score: input?.confidence?.bazi_score || "0.60",
      ziwei_level: input?.confidence?.ziwei_level || "中",
      ziwei_score: input?.confidence?.ziwei_score || "0.60",
      consistency_level: input?.confidence?.consistency_level || "中",
      consistency_score: input?.confidence?.consistency_score || "0.60",
      stability_level: input?.confidence?.stability_level || "中",
      stability_score: input?.confidence?.stability_score || "0.60",
      note: input?.confidence?.note || "免費與付費報告皆需配合實際情境判讀。",
    },
  };
}

function getByPath(obj, dotted) {
  return dotted.split(".").reduce((acc, part) => {
    if (acc === null || acc === undefined) return "";
    return acc[part];
  }, obj);
}

function renderSimpleTemplate(tpl, data) {
  return tpl.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_, key) => escapeHtml(getByPath(data, key)));
}

function ziweiGridHtml(ziweiChart) {
  const areaMap = {
    巳: "si",
    午: "wu",
    未: "wei",
    申: "shen",
    辰: "chen",
    酉: "you",
    卯: "mao",
    戌: "xu",
    寅: "yin",
    丑: "chou",
    子: "zi",
    亥: "hai",
  };
  return (ziweiChart.grid || [])
    .flat()
    .filter(Boolean)
    .map((cell) => {
      const p = cell.palace || {};
      const stars = (p.majorStars || []).map((s) => s.label || s.name).join("、") || "空宮";
      const flags = [p.isSoulPalace ? "命" : "", p.isBodyPalace ? "身" : ""].filter(Boolean).join(" ");
      const klass = p.isSoulPalace ? "palace ming" : "palace";
      return `<div class="${klass}" style="grid-area:${areaMap[cell.branch] || "auto"}"><strong>${escapeHtml(cell.branch)} ${escapeHtml(p.name || "")} ${escapeHtml(flags)}</strong><br>${escapeHtml(p.heavenlyStem || "")}${escapeHtml(p.earthlyBranch || "")}<br>${escapeHtml(stars)}</div>`;
    })
    .join("");
}

function baziPillarsHtml(baziChart) {
  return (baziChart.pillars || [])
    .map((p) => `<div class="pillar"><span>${escapeHtml(p.label)}</span><div class="gz">${escapeHtml(p.ganzhi)}</div><small>${escapeHtml(p.tenGod || "")}</small><br><small>${escapeHtml(p.naYin || "")}</small></div>`)
    .join("");
}

function renderPosterHtml({ posterJson, baziChart, ziweiChart, zongheAnalysis }) {
  const rawTokens = {
    __ZIWEI_GRID_HTML__: ziweiGridHtml(ziweiChart),
    __BAZI_PILLARS_HTML__: baziPillarsHtml(baziChart),
    __STRENGTHS_HTML__: posterJson.strengths
      .map((item) => `<li><strong>${escapeHtml(item.title)}</strong>：${escapeHtml(item.desc)}</li>`)
      .join(""),
    __WEAKNESSES_HTML__: posterJson.weaknesses
      .map((item) => `<li><strong>${escapeHtml(item.title)}</strong>：${escapeHtml(item.desc)}</li>`)
      .join(""),
    __ZONGHE_ANALYSIS__: escapeHtml(zongheAnalysis),
  };
  const dimsHtml = DIM_KEYS.map((key) => {
    const item = posterJson.dim[key];
    return `<div class="dim"><strong>${escapeHtml(DIM_LABELS[key])}</strong><p>${escapeHtml(item.fused)}</p><span class="${escapeHtml(item.verdict_class)}">${escapeHtml(item.verdict)}</span><p class="muted">八字：${escapeHtml(item.bazi)}<br>紫微：${escapeHtml(item.ziwei)}</p></div>`;
  }).join("");
  const nodesHtml = posterJson.final.nodes
    .map((item) => `<li>${escapeHtml(item.age)}歲（${escapeHtml(item.year)}）：${escapeHtml(item.event)}</li>`)
    .join("");
  const risksHtml = posterJson.final.risks
    .map((item) => `<li>${escapeHtml(item.range)}：${escapeHtml(item.desc)}</li>`)
    .join("");
  const leverageHtml = posterJson.final.leverage
    .map((item) => `<li><strong>${escapeHtml(item.title)}</strong>：${escapeHtml(item.desc)}</li>`)
    .join("");
  const currentDayun = baziChart.currentDayun
    ? `${baziChart.currentDayun.startAge}-${baziChart.currentDayun.endAge}歲 ${baziChart.currentDayun.ganzhi}`
    : "未載入";

  Object.assign(rawTokens, {
    __DIMS_HTML__: dimsHtml,
    __NODES_HTML__: nodesHtml,
    __RISKS_HTML__: risksHtml,
    __LEVERAGE_HTML__: leverageHtml,
  });
  let tpl = template("report-zonghe-poster.html")
    .replace("{{ziweiGridHtml}}", "__ZIWEI_GRID_HTML__")
    .replace("{{baziPillarsHtml}}", "__BAZI_PILLARS_HTML__")
    .replace("{{strengthsHtml}}", "__STRENGTHS_HTML__")
    .replace("{{weaknessesHtml}}", "__WEAKNESSES_HTML__")
    .replace("{{dimsHtml}}", "__DIMS_HTML__")
    .replace("{{nodesHtml}}", "__NODES_HTML__")
    .replace("{{risksHtml}}", "__RISKS_HTML__")
    .replace("{{leverageHtml}}", "__LEVERAGE_HTML__")
    .replace("{{zongheAnalysis}}", "__ZONGHE_ANALYSIS__");

  let html = renderSimpleTemplate(tpl, {
    ...posterJson,
    birth: baziChart.birth,
    bazi: baziChart,
    ziwei: ziweiChart,
    currentDayun,
  });
  Object.entries(rawTokens).forEach(([token, value]) => {
    html = html.replace(token, value);
  });
  return html;
}

function focusText(focus) {
  const map = {
    overall: "整體命盤",
    career: "工作事業",
    love: "感情婚姻",
    wealth: "財運規劃",
    year: "大運流年",
  };
  return map[focus] || focus || "整體命盤";
}

async function createFreeToolReading({ tool, birthInput, focus }) {
  const chart =
    tool === "bazi"
      ? await createBaziChart(birthInput)
      : await createZiweiChart(birthInput);
  const systemPrompt = prompt(tool === "bazi" ? "web-bazi-free-prompt.md" : "web-ziwei-free-prompt.md");
  const userPrompt = [
    `使用者關注方向：${focusText(focus)}`,
    "",
    "命盤摘要：",
    chart.chartText,
  ].join("\n");
  const text = await AI_Reading_DeepSeekPro(userPrompt, systemPrompt);
  return { chart, text };
}

async function generateProReport(report) {
  const birthInput = report.birth || {};
  const baziChart = await createBaziChart(birthInput);
  const ziweiChart = await createZiweiChart(birthInput);
  const sharedInput = [
    `使用者 Email：${report.email}`,
    `關注方向：${focusText(report.focus)}`,
    "",
    "八字文字盤：",
    baziChart.chartText,
    "",
    "紫微文字盤：",
    ziweiChart.chartText,
  ].join("\n");

  const baziAnalysis = await AI_Reading_DeepSeekPro(sharedInput, prompt("web-bazi-pro-prompt.md"));
  const ziweiAnalysis = await AI_Reading_DeepSeekPro(sharedInput, prompt("web-ziwei-pro-prompt.md"));
  const zongheAnalysis = await AI_Reading_DeepSeekPro(
    [
      sharedInput,
      "",
      "八字獨立分析：",
      baziAnalysis,
      "",
      "紫微獨立分析：",
      ziweiAnalysis,
    ].join("\n"),
    prompt("zonghe-yinzheng-prompt.md"),
  );
  const posterRaw = await AI_Reading_DeepSeekPro(
    [
      sharedInput,
      "",
      "綜合長文：",
      zongheAnalysis,
    ].join("\n"),
    prompt("zonghe-poster.md"),
  );
  const posterJson = normalizePosterJson(extractJsonObject(posterRaw), { baziChart, ziweiChart });
  const html = renderPosterHtml({ posterJson, baziChart, ziweiChart, zongheAnalysis });

  return {
    baziChart,
    ziweiChart,
    baziAnalysis,
    ziweiAnalysis,
    zongheAnalysis,
    posterJson,
    html,
  };
}

module.exports = {
  createFreeToolReading,
  generateProReport,
};
