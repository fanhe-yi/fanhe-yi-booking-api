// ====== 求旺相休囚死月破 ===============
// ===== 五行氣勢（旺相休囚死）＋ 月破（ =====

const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";

// 月正沖 → 月破
const BRANCH_CLASH = {
  子: "午",
  午: "子",
  丑: "未",
  未: "丑",
  寅: "申",
  申: "寅",
  卯: "酉",
  酉: "卯",
  辰: "戌",
  戌: "辰",
  巳: "亥",
  亥: "巳",
};

// 月令 → 當令五行（你指定的版本）
function branchToMonthElement(branch) {
  if ("寅卯".includes(branch)) return "木";
  if ("巳午".includes(branch)) return "火";
  if ("申酉".includes(branch)) return "金";
  if ("亥子".includes(branch)) return "水";
  if ("辰戌丑未".includes(branch)) return "土";
  return null;
}

// 五行生剋
const GENERATE = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
const CONTROL = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };

// 從干支字串取地支
function extractBranch(gz) {
  if (!gz) return null;
  for (const ch of gz) {
    if (BRANCHES.includes(ch)) return ch;
  }
  return null;
}

/**
 * 規則：
 * 同月令者＝旺
 * 月生者＝相
 * 月剋者＝死
 * 剋月者＝囚
 * 生月者＝休
 * 月正沖者＝月破
 *
 * 固定輸出順序：木火土金水
 */
function buildElementPhase(ganzhiArr) {
  if (!Array.isArray(ganzhiArr) || ganzhiArr.length < 2) {
    return { text: "", dominant: null, breaker: null };
  }

  const monthBranch = extractBranch(ganzhiArr[1]); // 月支
  if (!monthBranch) return { text: "", dominant: null, breaker: null };

  const dominant = branchToMonthElement(monthBranch); // 月令五行
  if (!dominant) return { text: "", dominant: null, breaker: null };

  // 五行定位（以「月令五行」为中心）
  const phaseMap = {};
  phaseMap[dominant] = "旺"; // 同月令者＝旺
  phaseMap[GENERATE[dominant]] = "相"; // 月生者＝相（dominant 生出的那个）
  phaseMap[CONTROL[dominant]] = "死"; // 月剋者＝死（dominant 克的那个）

  // 剋月者＝囚：谁克 dominant？
  for (const [k, v] of Object.entries(CONTROL)) {
    if (v === dominant) phaseMap[k] = "囚";
  }

  // 生月者＝休：谁生 dominant？
  for (const [k, v] of Object.entries(GENERATE)) {
    if (v === dominant) phaseMap[k] = "休";
  }

  // 固定輸出順序：木火土金水
  const order = ["木", "火", "土", "金", "水"];
  const phaseText = order.map((e) => `${e}${phaseMap[e] || ""}`).join("，");

  // 月破：月支正沖
  const breaker = BRANCH_CLASH[monthBranch] || null;
  const finalText = breaker ? `${phaseText}，月破，${breaker}` : phaseText;

  return { text: finalText, dominant, breaker };
}

// ====== 六爻工具：六親 / 地支五行 / 空亡 / 行文描述 ======

// 六親轉成完整用字
function mapRelationChar(ch) {
  const map = {
    妻: "妻財",
    官: "官鬼",
    兄: "兄弟",
    父: "父母",
    孙: "子孫",
  };
  return map[ch] || ch || "";
}

// 地支 → 五行
function branchToElementWord(branch) {
  const map = {
    子: "水",
    丑: "土",
    寅: "木",
    卯: "木",
    辰: "土",
    巳: "火",
    午: "火",
    未: "土",
    申: "金",
    酉: "金",
    戌: "土",
    亥: "水",
  };
  return map[branch] || "";
}

// 從 xunkong 裡取「第三組」旬空 → 得到空亡用到的地支集合
function getVoidBranchesFromXunkong(xunkong) {
  const set = new Set();
  if (!Array.isArray(xunkong) || xunkong.length < 3) return set;
  const s = xunkong[2] || ""; // 只取第三個值
  const branches = "子丑寅卯辰巳午未申酉戌亥";
  for (const ch of s) {
    if (branches.includes(ch)) {
      set.add(ch);
    }
  }
  return set;
}

// 共用：解析「妻丁未」「孙庚午」這種片段
function parseRelationAndBranch(raw, voidBranches) {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, ""); // 去空白
  if (!cleaned) return null;

  const branches = "子丑寅卯辰巳午未申酉戌亥";
  const relChar = cleaned[0];
  const relWord = mapRelationChar(relChar);

  let branch = null;
  // 往後掃到第一個地支
  for (let i = 1; i < cleaned.length; i++) {
    if (branches.includes(cleaned[i])) {
      branch = cleaned[i];
      break;
    }
  }

  if (!branch) {
    return {
      relation: relWord,
      branch: "",
      branchText: "",
    };
  }

  const elem = branchToElementWord(branch);
  const withVoid = voidBranches && voidBranches.has(branch) ? "空亡" : "";
  const branchText = `${branch}${elem}${withVoid}`;

  return {
    relation: relWord,
    branch,
    branchText,
  };
}

// 解析「本卦」那一串（含 伏藏 / 世應 / 動爻）
function parseBenGuaLine(benStr, voidBranches) {
  if (!benStr) return null;

  // 找到 ━━━ 或 ━　━
  const match = benStr.match(/(━━━|━　━)/);
  if (!match) {
    return null;
  }

  const glyph = match[1];
  const head = benStr.slice(0, match.index).trim(); // 伏藏如果有
  const tail = benStr
    .slice(match.index + glyph.length)
    .replace(/　+$/, "") // 去掉尾端全形空格
    .trim();

  // 伏藏：在卦畫前面的那段
  const hiddenInfo = head ? parseRelationAndBranch(head, voidBranches) : null;

  // 剩下尾巴：例如「妻丁未　应X」「父丁亥　世」
  const cleanedTail = tail.replace(/\s+/g, "");
  if (!cleanedTail) {
    return {
      glyph,
      hidden: hiddenInfo,
      main: null,
      worldRole: null,
      moveFlag: null,
    };
  }

  const branches = "子丑寅卯辰巳午未申酉戌亥";
  const relChar = cleanedTail[0];
  const relWord = mapRelationChar(relChar);

  let branch = null;
  let rest = "";
  // 找地支位置
  for (let i = 1; i < cleanedTail.length; i++) {
    if (branches.includes(cleanedTail[i])) {
      branch = cleanedTail[i];
      rest = cleanedTail.slice(i + 1); // 後面可能有 世 / 应 / O / X
      break;
    }
  }

  const elem = branch ? branchToElementWord(branch) : "";
  const mainBranchText =
    branch && elem
      ? `${branch}${elem}${
          voidBranches && voidBranches.has(branch) ? "空亡" : ""
        }`
      : "";

  // 世 / 應 / 動爻 (O / X)
  let worldRole = null;
  if (rest.includes("世")) worldRole = "世爻";
  else if (rest.includes("应")) worldRole = "應爻";

  let moveFlag = null;
  if (rest.includes("O")) moveFlag = "O";
  else if (rest.includes("X")) moveFlag = "X";

  return {
    glyph, // ━　━ or ━━━
    hidden: hiddenInfo, // { relation, branchText }
    main: {
      relation: relWord,
      branch,
      branchText: mainBranchText,
    },
    worldRole, // "世爻" / "應爻" / null
    moveFlag, // "O" / "X" / null
  };
}

// 解析「變卦」那一串：只要六親 + 地支 + 空亡
function parseBianGuaLine(bianStr, voidBranches) {
  if (!bianStr) return null;
  const match = bianStr.match(/(━━━|━　━)/);
  let tail = bianStr;
  if (match) {
    tail = bianStr
      .slice(match.index + match[1].length)
      .replace(/　+$/, "")
      .trim();
  }
  const info = parseRelationAndBranch(tail, voidBranches);
  return info;
}

// 建構一條完整「第X爻...」的敘述
function buildSingleLiuYaoLine(
  idx,
  liushenName,
  benStr,
  bianStr,
  voidBranches
) {
  // idx: 0~5, 對應 六→五→四→三→二→初
  const yaoTitles = [
    "第六爻",
    "第五爻",
    "第四爻",
    "第三爻",
    "第二爻",
    "第一爻",
  ];
  const title = yaoTitles[idx] || "";

  const benInfo = parseBenGuaLine(benStr, voidBranches);
  if (!benInfo || !benInfo.main) {
    // 保底：沒解析成功就原樣吐回
    return `${title}${liushenName || ""}${benStr || ""}`;
  }

  const isYin = benInfo.glyph === "━　━";

  const parts = [];
  parts.push(title);
  if (liushenName) parts.push(liushenName);

  // 伏藏
  if (benInfo.hidden && benInfo.hidden.relation && benInfo.hidden.branchText) {
    parts.push("伏藏" + benInfo.hidden.relation + benInfo.hidden.branchText);
  }

  // 本卦主要六親 + 地支五行 (+ 空亡)
  parts.push(benInfo.main.relation + benInfo.main.branchText);

  // 動爻 or 靜爻
  if (benInfo.moveFlag) {
    // 動爻：老陰 / 老陽 + (世/應) + 動化 + 變爻六親地支
    const oldWord = isYin ? "老陰" : "老陽";
    parts.push(oldWord);

    // 應爻優先放在老陰/老陽後面
    if (benInfo.worldRole === "應爻") {
      parts.push("應爻");
    } else if (benInfo.worldRole === "世爻") {
      parts.push("世爻");
    }

    parts.push("動化");

    const bianInfo = parseBianGuaLine(bianStr, voidBranches);
    if (bianInfo && bianInfo.relation && bianInfo.branchText) {
      parts.push(bianInfo.relation + bianInfo.branchText);
    }
  } else {
    // 靜爻：陰爻 / 陽爻 + (世爻/應爻)
    const yyWord = isYin ? "陰爻" : "陽爻";
    parts.push(yyWord);

    if (benInfo.worldRole) {
      parts.push(benInfo.worldRole);
    }
  }

  return parts.join("");
}

// === 核心：把整個卦逐行整理成文字 ===
function describeSixLines(hexData) {
  if (!hexData) return "";

  const { liushen, benguax, bianguax, xunkong } = hexData;

  const voidBranches = getVoidBranchesFromXunkong(xunkong);
  const lines = [];

  for (let i = 0; i < 6; i++) {
    const liushenName =
      Array.isArray(liushen) && liushen.length === 6 ? liushen[i] || "" : "";

    const benStr =
      Array.isArray(benguax) && benguax.length === 6 ? benguax[i] || "" : "";

    const bianStr =
      Array.isArray(bianguax) && bianguax.length === 6 ? bianguax[i] || "" : "";

    const lineText = buildSingleLiuYaoLine(
      i,
      liushenName,
      benStr,
      bianStr,
      voidBranches
    );
    lines.push(lineText);
  }

  return lines.join("\n");
}

/* ==========================================================
   卦身 / 用神 / 驛馬 / 羊刃 自動填入
   ==========================================================
   由 hexData 推算並組成 shensha_notes 字串（4 行）。
   規則：老師制定，見 docs 或 plan file。

   常數表：
   - GUASHEN_YANG / GUASHEN_YIN：世爻位置(1-6) + 陰陽 → 卦身地支
   - YIMA_MAP：日支 → 驛馬地支
   - YANGREN_MAP：日干 → 羊刃地支
========================================================== */

const GUASHEN_YANG = ["", "子", "丑", "寅", "卯", "辰", "巳"]; // idx = 位置(1-6)
const GUASHEN_YIN = ["", "午", "未", "申", "酉", "戌", "亥"];

const YIMA_MAP = {
  子: "寅", 丑: "亥", 寅: "申", 卯: "巳",
  辰: "寅", 巳: "亥", 午: "申", 未: "巳",
  申: "寅", 酉: "亥", 戌: "申", 亥: "巳",
};

const YANGREN_MAP = {
  甲: "卯", 乙: "辰",
  丙: "午", 戊: "午",
  丁: "未", 己: "未",
  庚: "酉", 辛: "戌",
  壬: "子", 癸: "丑",
};

/* --------------------------------------------------
   六親字（含繁簡）→ 全稱
   mapRelationChar 沒收「孫」繁體 / 「子」，補齊
-------------------------------------------------- */
function mapRelationCharFull(ch) {
  const extra = { 孫: "子孫", 子: "子孫" };
  return extra[ch] || mapRelationChar(ch);
}

/**
 * 掃 benguax 6 條，建立本卦「五行→六親」對照 map
 * @param {string[]} benguax
 * @returns {Object<string,string>} { 木: "父母", 火: "妻財", ... }
 */
function buildWuxingToLiuqinMap(benguax) {
  const result = {};
  if (!Array.isArray(benguax)) return result;
  for (const line of benguax) {
    if (!line || typeof line !== "string") continue;
    /* 每條格式：可能有伏藏「官己亥 ━━━ 妻丙申 世」或無伏藏「━━━ 妻丙申 世」
       本卦六親 = glyph 之後的那個「六親字+干支」的第一個 char
       用簡單 regex 抓 glyph 後面第一個「六親字」+ 兩個 char（干+支） */
    const m = line.match(/(━━━|━\s*━|━　━)\s*([妻官兄父孙孫子])(.{2})/);
    if (!m) continue;
    const liuqinChar = m[2];
    const dizhi = m[3];
    // 地支可能是「己亥」這種，取最後一字
    const branch = dizhi.length >= 2 ? dizhi.slice(-1) : dizhi;
    const wx = branchToElementWord(branch);
    if (!wx) continue;
    // 已存在就不覆蓋（同五行本應同六親）
    if (!result[wx]) {
      result[wx] = mapRelationCharFull(liuqinChar);
    }
  }
  return result;
}

/**
 * 找世爻的位置 (1-6) 與陰陽
 * benguax[0] = 上爻 (位置 6), benguax[5] = 初爻 (位置 1)
 * @param {string[]} benguax
 * @returns {{position:number, yang:boolean}|null}
 */
function findWorldYaoInfo(benguax) {
  if (!Array.isArray(benguax)) return null;
  for (let i = 0; i < benguax.length; i++) {
    const line = benguax[i];
    if (!line || typeof line !== "string") continue;
    // 世 或简体 应=應 都不算，只認「世」
    if (!/[世]/.test(line)) continue;

    // 判斷陰陽：陽 = ━━━（可含 O 動），陰 = ━　━（可含 × 動）
    // 全形空格 U+3000
    const isYin = /━[\s　]━/.test(line);
    const isYang = !isYin;

    const position = 6 - i; // index 0 = 上爻 = 位置6
    return { position, yang: isYang };
  }
  return null;
}

/**
 * 主入口：算 shensha_notes 4 行字串
 * @param {Object} hexData - lyApiClient.getLiuYaoHexagram raw output
 * @returns {string} 例：
 *   卦身：寅（子孫）
 *   用神：
 *   驛馬：申（父母）
 *   羊刃：卯（子孫）
 * 出錯 → 回 ""
 */
function buildShenshaNotes(hexData) {
  try {
    if (!hexData || typeof hexData !== "object") return "";
    const benguax = hexData.benguax;
    const ganzhi = hexData.ganzhi;
    if (!Array.isArray(benguax) || benguax.length !== 6) return "";
    if (!Array.isArray(ganzhi) || ganzhi.length < 3) return "";

    // 五行 → 六親對照
    const wxToLq = buildWuxingToLiuqinMap(benguax);

    // 給某地支加註六親：例 "寅（子孫）"
    const withLq = (dizhi) => {
      const wx = branchToElementWord(dizhi);
      const lq = wxToLq[wx];
      return lq ? `${dizhi}（${lq}）` : `${dizhi}（—）`;
    };

    // 1. 卦身
    const worldInfo = findWorldYaoInfo(benguax);
    let guashenLine;
    if (worldInfo) {
      const table = worldInfo.yang ? GUASHEN_YANG : GUASHEN_YIN;
      const dz = table[worldInfo.position];
      guashenLine = `卦身：${withLq(dz)}`;
    } else {
      guashenLine = `卦身：（無法判定）`;
    }

    // 2. 用神
    const yongshenLine = `用神：`;

    // 3. 驛馬
    const dayGz = String(ganzhi[2] || "");
    const dayBranch = dayGz.length >= 2 ? dayGz[1] : "";
    let yimaLine;
    const yimaBranch = YIMA_MAP[dayBranch];
    if (yimaBranch) {
      yimaLine = `驛馬：${withLq(yimaBranch)}`;
    } else {
      yimaLine = `驛馬：（無法判定）`;
    }

    // 4. 羊刃
    const dayStem = dayGz.length >= 1 ? dayGz[0] : "";
    let yangrenLine;
    const yangrenBranch = YANGREN_MAP[dayStem];
    if (yangrenBranch) {
      yangrenLine = `羊刃：${withLq(yangrenBranch)}`;
    } else {
      yangrenLine = `羊刃：（無法判定）`;
    }

    return [guashenLine, yongshenLine, yimaLine, yangrenLine].join("\n");
  } catch (err) {
    // 演算法出錯 → 回空字串，不擋 record 存入
    // eslint-disable-next-line no-console
    console.warn("[buildShenshaNotes] error:", err?.message || err);
    return "";
  }
}

module.exports = {
  describeSixLines,
  buildElementPhase,
  buildShenshaNotes,
  // 以下 export 供測試用
  buildWuxingToLiuqinMap,
  findWorldYaoInfo,
};
