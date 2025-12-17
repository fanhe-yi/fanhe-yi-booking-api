const axios = require("axios");

const YOUHUALAO_KEY = process.env.YOUHUALAO_KEY || "test";
const YOUHUALAO_BASE = "http://www.youhualao.com/api/";

// 取得某一天某個時間點的年柱 / 月柱 / 日柱 / 時柱
// dateObj: JS Date 物件（通常用「現在」 new Date()）
// 回傳格式：{ yearGZ, monthGZ, dayGZ, hourGZ, raw }
async function getLiuYaoGanzhiForDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth() + 1; // JS 月份從 0 開始，要 +1
  const d = dateObj.getDate();
  const h = dateObj.getHours();
  const mi = dateObj.getMinutes();

  const params = {
    c: "ly",
    key: YOUHUALAO_KEY,
    y,
    m,
    d,
    h,
    mi,
    type: 1,
    yy: 103211,
    // yy 可以不一定要給，你測試那個 103211 只是倍數編號
    // 不填 it 也會自己算; 如果你很在意可以之後再加
  };

  const qs = new URLSearchParams(params).toString();
  const url = `${YOUHUALAO_BASE}?${qs}`;

  const resp = await axios.get(url);
  const data = resp.data;

  if (
    !data ||
    data.msg !== "ok" ||
    !data.data ||
    !Array.isArray(data.data.ganzhi)
  ) {
    throw new Error("[youhualao ly] 回傳格式不正確：" + JSON.stringify(data));
  }

  const [yearGZ, monthGZ, dayGZ, hourGZ] = data.data.ganzhi;

  return {
    yearGZ,
    monthGZ,
    dayGZ,
    hourGZ,
    raw: data.data, // 如果之後想玩卦象、六神，這裡整包丟給你
  };
}

// 取得完整六爻卦（本卦 / 變卦 / 六神 / 倍數碼等）
// params: { y, m, d, h, mi, yy }
// - y/m/d/h/mi：起卦的公曆日期時間
// - yy：六爻「倍數碼」或你要丟給優化老的 6 碼字串（例如 103211）
async function getLiuYaoHexagram(params) {
  const { y, m, d, h, mi, yy } = params || {};

  if (!y || !m || !d) {
    throw new Error("[youhualao ly] getLiuYaoHexagram 缺少必要日期參數");
  }

  const query = {
    c: "ly",
    key: YOUHUALAO_KEY,
    y: Number(y),
    m: Number(m),
    d: Number(d),
    h: typeof h === "number" ? h : 12,
    mi: typeof mi === "number" ? mi : 0,
    type: 1,
  };

  if (yy !== undefined && yy !== null) {
    query.yy = String(yy);
  }

  const qs = new URLSearchParams(query).toString();
  const url = `${YOUHUALAO_BASE}?${qs}`;

  const resp = await axios.get(url);
  const data = resp.data;

  if (!data || data.msg !== "ok" || !data.data) {
    throw new Error(
      "[youhualao ly] 卦象回傳格式不正確：" + JSON.stringify(data)
    );
  }

  // 直接把 data.data 原封不動丟回去給上層（裡面有 beishu / benguax / bianguax ...）
  return data.data;
}

module.exports = {
  getLiuYaoGanzhiForDate,
  getLiuYaoHexagram,
};

module.exports = {
  getLiuYaoGanzhiForDate,
};
