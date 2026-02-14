/* ==========================================================
✅ qimenEngine.js
目的：
- 核心運算引擎
- 負責：數字轉時間 -> 起盤 -> 取用神 -> 產出資料給 AI
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
原理：
- 設定時間範圍 (2024~2030)
- 將用戶數字 (例如 888888) 換算成時間軸上的百分比位置
- 確保同一組數字永遠對應同一個盤
==========================================================
*/
function mapNumberToDate(numStr) {
  // 1. 設定範圍 (可自行調整)
  const start = new Date("2024-01-01T00:00:00").getTime();
  const end = new Date("2030-12-31T23:59:59").getTime();
  const totalSpan = end - start;

  // 2. 處理數字 (防呆：轉成整數，若非數字則隨機)
  let n = parseInt(numStr, 10);
  if (isNaN(n)) {
    n = Math.floor(Math.random() * 1000000); // 若亂打字，就隨機給一個
  }

  // 3. 歸一化：假設最大值是 999999 (6位數)
  // 用 % 1000000 確保只取後6位，避免爆掉
  // 這樣 1 和 1000001 會是一樣的結果 (循環)
  const ratio = (n % 1000000) / 999999;

  // 4. 算出時間戳
  const targetTimestamp = start + Math.floor(totalSpan * ratio);

  return new Date(targetTimestamp);
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
✅ 對外主函式：輸入問題 + 數字 → 回傳 payload
🔴 修改：新增 userNumber 參數，用來決定起盤時間
==========================================================
*/
function buildQimenPayloadFromQuestion(userQuestion, userNumber) {
  /* 1. 決定起盤時間 (時空數邏輯) */
  let targetDate;
  if (userNumber) {
    // 有數字 -> 映射
    targetDate = mapNumberToDate(userNumber);
  } else {
    // 沒數字(防呆) -> 純隨機
    const start = new Date("2024-01-01T00:00:00").getTime();
    const end = new Date("2030-12-31T23:59:59").getTime();
    targetDate = new Date(start + Math.random() * (end - start));
  }

  /* 2. 轉成 yyyyMMddHH 格式 */
  const timeStr = formatDateToQimenStr(targetDate);

  /* 3. 呼叫套件起盤 */
  const chart = generateChartByDatetime(timeStr);

  // 轉 object
  const qimen = chartToObject(chart);

  /* 4. 核心資料分析 */
  const core = extractCore(qimen);

  /* 5. 空亡判斷 */
  const voidBranches = getVoidBranches(qimen["旬首"]);
  const voidPalaces = getVoidPalaces(voidBranches);
  const obsPalace = core["觀測宮資訊"]["宮位"];
  const obsHasVoid = voidPalaces.includes(obsPalace);
  const obsSummary = buildObservationSummary(core, obsHasVoid);

  /* 6. 自動分類與取用神 */
  const qType = classifyQuestion(userQuestion);
  const useDoors = getDoorByQuestionType(qType);

  const doorInfos = useDoors
    .map((doorName) => {
      const info = findDoorPalace(qimen, doorName);
      return info ? { 門: doorName, ...info } : null;
    })
    .filter(Boolean);

  /* 7. 回傳結果 */
  return {
    userQuestion,
    userNumber,
    qType,
    useDoors,
    doorInfos,

    // 記錄時間給前端顯示用
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
