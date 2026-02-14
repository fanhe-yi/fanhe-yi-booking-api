/* ==========================================================
✅ qimenEngine.js
目的：
- 把「奇門排盤 + 規則分類 + 用神門 + 空亡 + 摘要 + Prompt」集中管理
- server.js 只呼叫這裡拿結果，避免 server.js 變屎山
==========================================================
*/

// 🔴 修改點 1：多引入 generateChart (指定時間排盤用)
const {
  generateChartNow,
  generateChart,
  chartToObject,
} = require("qimen-dunjia");

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
  // 設定隨機範圍：2024/01/01 ~ 2030/12/31
  // 保持在近代，確保節氣計算準確
  const start = new Date("2024-01-01T00:00:00").getTime();
  const end = new Date("2030-12-31T23:59:59").getTime();

  // 亂數取一個時間戳記
  const randomTimestamp = start + Math.random() * (end - start);

  return new Date(randomTimestamp);
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
      keywords: [
        "名字",
        "姓名",
        "改名",
        "取名",
        "命名",
        "這個名字",
        "名字對我",
        "名字好嗎",
      ],
      excludes: [],
    },
    {
      type: "不動產",
      priority: 110,
      keywords: [
        "房子",
        "房屋",
        "買房",
        "看房",
        "這間房子",
        "能買嗎",
        "賣掉",
        "出售",
        "賣房",
        "換屋",
      ],
      excludes: [],
    },
    {
      type: "健康",
      priority: 105,
      keywords: [
        "健康",
        "身體",
        "身體健康",
        "疾病",
        "生病",
        "病情",
        "手術",
        "住院",
        "症狀",
        "診斷",
        "恢復",
        "疼痛",
        "失眠",
        "健康狀況",
        "家人的疾病",
        "家人疾病",
        "疾病狀況",
      ],
      excludes: [],
    },
    {
      type: "感情",
      priority: 100,
      keywords: [
        "復合",
        "前任",
        "回來",
        "重新聯絡",
        "聯絡我",
        "曖昧",
        "往下一步",
        "主動表達",
        "等待",
        "第三者",
        "小三",
        "外遇",
        "關係",
        "感情",
        "婚姻",
        "結婚",
        "喜歡",
        "離婚",
        "桃花",
        "對的人",
        "放下",
        "伴侶",
        "老公",
        "老婆",
        "男友",
        "女友",
        "另一半",
        "對象",
        "情人",
        "換男人",
        "換女人",
        "換對象",
        "約會",
        "追",
        "被追",
      ],
      excludes: [
        "換工作",
        "轉職",
        "離職",
        "升遷",
        "加薪",
        "offer",
        "面試",
        "公司",
      ],
    },
    {
      type: "家庭",
      priority: 95,
      keywords: [
        "父母",
        "媽媽",
        "爸爸",
        "家人",
        "孩子",
        "小孩",
        "學業",
        "矛盾",
        "相處",
        "衝突",
        "親子",
        "家庭關係",
      ],
      excludes: ["疾病", "生病", "手術", "住院"],
    },
    {
      type: "財運",
      priority: 90,
      keywords: [
        "財運",
        "偏財",
        "收入",
        "額外收入",
        "破財",
        "賺錢",
        "賠錢",
        "威力彩",
        "樂透",
        "會不會賠",
        "股票",
        "買股票",
        "買股",
        "投資",
        "進場",
        "出場",
        "套牢",
        "停損",
      ],
      excludes: [],
    },
    {
      type: "工作",
      priority: 80,
      keywords: [
        "公司",
        "這間公司",
        "還待嗎",
        "被重視",
        "升遷",
        "加薪",
        "換工作",
        "該不該換",
        "轉職",
        "離職",
        "跑道",
        "出國進修",
        "進修",
        "事業",
        "方向",
        "潛力",
        "創業",
        "職業",
        "五行",
        "天賦",
        "潛能",
        "職場",
        "小人",
        "offer",
        "面試",
      ],
      excludes: [
        "換男人",
        "換女人",
        "換對象",
        "復合",
        "前任",
        "曖昧",
        "桃花",
        "離婚",
        "結婚",
      ],
    },
    {
      type: "運勢",
      priority: 70,
      keywords: [
        "整體運勢",
        "運勢如何",
        "流年",
        "今年運勢",
        "2026",
        "明年",
        "今年",
        "這個月",
        "這半年",
        "今日",
        "今天",
      ],
      excludes: [],
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
✅ 工具：類型 → 用神門（第一版穩定可用）
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

  return map[type] || "開門";
}

/* ==========================================================
✅ 對外主函式：輸入問題 → 回傳「給 AI/給 LINE 用」的 payload
目的：
- 🔴 修改：使用隨機時間起盤，不再用現在時間
==========================================================
*/
function buildQimenPayloadFromQuestion(userQuestion) {
  /* ----------------------------------------------------------
  ✅ 🔴 修改點 2：產生隨機時間並起盤
  ----------------------------------------------------------
  */
  const randomDate = getRandomDate();

  // 拆解時間給套件用
  const year = randomDate.getFullYear();
  const month = randomDate.getMonth() + 1; // ⚠️ 注意：JS 月份 0-11，套件要 1-12
  const day = randomDate.getDate();
  const hour = randomDate.getHours();

  // 呼叫指定時間起盤
  const chart = generateChart(year, month, day, hour);

  // 轉 object (套件內建功能)
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

  /* ✅ 自動分類 → 用神門 → 用神門落宮資訊 */
  const qType = classifyQuestion(userQuestion);

  const useDoors = getDoorByQuestionType(qType);

  /* ----------------------------------------------------------
  ✅ 逐門找落宮資訊
  ----------------------------------------------------------
  */
  const doorInfos = useDoors
    .map((doorName) => {
      const info = findDoorPalace(qimen, doorName);
      return info
        ? {
            門: doorName,
            ...info,
          }
        : null;
    })
    .filter(Boolean);

  /* ✅ 回傳 payload */
  return {
    userQuestion,
    qType,
    useDoors,
    doorInfos,

    /* 🔴 新增：回傳起盤時間給前端顯示（讓用戶知道這是「隨機取樣」的盤） */
    chartTime: {
      year,
      month,
      day,
      hour,
    },

    /* ✅ 盤資料 */
    qimen,

    /* ✅ 核心與摘要 */
    core,
    obsSummary,
    obsHasVoid,

    /* ✅ 空亡 */
    voidBranches,
    voidPalaces,
  };
}

module.exports = {
  buildQimenPayloadFromQuestion,
};
