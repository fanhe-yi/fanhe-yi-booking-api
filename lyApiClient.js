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

module.exports = {
  getLiuYaoGanzhiForDate,
};
