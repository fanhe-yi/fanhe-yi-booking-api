/***************************************
 * [Step 3] nav.js
 * 目的：攔截「六爻總覽/過去/現在/未來」文字指令並回 Flex
 ***************************************/
const { lyGet } = require("./domain/cache");
const { lyMenuFlex } = require("./ui/menu.flex");
const { lyPartFlex } = require("./ui/part.flex");

function makeLyNav(deps) {
  const { pushText, pushFlex } = deps;

  async function handleLyNav(userId, text) {
    const t = String(text || "")
      .trim()
      .replace(/\s+/g, "");
    if (!t) return false;

    const allow = ["六爻總覽", "六爻過去", "六爻現在", "六爻未來"];
    if (!allow.includes(t)) return false;

    const cached = lyGet(userId);
    if (!cached) {
      await pushText(
        userId,
        "你這一卦的內容我這邊找不到了（可能已過期或你已重新起卦）。要不要重新起一卦？"
      );
      return true;
    }

    const { meta, parsed } = cached;

    if (t === "六爻總覽") {
      await lyMenuFlex(pushFlex, userId, meta, parsed);
      return true;
    }
    if (t === "六爻過去") {
      await lyPartFlex(pushFlex, userId, meta, parsed, "past");
      return true;
    }
    if (t === "六爻現在") {
      await lyPartFlex(pushFlex, userId, meta, parsed, "now");
      return true;
    }
    if (t === "六爻未來") {
      await lyPartFlex(pushFlex, userId, meta, parsed, "future");
      return true;
    }

    return false;
  }

  return { handleLyNav };
}

module.exports = { makeLyNav };
