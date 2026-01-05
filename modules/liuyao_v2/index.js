/***************************************
 * [liuyao_v2/index.js]
 * 目的：把各子模組用 deps（pushText/pushFlex/conversationStates）組起來，再輸出給 server.js 用
 ***************************************/
const { makeLyNav } = require("./nav");

/***************************************
 * [domain] cache / parse / constants
 ***************************************/
const { lySave } = require("./domain/cache");
const { lyParse } = require("./domain/parse");
const { LIU_YAO_TOPIC_LABEL } = require("./domain/text");

/***************************************
 * [ui] flex
 ***************************************/
const { lyMenuFlex } = require("./ui/menu.flex");

function makeLiuyaoV2(deps) {
  /***************************************
   * [deps] 從 server.js 注入
   ***************************************/
  const { pushText, pushFlex, conversationStates } = deps;

  /***************************************
   * [nav] 組出帶 deps 的 handleLyNav
   ***************************************/
  const nav = makeLyNav({ pushText, pushFlex });

  /***************************************
   * [postback] 退神完成（liuyao_sendoff）
   * 目的：AI 結果解析 → 存 cache → 丟總覽 → 收束
   ***************************************/
  async function handleSendoffPostback(userId) {
    const currState = conversationStates?.[userId] || null;

    if (!currState || currState.mode !== "liuyao") {
      await pushText(userId, "目前沒有正在進行的六爻流程。");
      return true;
    }

    const aiText = currState.data?.pendingAiText;
    if (!aiText) {
      await pushText(
        userId,
        "我這邊還在整理內容，稍等一下再按一次「退神完成」也可以～"
      );
      return true;
    }

    try {
      /***************************************
       * 1) 解析 AI 文本 -> past/now/future/summary
       ***************************************/
      const parsed = lyParse(aiText);

      /***************************************
       * 2) 組 meta + 存 cache（讓導航能用）
       ***************************************/
      const meta = {
        topicLabel: LIU_YAO_TOPIC_LABEL?.[currState.data?.topic] || "感情",
        genderLabel: currState.data?.gender === "female" ? "女命" : "男命",
        bengua: currState.data?.hexData?.bengua || "",
        biangua: currState.data?.hexData?.biangua || "",
      };

      lySave(userId, { meta, parsed });

      /***************************************
       * 3) 丟總覽頁 + 收束落款
       ***************************************/
      // 注意：v2 的 lyMenuFlex 是注入 pushFlex 的版本
      await lyMenuFlex(pushFlex, userId, meta, parsed);

      await pushText(userId, "卦已立，神已退。\n言盡於此，願你心定路明。");

      delete conversationStates[userId];
      return true;
    } catch (e) {
      console.error("[LY_V2] sendoff error:", e);
      await pushText(
        userId,
        "我這邊送出總覽時卡了一下，請你再按一次「退神完成」🙏"
      );
      return true;
    }
  }

  return {
    /***************************************
     * [export] 給 server.js 用
     ***************************************/
    handleLyNav: nav.handleLyNav,
    handleSendoffPostback,
  };
}

module.exports = { makeLiuyaoV2 };
