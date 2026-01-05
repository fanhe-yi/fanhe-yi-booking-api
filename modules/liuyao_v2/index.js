/***************************************
 * [Step 5] index.js
 * 目的：把 nav 組出來，讓 server.js 可以呼叫 liuyaoV2.handleLyNav
 ***************************************/
const { makeLyNav } = require("./nav");

function initLiuYaoV2(deps) {
  const { handleLyNav } = makeLyNav(deps);

  return {
    /***************************************
     * handleFlow：你已經搬好的主流程
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
