/* ==========================================================
✅ qimenEngine.js
目的：
- 把「奇門排盤 + 規則分類 + 用神門 + 空亡 + 摘要 + Prompt」集中管理
- server.js 只呼叫這裡拿結果，避免 server.js 變屎山
==========================================================
*/

/* 🔴 修改點 1：改用 generateChartByDatetime */
const { generateChartByDatetime, chartToObject } = require("qimen-dunjia");

/* ==========================================================
✅ 常數：地支 → 宮位（洛書九宮固定對照）
==========================================================
*/
const BRANCH_TO_PALACE = {
  子: "坎",
  丑: "艮",
  寅: "艮",
  卯: "震",
  辰: "巽",
  巳: "巽",
  午: "離",
  未: "坤",
  申: "坤",
  酉: "兌",
  戌: "乾",
  亥: "乾",
};

/* ==========================================================
✅ 工具：產生隨機時間（隨機占卜核心）
目的：
- 為了讓不同人、同時間問卜能得到不同結果
- 我們隨機抓取 2024~2030 年之間的任一時刻來起盤
==========================================================
*/
function getRandomDate() {
  const start = new Date("2024-01-01T00:00:00").getTime();
  const end = new Date("2030-12-31T23:59:59").getTime();
  const randomTimestamp = start + Math.random() * (end - start);
  return new Date(randomTimestamp);
}

/* ==========================================================
✅ 工具：日期轉字串 (yyyyMMddHH)
目的：
- 配合 generateChartByDatetime 格式要求
==========================================================
*/
function formatDateToQimenStr(date) {
  const y = date.getFullYear();
  // 月份從 0 開始，所以要 +1；padStart 補零確保兩位數
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}${m}${d}${h}`;
}

/* ==========================================================
✅ 工具：旬首 → 空亡地支（固定規則）
==========================================================
*/
function getVoidBranches(xunshou) {
  const map = {
    甲子: ["戌", "亥"],
    甲戌: ["申", "酉"],
    甲申: ["午", "未"],
    甲午: ["辰", "巳"],
    甲辰: ["寅", "卯"],
    甲寅: ["子", "丑"],
  };
  return map[xunshou] || [];
}

/* ==========================================================
✅ 工具：空亡地支 → 空亡宮位
==========================================================
*/
function getVoidPalaces(voidBranches) {
  return voidBranches.map((b) => BRANCH_TO_PALACE[b]).filter(Boolean);
}

/* ==========================================================
✅ 工具：抽取核心資料（值符宮為觀測宮）
==========================================================
*/
function extractCore(q) {
  const zhifuPalace = q["值符落宮"];
  const zhishiPalace = q["值使落宮"];

  const palaceIndexMap = {};
  q["方位"].forEach((p, i) => {
    palaceIndexMap[p] = i;
  });

  const obsIndex = palaceIndexMap[zhifuPalace];

  return {
    節氣: q["節氣"],
    局數: q["局數"],
    陰陽: q["陰陽"],

    值符星: q["值符"],
    值符宮: zhifuPalace,

    值使門: q["值使"],
    值使宮: zhishiPalace,

    觀測宮資訊: {
      宮位: zhifuPalace,
      八神: q["八神"][obsIndex],
      九星: q["九星"][obsIndex],
      八門: q["天門"][obsIndex],
      天盤: q["天盤"][obsIndex],
      地盤: q["地盤"][obsIndex],
    },
  };
}

/* ==========================================================
✅ 工具：組一行「值符觀測宮摘要」
==========================================================
*/
function buildObservationSummary(core, obsHasVoid) {
  const obs = core["觀測宮資訊"];
  const part = `${obs["八神"]}+${obs["九星"]}+${obs["八門"]}`;
  const voidText = obsHasVoid ? "有旬空" : "無旬空";
  return `值符觀測｜${part}｜落${obs["宮位"]}｜${voidText}`;
}

/* ==========================================================
✅ 工具：找某門落在哪一宮（例如：開門、死門）
==========================================================
*/
function findDoorPalace(q, doorName) {
  const idx = q["天門"].findIndex((d) => d === doorName);
  if (idx === -1) return null;

  return {
    宮位: q["方位"][idx],
    八神: q["八神"][idx],
    九星: q["九星"][idx],
    八門: q["天門"][idx],
    天盤: q["天盤"][idx],
    地盤: q["地盤"][idx],
  };
}

/* ==========================================================
✅ 工具：問題文字 → 類型（題庫導向，可維護）
==========================================================
*/
function classifyQuestion(text) {
  const t = String(text || "")
    .trim()
    .toLowerCase();

  const CATEGORIES = [
    {
      type: "命名",
      priority: 120,
      keywords: ["名字", "姓名", "改名", "取名", "命名", "名字好嗎"],
    },
    {
      type: "不動產",
      priority: 110,
      keywords: ["房子", "房屋", "買房", "看房", "賣房", "搬家"],
    },
    {
      type: "健康",
      priority: 105,
      keywords: ["健康", "身體", "疾病", "生病", "手術", "住院", "痛"],
    },
    {
      type: "感情",
      priority: 100,
      keywords: [
        "復合",
        "前任",
        "曖昧",
        "感情",
        "婚姻",
        "結婚",
        "喜歡",
        "離婚",
        "桃花",
        "伴侶",
        "男友",
        "女友",
        "對象",
        "追",
      ],
      excludes: ["換工作", "面試"],
    },
    {
      type: "家庭",
      priority: 95,
      keywords: ["父母", "媽媽", "爸爸", "家人", "孩子", "小孩", "學業"],
    },
    {
      type: "財運",
      priority: 90,
      keywords: ["財運", "偏財", "收入", "賺錢", "股票", "投資"],
    },
    {
      type: "工作",
      priority: 80,
      keywords: [
        "公司",
        "升遷",
        "加薪",
        "換工作",
        "轉職",
        "離職",
        "事業",
        "創業",
        "職業",
        "工作",
        "offer",
        "面試",
      ],
      excludes: ["復合", "前任", "結婚"],
    },
    {
      type: "運勢",
      priority: 70,
      keywords: ["運勢", "流年", "今年", "明年", "今日", "運氣"],
    },
  ];

  const sorted = [...CATEGORIES].sort((a, b) => b.priority - a.priority);

  for (const c of sorted) {
    const hit = c.keywords.some((k) => t.includes(k));
    if (!hit) continue;
    const excluded = (c.excludes || []).some((x) => t.includes(x));
    if (excluded) continue;
    return c.type;
  }

  return "工作";
}

/* ==========================================================
✅ 工具：類型 → 用神門
==========================================================
*/
function getDoorByQuestionType(type) {
  const map = {
    感情: ["休門"],
    工作: ["開門"],
    財運: ["生門"],
    運勢: ["景門", "開門", "杜門"],
    家庭: ["休門"],
    不動產: ["開門"],
    命名: ["景門"],
    健康: ["死門"],
  };
  return map[type] || ["開門"];
}

/* ==========================================================
✅ 對外主函式：輸入問題 → 回傳「給 AI/給 LINE 用」的 payload
==========================================================
*/
function buildQimenPayloadFromQuestion(userQuestion) {
  /* 🔴 修改點 2：產生隨機時間 -> 轉字串 -> 呼叫 generateChartByDatetime */
  const randomDate = getRandomDate();
  const timeStr = formatDateToQimenStr(randomDate);

  // 呼叫函式
  const chart = generateChartByDatetime(timeStr);

  // 轉 object
  const qimen = chartToObject(chart);

  /* ✅ 核心資料 */
  const core = extractCore(qimen);

  /* ✅ 空亡（地支/宮位） */
  const voidBranches = getVoidBranches(qimen["旬首"]);
  const voidPalaces = getVoidPalaces(voidBranches);

  /* ✅ 觀測宮旬空 */
  const obsPalace = core["觀測宮資訊"]["宮位"];
  const obsHasVoid = voidPalaces.includes(obsPalace);

  /* ✅ 觀測宮摘要 */
  const obsSummary = buildObservationSummary(core, obsHasVoid);

  /* ✅ 自動分類 → 用神門 */
  const qType = classifyQuestion(userQuestion);
  const useDoors = getDoorByQuestionType(qType);

  /* ✅ 逐門找落宮資訊 */
  const doorInfos = useDoors
    .map((doorName) => {
      const info = findDoorPalace(qimen, doorName);
      return info ? { 門: doorName, ...info } : null;
    })
    .filter(Boolean);

  /* ✅ 回傳 payload */
  return {
    userQuestion,
    qType,
    useDoors,
    doorInfos,

    // 🔴 記錄起盤時間字串，方便除錯或顯示
    chartTimeStr: timeStr,

    qimen,
    core,
    obsSummary,
    obsHasVoid,
    voidBranches,
    voidPalaces,
  };
}

module.exports = {
  buildQimenPayloadFromQuestion,
};
