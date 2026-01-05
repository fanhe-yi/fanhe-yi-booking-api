/***************************************
 * liuyao_v2 (暫時空殼)
 * 先回傳跟舊版一樣的 handler，確保可以切換但不改行為
 ***************************************/
function initLiuYaoV2(deps) {
  return {
    handleFlow: async (userId, text, state, event) => {
      return await deps.handleLiuYaoFlow(userId, text, state, event);
    },
  };
}

module.exports = { initLiuYaoV2 };
