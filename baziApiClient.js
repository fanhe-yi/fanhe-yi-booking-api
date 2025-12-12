// baziApiClient.js
// 專門負責：從 birthObj → 呼叫 youhualao API → 組成給 AI 的八字摘要文字

const YOUHUALAO_BASE_URL = "http://www.youhualao.com/api/";
const YOUHUALAO_API_KEY = process.env.YOUHUALAO_API_KEY || "test";

// 如果你是 Node 18+ 可以直接用全域 fetch
// 若不是，請 npm install node-fetch 再打開底下兩行：
// const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/**
 * 將地支時辰轉換成大約的整點小時（取該時辰中間值）
 * 例如：子 → 23, 丑 → 1, 寅 → 3 ...
 */
function branchToHour(branch) {
  const map = {
    子: 23,
    丑: 1,
    寅: 3,
    卯: 5,
    辰: 7,
    巳: 9,
    午: 11,
    未: 13,
    申: 15,
    酉: 17,
    戌: 19,
    亥: 21,
  };
  return map[branch] ?? 12; // 沒對到就先當中午
}

/**
 * 從 birthObj 解析 youhualao API 需要的 y/m/d/h/mi/sex
 *
 * birthObj 應該長這樣：
 * {
 *   raw: "原始字串",
 *   date: "YYYY-MM-DD",
 *   timeType: "hm" | "branch" | "unknown",
 *   time?: "HH:mm",
 *   branch?: "子" | "丑" | ...,
 *   sex: 1 | 0
 * }
 */
function extractApiParamsFromBirth(birthObj) {
  const { date, timeType, time, branch, sex } = birthObj;

  const [yStr, mStr, dStr] = date.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);

  let h = 12;
  let mi = 0;

  if (timeType === "hm" && time) {
    const [hh, mm] = time.split(":");
    h = Number(hh);
    mi = Number(mm || "0");
  } else if (timeType === "branch" && branch) {
    h = branchToHour(branch);
    mi = 0;
  } else if (timeType === "unknown") {
    // 沒提供時辰：先給中間值，但後面會跟 AI 說「以三柱為主」
    h = 12;
    mi = 0;
  }

  const sexVal = typeof sex === "number" ? sex : 1; // 沒給先當男命

  return { y, m, d, h, mi, sex: sexVal };
}

/**
 * 實際呼叫 youhualao 八字 API，回傳 raw/ganzhi/shishen/canggan
 */
async function fetchBaziFromYouhualao(birthObj) {
  const { y, m, d, h, mi, sex } = extractApiParamsFromBirth(birthObj);

  const params = new URLSearchParams({
    c: "bz",
    key: YOUHUALAO_API_KEY,
    sex: String(sex),
    y: String(y),
    m: String(m),
    d: String(d),
    h: String(h),
    mi: String(mi),
    type: "1", // 1 = 公曆
  });

  const url = `${YOUHUALAO_BASE_URL}?${params.toString()}`;

  // 🔍 DEBUG：看實際打出去的 URL / 參數
  console.log("[baziApiClient] calling youhualao:", {
    url,
    params: { y, m, d, h, mi, sex },
  });

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`youhualao API 呼叫失敗，HTTP 狀態碼：${resp.status}`);
  }

  const data = await resp.json();

  // 🔍 方便 debug，先看一眼完整結構
  console.log(
    "[baziApiClient] FULL API RESPONSE:\n",
    JSON.stringify(data, null, 2)
  );

  // ✨ 關鍵：真正要的在 data.data.bazi 裡
  const core = data.data && data.data.bazi ? data.data.bazi : {};

  console.log("[baziApiClient] youhualao response (partial):", {
    ganzhi: core.ganzhi,
    shishen: core.shishen,
    hasCanggan: !!core.canggan,
  });

  const ganzhi = core.ganzhi || [];
  const shishen = core.shishen || [];
  const canggan = core.canggan || {};

  return { rawApi: data, ganzhi, shishen, canggan };
}

/**
 * 把 API 八字資料整理成：給 AI 用的摘要文字
 */
function buildBaziSummaryText(birthObj, baziData) {
  const { timeType } = birthObj;
  const { ganzhi, shishen, canggan } = baziData;

  const yearGz = ganzhi[0] || "";
  const monthGz = ganzhi[1] || "";
  const dayGz = ganzhi[2] || "";
  const hourGz = ganzhi[3] || "";

  const yearSs = shishen[0] || "";
  const monthSs = shishen[1] || "";
  const daySs = shishen[2] || "";
  const hourSs = shishen[3] || "";

  let timeDesc = "";
  if (timeType === "hm" || timeType === "branch") {
    timeDesc = "本命盤有提供時辰。";
  } else if (timeType === "unknown") {
    timeDesc = "本命盤未提供精確時辰，時柱僅供參考，解讀時以年前三柱為主。";
  }

  const hiddenLines = [];
  // 這裡直接對照你 API 裡的四個 key
  const keysMap = [
    { label: "年支", key: "cgy" },
    { label: "月支", key: "cgm" },
    { label: "日支", key: "cgd" },
    { label: "時支", key: "cgh" },
  ];

  keysMap.forEach(({ label, key }) => {
    const arr = canggan[key];
    if (Array.isArray(arr)) {
      // 有些是 ["癸 正官"," "," "]，把空字串濾掉
      const clean = arr
        .map((s) => String(s).trim())
        .filter((s) => s && s !== " ");
      if (clean.length > 0) {
        hiddenLines.push(`- ${label}藏干：${clean.join("，")}`);
      }
    }
  });

  const hiddenText =
    hiddenLines.length > 0
      ? hiddenLines.join("\n")
      : "（地支藏干資訊未完整提供或格式不同，請自由發揮但不要亂編具體藏干。）";

  const text = [
    "【八字資料】",
    "四柱干支（年 → 月 → 日 → 時）：",
    `- 年柱：${yearGz || "（無資料）"}`,
    `- 月柱：${monthGz || "（無資料）"}`,
    `- 日柱：${dayGz || "（無資料）"}`,
    `- 時柱：${hourGz || "（無資料或僅供參考）"}`,
    "",
    "四柱對應十神：",
    `- 年柱十神：${yearSs || "（無資料）"}`,
    `- 月柱十神：${monthSs || "（無資料）"}`,
    `- 日柱十神：${daySs || "（無資料）"}`,
    `- 時柱十神：${hourSs || "（無資料或僅供參考）"}`,
    "",
    "地支藏干（含十神）：",
    hiddenText,
    "",
    `時辰資訊說明：${timeDesc}`,
  ].join("\n");

  return text;
}

/**
 * 給外面用的主函式：
 * - 丟 birthObj 進來
 * - 回：{ summaryText, structured }
 */
async function getBaziSummaryForAI(birthObj) {
  const baziData = await fetchBaziFromYouhualao(birthObj);
  const summaryText = buildBaziSummaryText(birthObj, baziData);

  // 🔍 DEBUG：看給 AI 用的八字摘要文字長什麼樣//
  console.log("[baziApiClient] summaryText for AI:\n", summaryText);

  return {
    summaryText,
    structured: baziData,
  };
}

module.exports = {
  getBaziSummaryForAI,
};
