const OpenCC = require("opencc-js");
const { astro } = require("iztro");
const { baziService } = require("mingpan/dist/services/bazi/index.js");

const toTW = OpenCC.Converter({ from: "cn", to: "tw" });

const FIVE_ELEMENT_MAP = {
  甲: "木",
  乙: "木",
  寅: "木",
  卯: "木",
  丙: "火",
  丁: "火",
  巳: "火",
  午: "火",
  戊: "土",
  己: "土",
  辰: "土",
  戌: "土",
  丑: "土",
  未: "土",
  庚: "金",
  辛: "金",
  申: "金",
  酉: "金",
  壬: "水",
  癸: "水",
  子: "水",
  亥: "水",
};

const ZIWEI_GRID_BRANCHES = [
  ["巳", "午", "未", "申"],
  ["辰", null, null, "酉"],
  ["卯", null, null, "戌"],
  ["寅", "丑", "子", "亥"],
];

const SHICHEN_OPTIONS = [
  { key: "zi_early", branch: "子", hour: 0, minute: 0, label: "子時", range: "00:00-00:59" },
  { key: "chou", branch: "丑", hour: 1, minute: 0, label: "丑時", range: "01:00-02:59" },
  { key: "yin", branch: "寅", hour: 3, minute: 0, label: "寅時", range: "03:00-04:59" },
  { key: "mao", branch: "卯", hour: 5, minute: 0, label: "卯時", range: "05:00-06:59" },
  { key: "chen", branch: "辰", hour: 7, minute: 0, label: "辰時", range: "07:00-08:59" },
  { key: "si", branch: "巳", hour: 9, minute: 0, label: "巳時", range: "09:00-10:59" },
  { key: "wu", branch: "午", hour: 11, minute: 0, label: "午時", range: "11:00-12:59" },
  { key: "wei", branch: "未", hour: 13, minute: 0, label: "未時", range: "13:00-14:59" },
  { key: "shen", branch: "申", hour: 15, minute: 0, label: "申時", range: "15:00-16:59" },
  { key: "you", branch: "酉", hour: 17, minute: 0, label: "酉時", range: "17:00-18:59" },
  { key: "xu", branch: "戌", hour: 19, minute: 0, label: "戌時", range: "19:00-20:59" },
  { key: "hai", branch: "亥", hour: 21, minute: 0, label: "亥時", range: "21:00-22:59" },
  { key: "zi_late", branch: "子", hour: 23, minute: 0, label: "晚子時", range: "23:00-23:59" },
];

function tw(value) {
  if (value === null || value === undefined) return "";
  return toTW(String(value));
}

function earthly(value) {
  return tw(value).replace(/醜/g, "丑");
}

function normalizeGender(value) {
  if (value === "male" || value === "男" || value === "男命") return "male";
  if (value === "female" || value === "女" || value === "女命") return "female";
  return null;
}

function parsePositiveInt(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isValidSolarDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function getShichen(key) {
  return SHICHEN_OPTIONS.find((item) => item.key === key) || null;
}

function normalizeBirthInput(input) {
  const year = parsePositiveInt(input?.year);
  const month = parsePositiveInt(input?.month);
  const day = parsePositiveInt(input?.day);
  const gender = normalizeGender(String(input?.gender || "").trim());
  const shichen = getShichen(String(input?.shichen || "").trim());

  if (!year || year < 1900 || year > 2100) return null;
  if (!month || month < 1 || month > 12) return null;
  if (!day || day < 1 || day > 31) return null;
  if (!isValidSolarDate(year, month, day)) return null;
  if (!gender || !shichen) return null;

  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    year,
    month,
    day,
    hour: shichen.hour,
    minute: shichen.minute,
    gender,
    shichen: shichen.key,
    branch: shichen.branch,
    timeLabel: `${shichen.label}（${shichen.range}）`,
    date,
    dateLabel: `${year} 年 ${month} 月 ${day} 日`,
    genderLabel: gender === "male" ? "男命" : "女命",
  };
}

function elementOf(ch) {
  return FIVE_ELEMENT_MAP[ch] || "";
}

function uniqueTruthy(items) {
  return [...new Set(items.filter(Boolean))];
}

function virtualAge(birth) {
  return Math.max(1, new Date().getFullYear() - Number(birth.year) + 1);
}

function findCurrentRange(items, age) {
  return (items || []).find((item) => {
    const range = Array.isArray(item.decadal?.range)
      ? item.decadal.range
      : [item.startAge, item.endAge];
    const start = Number(range?.[0]);
    const end = Number(range?.[1]);
    return Number.isFinite(start) && Number.isFinite(end) && age >= start && age <= end;
  });
}

function fiveElementSummary(fiveElements = [], balance = null) {
  const sorted = [...fiveElements].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  const strongest = sorted[0]?.name || "";
  const weakest = sorted[sorted.length - 1]?.name || "";
  const missing = sorted.filter((item) => Number(item.value || 0) === 0).map((item) => item.name);
  const balanceText = balance?.type ? tw(balance.type) : "";
  return {
    strongest,
    weakest,
    missing,
    balanceText,
    line: [
      strongest ? `偏顯：${strongest}` : "",
      missing.length ? `未見：${missing.join("、")}` : weakest ? `相對少：${weakest}` : "",
      balanceText ? `平衡：${balanceText}` : "",
    ].filter(Boolean).join("；"),
  };
}

function buildBaziGuide(chart) {
  const visibleTenGods = uniqueTruthy(
    (chart.pillars || []).map((pillar) => (pillar.tenGod === "日主" ? "" : pillar.tenGod)),
  );
  const hiddenStems = uniqueTruthy(
    (chart.pillars || []).flatMap((pillar) =>
      (pillar.hiddenStems || []).map((stem) => `${stem.stem}${stem.tenGod ? ` ${stem.tenGod}` : ""}`),
    ),
  ).slice(0, 8);
  const elementInfo = fiveElementSummary(chart.fiveElements, chart.fiveElementBalance);
  const age = virtualAge(chart.birth);
  const currentDayun = findCurrentRange(chart.dayun, age);

  return [
    {
      title: "日主",
      body: `此盤日主為 ${chart.dayMaster}${chart.dayMasterElement || ""}，八字解讀會以日主作為核心，再看月令、四柱十神與五行生剋。`,
    },
    {
      title: "五行",
      body: elementInfo.line
        ? `五行分布可先看盤面的氣勢與偏枯方向，本盤${elementInfo.line}。`
        : "五行分布用來觀察盤面氣勢，需再配合季節、藏干與大運判斷。",
    },
    {
      title: "十神",
      body: visibleTenGods.length
        ? `天干可見十神有 ${visibleTenGods.join("、")}，代表盤面外顯的關係與事件入口。`
        : "此盤天干十神資訊較少，需多看地支藏干與大運引動。",
    },
    {
      title: "藏干",
      body: hiddenStems.length
        ? `地支藏干可見 ${hiddenStems.join("、")} 等，代表盤面內層氣勢，正式解讀會再分主氣與餘氣。`
        : "地支藏干是判斷根氣與內層結構的重要依據，需配合月令與全盤一起看。",
    },
    {
      title: "大運",
      body: currentDayun
        ? `目前約 ${age} 虛歲，落在 ${currentDayun.startAge}-${currentDayun.endAge} 歲 ${currentDayun.ganzhi} 大運；此處只標示運程區段，不直接斷吉凶。`
        : "大運用來看人生階段的十年氣勢，目前頁面先列出區段，完整判斷需合看流年與原局。",
    },
  ];
}

function buildBaziChartText(chart) {
  const pillarLine = (chart.pillars || [])
    .map((p) => `${p.label}${p.ganzhi}${p.tenGod ? `(${p.tenGod})` : ""}`)
    .join(" / ");
  const elementLine = (chart.fiveElements || [])
    .map((item) => `${item.name}${Number(item.value || 0)}`)
    .join("、");
  const dayunLine = (chart.dayun || [])
    .slice(0, 6)
    .map((item) => `${item.startAge}-${item.endAge}歲 ${item.ganzhi}`)
    .join(" / ");
  const guideLine = (chart.guide || []).map((item) => `${item.title}：${item.body}`).join("\n");

  return [
    "【八字文字盤摘要】",
    `${chart.birth.genderLabel}｜${chart.birth.dateLabel}｜${chart.birth.timeLabel}`,
    `日主：${chart.dayMaster}${chart.dayMasterElement || ""}`,
    `四柱：${pillarLine}`,
    `五行：${elementLine}`,
    `命宮：${chart.mingGong || "未載入"}｜胎元：${chart.taiYuan || "未載入"}｜生肖：${chart.zodiac || "未載入"}`,
    `大運：${dayunLine || "未載入"}`,
    guideLine,
  ].filter(Boolean).join("\n");
}

function visibleTenGodsMap(tenGods = []) {
  const map = {};
  tenGods
    .filter((item) => item && !String(item.name || "").includes("(hidden)"))
    .forEach((item) => {
      map[tw(item.position)] = tw(item.name);
    });
  return map;
}

function hiddenTenGodsByPosition(tenGods = []) {
  const map = {};
  tenGods
    .filter((item) => item && String(item.name || "").includes("(hidden)"))
    .forEach((item) => {
      const position = tw(item.position);
      if (!map[position]) map[position] = {};
      map[position][tw(item.stem)] = tw(String(item.name || "").replace("(hidden)", ""));
    });
  return map;
}

function formatHiddenStems(hiddenStems = [], position, hiddenMap) {
  const byStem = hiddenMap[position] || {};
  return hiddenStems.map((item) => ({
    stem: tw(item.stem),
    tenGod: byStem[tw(item.stem)] || "",
    strength: Number(item.power || item.strength || 0),
    isMain: !!item.isMain,
  }));
}

function nextDay(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + 1);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

async function calculateBaziQuietly(input) {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const shouldDrop = (args) =>
    args.some((arg) => typeof arg === "string" && arg.includes("[BaziService]"));
  const filter = (original) =>
    (...args) => {
      if (shouldDrop(args)) return;
      original(...args);
    };

  console.log = filter(originalLog);
  console.info = filter(originalInfo);
  process.stdout.write = function writeFiltered(chunk, encoding, callback) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    if (text.includes("[BaziService]")) {
      if (typeof encoding === "function") encoding();
      if (typeof callback === "function") callback();
      return true;
    }
    return originalStdoutWrite(chunk, encoding, callback);
  };
  process.stderr.write = function writeFilteredError(chunk, encoding, callback) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    if (text.includes("[BaziService]")) {
      if (typeof encoding === "function") encoding();
      if (typeof callback === "function") callback();
      return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
  };
  try {
    return await baziService.calculate(input);
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

async function createBaziChart(input) {
  const birth = normalizeBirthInput(input);
  if (!birth) {
    const err = new Error("INVALID_BIRTH_INPUT");
    err.status = 400;
    throw err;
  }

  const result = await calculateBaziQuietly({
    year: birth.year,
    month: birth.month,
    day: birth.day,
    hour: birth.hour,
    minute: birth.minute,
    gender: birth.gender,
    useLunar: false,
    options: { timeRange: { startYear: birth.year, endYear: birth.year + 100 } },
  });

  const chart = { ...result.chart };
  if (birth.hour === 23) {
    const nd = nextDay(birth.year, birth.month, birth.day);
    const dayResult = await calculateBaziQuietly({
      year: nd.year,
      month: nd.month,
      day: nd.day,
      hour: 12,
      minute: 0,
      gender: birth.gender,
      useLunar: false,
    });
    chart.day = dayResult.chart.day;
  }

  const visibleMap = visibleTenGodsMap(result.basic?.tenGods || []);
  const hiddenMap = hiddenTenGodsByPosition(result.basic?.tenGods || []);
  const positions = [
    ["year", "年柱"],
    ["month", "月柱"],
    ["day", "日柱"],
    ["hour", "時柱"],
  ];

  const pillars = positions.map(([key, label]) => {
    const p = chart[key];
    const gan = tw(p?.stem);
    const zhi = earthly(p?.branch);
    return {
      key,
      label,
      gan,
      zhi,
      ganzhi: `${gan}${zhi}`,
      ganElement: elementOf(gan),
      zhiElement: elementOf(zhi),
      tenGod: key === "day" ? "日主" : visibleMap[label] || "",
      naYin: tw(p?.naYin),
      selfSitting: tw(p?.selfSitting),
      hiddenStems: formatHiddenStems(p?.hiddenStems || [], label, hiddenMap),
    };
  });

  const five = result.basic?.fiveElements || {};
  const fiveElements = ["木", "火", "土", "金", "水"].map((name) => ({
    name,
    value: Number(five[name] || 0),
  }));

  const dayun = (result.timeBased?.daYun || []).slice(0, 10).map((item) => ({
    index: item.index,
    startAge: item.startAge,
    endAge: item.endAge,
    startYear: item.startYear,
    endYear: item.endYear,
    gan: tw(item.stem),
    zhi: tw(item.branch),
    ganzhi: `${tw(item.stem)}${tw(item.branch)}`,
    tenGod: tw(item.tenGod),
  }));

  const chartData = {
    ok: true,
    source: "web_bazi_chart",
    birth,
    dayMaster: tw(result.basic?.dayMaster || chart.day?.stem),
    dayMasterElement: tw(result.basic?.dayMasterElement || elementOf(chart.day?.stem)),
    zodiac: tw(result.basic?.zodiac),
    mingGong: tw(result.basic?.mingGong),
    taiYuan: tw(result.basic?.taiYuan),
    pillars,
    fiveElements,
    fiveElementBalance: result.basic?.fiveElements?.balance
      ? JSON.parse(tw(JSON.stringify(result.basic.fiveElements.balance)))
      : null,
    dayun,
    generatedAt: new Date().toISOString(),
  };
  chartData.guide = buildBaziGuide(chartData);
  chartData.chartText = buildBaziChartText(chartData);
  chartData.currentDayun = findCurrentRange(chartData.dayun, virtualAge(birth)) || null;
  return chartData;
}

function hourToShichenIndex(hour) {
  if (hour === 23) return 0;
  return Math.floor((hour + 1) / 2) % 12;
}

function starName(star) {
  const name = tw(star?.name);
  const brightness = tw(star?.brightness);
  const mutagen = tw(star?.mutagen);
  return {
    name,
    brightness,
    mutagen,
    label: `${name}${brightness ? `(${brightness})` : ""}${mutagen ? `化${mutagen}` : ""}`,
  };
}

function buildZiweiGrid(palaces) {
  const byBranch = new Map((palaces || []).map((palace) => [palace.earthlyBranch, palace]));
  return ZIWEI_GRID_BRANCHES.map((row, rowIndex) =>
    row.map((branch, colIndex) => {
      if (!branch) return null;
      const palace = byBranch.get(branch) || null;
      return {
        row: rowIndex,
        col: colIndex,
        branch,
        palace,
        empty: !palace,
      };
    }),
  );
}

function palaceStarText(palace) {
  if (!palace) return "未載入";
  return [...(palace.majorStars || []), ...(palace.minorStars || [])]
    .slice(0, 6)
    .map((star) => star.label || star.name)
    .join("、") || "空宮";
}

function buildZiweiGuide(chart) {
  const age = virtualAge(chart.birth);
  const soulPalace = (chart.palaces || []).find((p) => p.isSoulPalace);
  const bodyPalace = (chart.palaces || []).find((p) => p.isBodyPalace);
  const currentDecadal = findCurrentRange(chart.palaces, age);
  const sihuaText = (chart.sihua || [])
    .map((item) => `${item.palace}${item.star}${item.hua}`)
    .join("、");

  return [
    {
      title: "命宮",
      body: soulPalace
        ? `命宮在 ${soulPalace.earthlyBranch} 位 ${soulPalace.name}，主星為 ${palaceStarText(soulPalace)}；命宮是看個性底色與人生主軸的入口。`
        : "命宮是紫微盤的閱讀入口，用來看個性底色與人生主軸。",
    },
    {
      title: "身宮",
      body: bodyPalace
        ? `身宮落在 ${bodyPalace.earthlyBranch} 位 ${bodyPalace.name}，主星為 ${palaceStarText(bodyPalace)}；身宮偏向後天行動方式與實際著力處。`
        : "身宮偏向後天行動方式與實際著力處，需和命宮合看。",
    },
    {
      title: "五行局",
      body: chart.fiveElementsClass
        ? `此盤為 ${chart.fiveElementsClass}，用來標示盤局氣質與大限起運框架，不單獨作吉凶判斷。`
        : "五行局用來標示盤局氣質與大限起運框架，不單獨作吉凶判斷。",
    },
    {
      title: "生年四化",
      body: sihuaText
        ? `生年四化為 ${sihuaText}，代表本命盤中特別需要觀察的能量轉折點。`
        : "生年四化代表本命盤中特別需要觀察的能量轉折點。",
    },
    {
      title: "大限",
      body: currentDecadal?.decadal?.range?.length
        ? `目前約 ${age} 虛歲，落在 ${currentDecadal.decadal.range[0]}-${currentDecadal.decadal.range[1]} 歲 ${currentDecadal.name} 大限；此處只提示階段位置。`
        : "大限用來看十年階段主題，目前頁面先標示區段，完整判斷仍需合看流年與四化。",
    },
  ];
}

function buildZiweiChartText(chart) {
  const palaceLines = (chart.palaces || [])
    .map((p) => {
      const flags = [p.isSoulPalace ? "命" : "", p.isBodyPalace ? "身" : ""].filter(Boolean).join("/");
      return `${p.earthlyBranch}${p.name}${flags ? `(${flags})` : ""}：${palaceStarText(p)}`;
    })
    .join("\n");
  const sihuaLine = (chart.sihua || [])
    .map((item) => `${item.palace}${item.star}${item.hua}`)
    .join("、");
  const guideLine = (chart.guide || []).map((item) => `${item.title}：${item.body}`).join("\n");

  return [
    "【紫微文字盤摘要】",
    `${chart.birth.genderLabel}｜${chart.birth.dateLabel}｜${chart.birth.timeLabel}`,
    `農曆：${chart.lunarDate || "未載入"}`,
    `四柱：${chart.chineseDate || "未載入"}`,
    `五行局：${chart.fiveElementsClass || "未載入"}｜命主：${chart.soul || "未載入"}｜身主：${chart.body || "未載入"}`,
    `命宮：${chart.earthlyBranchOfSoulPalace || "未載入"}｜身宮：${chart.earthlyBranchOfBodyPalace || "未載入"}`,
    `生年四化：${sihuaLine || "未載入"}`,
    palaceLines,
    guideLine,
  ].filter(Boolean).join("\n");
}

async function createZiweiChart(input) {
  const birth = normalizeBirthInput(input);
  if (!birth) {
    const err = new Error("INVALID_BIRTH_INPUT");
    err.status = 400;
    throw err;
  }

  const astrolabe = astro.bySolar(
    `${birth.year}-${birth.month}-${birth.day}`,
    hourToShichenIndex(birth.hour),
    birth.gender === "male" ? "男" : "女",
    true,
    "zh-TW",
  );

  const palaces = astrolabe.palaces.map((p) => ({
    index: p.index,
    name: tw(p.name),
    heavenlyStem: tw(p.heavenlyStem),
    earthlyBranch: earthly(p.earthlyBranch),
    isBodyPalace: !!p.isBodyPalace,
    isSoulPalace:
      tw(p.name) === "命宮" || earthly(p.earthlyBranch) === earthly(astrolabe.earthlyBranchOfSoulPalace),
    majorStars: (p.majorStars || []).map(starName),
    minorStars: (p.minorStars || []).map(starName),
    adjectiveStars: (p.adjectiveStars || []).map(starName),
    changsheng12: tw(p.changsheng12),
    boshi12: tw(p.boshi12),
    jiangqian12: tw(p.jiangqian12),
    suiqian12: tw(p.suiqian12),
    decadal: p.decadal
      ? {
          range: Array.isArray(p.decadal.range) ? p.decadal.range : [],
          heavenlyStem: tw(p.decadal.heavenlyStem),
          earthlyBranch: earthly(p.decadal.earthlyBranch),
        }
      : null,
    ages: Array.isArray(p.ages) ? p.ages : [],
  }));

  const sihua = [];
  palaces.forEach((palace) => {
    [...palace.majorStars, ...palace.minorStars].forEach((star) => {
      if (star.mutagen) {
        sihua.push({ palace: palace.name, star: star.name, hua: `化${star.mutagen}` });
      }
    });
  });

  const baziChart = await createBaziChart(input);
  const baziPillarText = (baziChart.pillars || []).map((pillar) => pillar.ganzhi).join(" ");
  const chartData = {
    ok: true,
    source: "web_ziwei_chart",
    birth,
    solarDate: tw(astrolabe.solarDate),
    lunarDate: tw(astrolabe.lunarDate),
    chineseDate: baziPillarText || tw(astrolabe.chineseDate),
    zodiac: tw(astrolabe.zodiac),
    sign: tw(astrolabe.sign),
    time: tw(astrolabe.time),
    timeRange: tw(astrolabe.timeRange),
    fiveElementsClass: tw(astrolabe.fiveElementsClass),
    soul: tw(astrolabe.soul),
    body: tw(astrolabe.body),
    earthlyBranchOfSoulPalace: earthly(astrolabe.earthlyBranchOfSoulPalace),
    earthlyBranchOfBodyPalace: earthly(astrolabe.earthlyBranchOfBodyPalace),
    baziPillars: baziChart.pillars,
    palaces,
    sihua,
    generatedAt: new Date().toISOString(),
  };
  chartData.grid = buildZiweiGrid(palaces);
  chartData.guide = buildZiweiGuide(chartData);
  chartData.chartText = buildZiweiChartText(chartData);
  chartData.currentDecadal = findCurrentRange(palaces, virtualAge(birth)) || null;
  return chartData;
}

module.exports = {
  createBaziChart,
  createZiweiChart,
  SHICHEN_OPTIONS,
};
