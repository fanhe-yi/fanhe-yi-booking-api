/***************************************
 * [liuyao_v2/sendoff.js]
 * 目的：處理「退神完成」後的收束動作
 * - 解析 AI 文本 -> past/now/future/summary
 * - 存 cache（讓使用者點章節）
 * - 丟總覽 Flex
 * - 丟收束文字
 ***************************************/
function makeLySendoff(deps) {
  const { pushText } = deps;
  const { lySave } = require("./domain/cache");
  const { lyParse } = require("./domain/parse");
  const { lyMenuFlex } = require("./ui/menu.flex");
  const { LIU_YAO_TOPIC_LABEL } = require("./constants"); // 你有就用，沒有就先改成簡單 map

  /***************************************
   * handleSendoff
   * @param {string} userId
   * @param {object} currState - conversationStates[userId] 那包
   ***************************************/
  async function handleSendoff(userId, currState) {
    const aiText = currState?.data?.pendingAiText;
    if (!aiText) {
      await pushText(
        userId,
        "我這邊還在整理內容，稍等一下再按一次「退神完成」也可以～"
      );
      return { ok: false, reason: "no_aiText" };
    }

    /***************************************
     * [1] 解析 AI 文本
     ***************************************/
    const parsed = lyParse(aiText);

    /***************************************
     * [2] 組 meta（總覽頁要用）
     ***************************************/
    const topicKey = currState?.data?.topic;
    const topicLabel =
      (LIU_YAO_TOPIC_LABEL && LIU_YAO_TOPIC_LABEL[topicKey]) || "感情";

    const meta = {
      topicLabel,
      genderLabel: currState?.data?.gender === "female" ? "女命" : "男命",
      bengua: currState?.data?.hexData?.bengua || "",
      biangua: currState?.data?.hexData?.biangua || "",
    };

    /***************************************
     * [3] 存 cache：讓「六爻過去/現在/未來」能點
     ***************************************/
    lySave(userId, { meta, parsed });

    /***************************************
     * [4] 丟總覽頁
     ***************************************/
    await lyMenuFlex(deps, userId, meta, parsed);

    /***************************************
     * [5] 收束落款
     ***************************************/
    await pushText(userId, "卦已立，神已退。\n言盡於此，願你心定路明。");

    return { ok: true };
  }

  return { handleSendoff };
}

module.exports = { makeLySendoff };
