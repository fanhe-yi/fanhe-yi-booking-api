/* ==========================================================
✅ qimenEngine.js (Bug Fix 版)
目的：
- 奇門排盤核心引擎
- 🔴 修正：加入 safeGenerateChart 機制，解決「未知的節氣：小满」報錯問題
==========================================================
*/

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
✅ 工具：將數字映射到指定年份範圍內的時間 (時空數核心)
==========================================================
*/
function mapNumberToDate(numStr) {
  const start = new Date("2024-01-01T00:00:00").getTime();
  const end = new Date("2030-12-31T23:59:59").getTime();
  const totalSpan = end - start;

  let n = parseInt(numStr, 10);
  if (isNaN(n)) {
    n = Math.floor(Math.random() * 1000000);
  }

  // 歸一化
  const ratio = (n % 1000000) / 999999;
  const targetTimestamp = start + Math.floor(totalSpan * ratio);

  return new Date(targetTimestamp);
}

/* ==========================================================
✅ 工具：日期轉字串 (yyyyMMddHH)
==========================================================
*/
function formatDateToQimenStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}${m}${d}${h}`;
}

/* ==========================================================
✅ 工具：安全起盤 (Safe Generate)
🔴 核心修正邏輯：
- 當 generateChartByDatetime 拋出錯誤（如：未知的節氣）時
- 自動將時間往後推 24 小時，再次嘗試
- 最多重試 10 次，確保不會無限迴圈
==========================================================
*/
function safeGenerateChart(targetDate) {
  let attempt = 0;
  // 複製一份時間物件，避免汙染原始變數
  let currentDate = new Date(targetDate.getTime());
  const MAX_ATTEMPTS = 5;

  while (attempt < MAX_ATTEMPTS) {
    try {
      // 1. 轉字串
      const timeStr = formatDateToQimenStr(currentDate);

      // 2. 嘗試起盤 (這裡可能會報錯)
      const chart = generateChartByDatetime(timeStr);

      // 3. 如果成功，回傳圖表與最終使用的時間字串
      return { chart, usedTimeStr: timeStr };
    } catch (err) {
      console.warn(
        `[QIMEN] 起盤遇到 Bug (嘗試 ${attempt + 1}/${MAX_ATTEMPTS})，原因：${err.message}`,
      );

      // 4. 失敗處理：把時間往後推 24 小時 (避開那個有 Bug 的節氣點)
      currentDate.setTime(currentDate.getTime() + 16 * 24 * 60 * 60 * 1000);
      attempt++;
    }
  }

  // 如果試了 10 次都失敗 (機率極低)，丟出錯誤
  throw new Error("起盤失敗：無法避開節氣錯誤，請稍後再試。");
}

/* ==========================================================
✅ 工具：相關 Helper (維持不變)
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

function getVoidPalaces(voidBranches) {
  return voidBranches.map((b) => BRANCH_TO_PALACE[b]).filter(Boolean);
}

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

function buildObservationSummary(core, obsHasVoid) {
  const obs = core["觀測宮資訊"];
  const part = `${obs["八神"]}+${obs["九星"]}+${obs["八門"]}`;
  const voidText = obsHasVoid ? "有旬空" : "無旬空";
  return `值符觀測｜${part}｜落${obs["宮位"]}｜${voidText}`;
}

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
        "老公",
        "老婆",
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
  return "運勢";
}

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
✅ 對外主函式：輸入問題 + 數字 → 回傳 payload
🔴 修改：改用 safeGenerateChart 替代原本的直接呼叫
==========================================================
*/
function buildQimenPayloadFromQuestion(userQuestion, userNumber) {
  /* 1. 決定起盤初始時間 */
  let targetDate;
  if (userNumber) {
    targetDate = mapNumberToDate(userNumber);
  } else {
    // 防呆：如果沒數字，隨機給一個
    const start = new Date("2024-01-01T00:00:00").getTime();
    const end = new Date("2030-12-31T23:59:59").getTime();
    targetDate = new Date(start + Math.random() * (end - start));
  }

  /* 🔴 2. 安全起盤 (失敗會自動 retry) 
  解構取出 chart (盤物件) 和 usedTimeStr (最終使用的時間字串)
  */
  const { chart, usedTimeStr } = safeGenerateChart(targetDate);

  /* 3. 轉 object */
  const qimen = chartToObject(chart);

  /* 4. 後續邏輯不變 */
  const core = extractCore(qimen);
  const voidBranches = getVoidBranches(qimen["旬首"]);
  const voidPalaces = getVoidPalaces(voidBranches);
  const obsPalace = core["觀測宮資訊"]["宮位"];
  const obsHasVoid = voidPalaces.includes(obsPalace);
  const obsSummary = buildObservationSummary(core, obsHasVoid);

  const qType = classifyQuestion(userQuestion);
  const useDoors = getDoorByQuestionType(qType);

  const doorInfos = useDoors
    .map((doorName) => {
      const info = findDoorPalace(qimen, doorName);
      return info ? { 門: doorName, ...info } : null;
    })
    .filter(Boolean);

  return {
    userQuestion,
    userNumber,
    qType,
    useDoors,
    doorInfos,

    // 🔴 回傳實際成功起盤的時間 (若有修正，這裡會顯示修正後的時間)
    chartTimeStr: usedTimeStr,

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
