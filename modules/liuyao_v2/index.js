/***************************************
 * [liuyao_v2/index.js]
 * 目的：把各子模組用 deps（pushText/pushFlex）組起來，再輸出給 server.js 用
 ***************************************/
const { makeLyNav } = require("./nav");

function makeLiuyaoV2(deps) {
  /***************************************
   * [nav] 組出帶 deps 的 handleLyNav
   ***************************************/
  const nav = makeLyNav(deps);

  return {
    handleLyNav: nav.handleLyNav,
  };
}

module.exports = { makeLiuyaoV2 };
