/***************************************
 * [Step 2-1] ui/menu.flex.js
 * 目的：六爻解卦「總覽頁」Flex（含 1×3 box 按鈕）
 ***************************************/
const { toTW } = require("../domain/text");

async function lyMenuFlex(pushFlex, userId, meta, parsed) {
  const { topicLabel = "六爻占卜", bengua = "", biangua = "" } = meta || {};
  const oneLiner =
    parsed?.summary || "總結：我先幫你把重點收斂好了，你可以挑你想看的段落。";

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
          text: `六爻占卜｜${topicLabel}`,
          weight: "bold",
          size: "lg",
          wrap: true,
        },

        /***************************************
         * 本卦 / 變卦：一行一個 text（你要的版型）
         ***************************************/
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            ...(bengua
              ? [
                  {
                    type: "text",
                    text: `本卦 - ${toTW(bengua)}`,
                    size: "xs",
                    color: "#777777",
                    wrap: true,
                  },
                ]
              : []),
            ...(biangua
              ? [
                  {
                    type: "text",
                    text: `變卦 - ${toTW(biangua)}`,
                    size: "xs",
                    color: "#777777",
                    wrap: true,
                  },
                ]
              : []),
          ],
        },

        { type: "separator", margin: "md" },

        {
          type: "text",
          text: oneLiner,
          size: "md",
          wrap: true,
        },

        { type: "separator", margin: "md" },

        {
          type: "text",
          text: "你想先看哪段？",
          size: "sm",
          weight: "bold",
          color: "#555555",
        },

        /***************************************
         * 章節選單：全部只送「六爻xxx」避免撞八字
         ***************************************/
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                lyBox("看過去", "六爻過去", "#F5EFE6"),
                lyBox("看現在", "六爻現在", "#F0F4F8"),
                lyBox("看未來", "六爻未來", "#EEF6F0"),
              ],
            },
          ],
        },
      ],
    },

    /***************************************
     * Footer：你現在的設計（先保持一致）
     * - 回到流程：先留著（你之後要接主選單再改）
     * - 請老師解卦：導去「預約」
     ***************************************/
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "message", label: "回到流程", text: "回到流程" },
        },
        {
          type: "button",
          style: "primary",
          height: "sm",
          color: "#8E6CEF",
          action: { type: "message", label: "請老師解卦", text: "預約" },
        },
      ],
    },
  };

  await pushFlex(userId, "六爻解卦總覽", bubble);

  function lyBox(label, text, bgColor) {
    return {
      type: "box",
      layout: "vertical",
      flex: 1,
      paddingAll: "md",
      cornerRadius: "12px",
      backgroundColor: bgColor,
      justifyContent: "center",
      alignItems: "center",
      action: { type: "message", label, text },
      contents: [
        {
          type: "text",
          text: label,
          size: "md",
          weight: "bold",
          align: "center",
          wrap: true,
          color: "#333333",
        },
      ],
    };
  }
}

module.exports = { lyMenuFlex };
