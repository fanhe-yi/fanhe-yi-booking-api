/* 
==========================================================
✅ src/qimen/qimenEngine.js
目的：
- 把「奇門排盤 + 規則分類 + 用神門 + 空亡 + 摘要 + Prompt」集中管理
- server.js 只呼叫這裡拿結果，避免 server.js 變屎山
使用方式：
  import { buildQimenPayloadFromQuestion } from "./qimen/qimenEngine.js";
  const payload = buildQimenPayloadFromQuestion("換工作好嗎");
==========================================================
*/

const { generateChartNow, chartToObject } = require("qimen-dunjia");

/* 
==========================================================
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

/* 
==========================================================
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

/* 
==========================================================
✅ 工具：空亡地支 → 空亡宮位
==========================================================
*/
function getVoidPalaces(voidBranches) {
  return voidBranches.map((b) => BRANCH_TO_PALACE[b]).filter(Boolean);
}

/* 
==========================================================
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

/* 
==========================================================
✅ 工具：組一行「值符觀測宮摘要」
==========================================================
*/
function buildObservationSummary(core, obsHasVoid) {
  const obs = core["觀測宮資訊"];
  const part = `${obs["八神"]}+${obs["九星"]}+${obs["八門"]}`;
  const voidText = obsHasVoid ? "有旬空" : "無旬空";
  return `值符觀測｜${part}｜落${obs["宮位"]}｜${voidText}`;
}

/* 
==========================================================
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

/* 
==========================================================
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

/* 
==========================================================
✅ 工具：類型 → 用神門（第一版穩定可用）
==========================================================
*/
function getDoorByQuestionType(type) {
  const map = {
    感情: "休門",
    工作: "開門",
    財運: "生門",
    運勢: "景門",
    家庭: "休門",
    不動產: "開門",
    命名: "景門",
    健康: "死門",
  };

  return map[type] || "開門";
}

/* 
==========================================================
✅ 工具：建立 AI Prompt（只組字串，不呼叫 AI）
==========================================================
*/
function buildAiPrompt({
  userQuestion,
  qType,
  useDoor,
  doorInfo,
  obsSummary,
  obsHasVoid,
  qimen,
  voidPalaces,
}) {
  const doorPalace = doorInfo?.["宮位"];
  const doorHasVoid = doorPalace ? voidPalaces.includes(doorPalace) : false;

  return `
你是一位擅長用白話解釋的奇門遁甲老師。
請根據以下盤面資料，回答使用者問題。回答必須：
1) 只用白話，不要教科書術語堆疊
2) 直接給結論 + 2~4 個理由
3) 給 2 個可執行建議
4) 全文不要超過 180 字
5) 若出現「旬空」，請解釋成：變數、延遲、容易落空、需要再確認

【使用者問題】
${userQuestion}

【自動判定】
類型：${qType}
用神門：${useDoor}

【值符觀測宮摘要】
${obsSummary}
（值符觀測宮旬空：${obsHasVoid ? "是" : "否"}）

【用神門落宮資訊】
${doorInfo ? `${doorInfo["八神"]}+${doorInfo["九星"]}+${doorInfo["八門"]}｜落${doorInfo["宮位"]}` : "找不到用神門落宮資訊"}
（用神宮旬空：${doorHasVoid ? "是" : "否"}）

【旬首與空亡】
旬首：${qimen["旬首"]}
空亡宮位：${voidPalaces.join("、") || "無"}

請開始回答：
`.trim();
}

/* 
==========================================================
✅ 對外主函式：輸入問題 → 回傳「給 AI/給 LINE 用」的 payload
目的：
- server.js 不要碰細節，只要拿這包就能做後續動作
==========================================================
*/
function buildQimenPayloadFromQuestion(userQuestion) {
  /* ✅ 起盤 + 轉 object */
  const chart = generateChartNow();
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
  const useDoor = getDoorByQuestionType(qType);
  const doorInfo = findDoorPalace(qimen, useDoor);

  /* ✅ Prompt（先不呼叫 AI） */
  const prompt = buildAiPrompt({
    userQuestion,
    qType,
    useDoor,
    doorInfo,
    obsSummary,
    obsHasVoid,
    qimen,
    voidPalaces,
  });

  return {
    userQuestion,
    qType,
    useDoor,
    core,
    obsSummary,
    obsHasVoid,
    voidBranches,
    voidPalaces,
    doorInfo,
    prompt,
  };
}

/* 
==========================================================
✅ CommonJS 匯出
目的：
- 讓 server.js（多半是 require）可以直接吃
==========================================================
*/
module.exports = {
  buildQimenPayloadFromQuestion,
};
