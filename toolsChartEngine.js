const OpenCC = require("opencc-js");
const { astro } = require("iztro");
const { baziService } = require("mingpan/dist/services/bazi/index.js");

const toTW = OpenCC.Converter({ from: "cn", to: "tw" });

const STEMS = "甲乙丙丁戊己庚辛壬癸".split("");
const BRANCHES = "子丑寅卯辰巳午未申酉戌亥".split("");
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

function toGanZhi(chartPillar) {
  if (!chartPillar) return "";
  return `${tw(chartPillar.stem)}${tw(chartPillar.branch)}`;
}

function elementOf(ch) {
  return FIVE_ELEMENT_MAP[ch] || "";
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
    const zhi = tw(p?.branch);
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

  return {
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

function createZiweiChart(input) {
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
    earthlyBranch: tw(p.earthlyBranch),
    isBodyPalace: !!p.isBodyPalace,
    isSoulPalace: tw(p.earthlyBranch) === tw(astrolabe.earthlyBranchOfSoulPalace),
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
          earthlyBranch: tw(p.decadal.earthlyBranch),
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

  return {
    ok: true,
    source: "web_ziwei_chart",
    birth,
    solarDate: tw(astrolabe.solarDate),
    lunarDate: tw(astrolabe.lunarDate),
    chineseDate: tw(astrolabe.chineseDate),
    zodiac: tw(astrolabe.zodiac),
    sign: tw(astrolabe.sign),
    time: tw(astrolabe.time),
    timeRange: tw(astrolabe.timeRange),
    fiveElementsClass: tw(astrolabe.fiveElementsClass),
    soul: tw(astrolabe.soul),
    body: tw(astrolabe.body),
    earthlyBranchOfSoulPalace: tw(astrolabe.earthlyBranchOfSoulPalace),
    earthlyBranchOfBodyPalace: tw(astrolabe.earthlyBranchOfBodyPalace),
    palaces,
    sihua,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  createBaziChart,
  createZiweiChart,
  SHICHEN_OPTIONS,
};
