/***************************************
 * [Step 5] index.js
 * 目的：把 nav 組出來，讓 server.js 可以呼叫 liuyaoV2.handleLyNav
 ***************************************/
const { makeLyNav } = require("./nav");

/***************************************
 * liuyao_v2 (暫時空殼)
 * 先回傳跟舊版一樣的 handler，確保可以切換但不改行為
 ***************************************/
function initLiuYaoV2(deps) {
  const { handleLyNav } = makeLyNav(deps);

  return {
    /***************************************
     * handleFlow：已經搬好的主流程
     ***************************************/
    handleFlow: async (userId, text, state, event) => {
      return await deps.handleLiuYaoFlow(userId, text, state, event);
    },

    /***************************************
     * handleLyNav：新增（章節點擊/總覽）
     ***************************************/
    handleLyNav,
  };
}

module.exports = { initLiuYaoV2 };
