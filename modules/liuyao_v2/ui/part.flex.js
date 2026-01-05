/***************************************
 * [Step 2-2] ui/part.flex.js
 * 目的：六爻解卦「章節頁」Flex（過去/現在/未來）
 ***************************************/
async function lyPartFlex(pushFlex, userId, meta, parsed, partKey) {
  const titleMap = { past: "① 過去", now: "② 現在", future: "③ 未來" };
  const order = ["past", "now", "future"];
  const idx = order.indexOf(partKey);
  const nextKey = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  /***************************************
   * 指令統一：六爻xxx（避免撞 MB「看總覽」）
   ***************************************/
  const keyToCmd = { past: "六爻過去", now: "六爻現在", future: "六爻未來" };
  const nextCmd = nextKey ? keyToCmd[nextKey] : "六爻總覽";

  const text =
    partKey === "past"
      ? parsed?.past
      : partKey === "now"
      ? parsed?.now
      : parsed?.future;

  /***************************************
   * Footer：
   * - 非最後頁：下一頁 + 回六爻總覽
   * - 最後頁：請老師解卦 + 回六爻總覽（避免出現兩個回總覽）
   ***************************************/
  const footerContents = [];

  if (nextKey) {
    footerContents.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: {
        type: "message",
        label: `下一頁（${titleMap[nextKey]}）`,
        text: nextCmd,
      },
    });
  } else {
    footerContents.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: "#8E6CEF",
      action: { type: "message", label: "請老師解卦", text: "預約" },
    });
  }

  footerContents.push({
    type: "button",
    style: "link",
    height: "sm",
    action: { type: "message", label: "回六爻總覽", text: "六爻總覽" },
  });

  const bubble = {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `六爻解卦｜${titleMap[partKey] || "段落"}`,
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        meta?.topicLabel
          ? {
              type: "text",
              text: `主題：${meta.topicLabel}`,
              size: "xs",
              color: "#777777",
              wrap: true,
            }
          : null,
        { type: "separator", margin: "md" },
        {
          type: "text",
          text:
            text ||
            "（這段內容解析不到。你可以回六爻總覽再點一次，或重新起卦。）",
          size: "md",
          wrap: true,
        },
      ].filter(Boolean),
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: footerContents,
    },
  };

  await pushFlex(userId, "六爻解卦段落", bubble);
}

module.exports = { lyPartFlex };
