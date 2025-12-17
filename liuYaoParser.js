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

module.exports = {
  describeSixLines,
};
