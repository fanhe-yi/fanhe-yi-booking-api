/***************************************
 * [modules/liuyao.js]
 * 目的：把「六爻」完整流程從 server.js 拆出去
 *
 * 使用方式：
 *  const { makeLiuyao } = require("./modules/liuyao");
 *  const liuyao = makeLiuyao(deps);
 *
 *  // 1) handleLineEvent 文字輸入先讓六爻導航吃
 *  if (await liuyao.handleNav(userId, text)) return;
 *
 *  // 2) routePostback：在 server.js 先判斷是否為六爻 action
 *  if (await liuyao.routePostback(userId, params, state)) return;
 *
 *  // 3) routeByConversationState：六爻主流程（手輸入 0~3 / 指定時間）
 *  if (await liuyao.handleFlow(userId, text, state, event)) return true;
 ***************************************/

function makeLiuyao(deps) {
  const {
    // ====== LINE 推送能力（必填）======
    pushText,
    pushFlex,

    // ====== 你的既有工具（必填/選填看你專案）======
    sleep,
    quotaUsage,

    // youhualao / 卦象
    getLiuYaoHexagram,
    buildLiuYaoTimeParams,

    // 你原本的解析與格式化
    describeSixLines,
    buildElementPhase,

    // AI
    AI_Reading,

    // 你的生日輸入 parser（你用在指定時間）
    parseMiniBirthInput,

    // （選填）中文轉換用
    toTW,
  } = deps;

  /***************************************
   * 常數：主題 label
   ***************************************/
  const LIU_YAO_TOPIC_LABEL = {
    love: "感情",
    career: "事業",
    wealth: "財運",
    health: "健康",
  };

  /***************************************
   * [六爻結果 Cache]：章節導覽用
   ***************************************/
  const LY_TTL = 30 * 60 * 1000; // 30 分鐘
  const lyCache = new Map();

  function lySave(userId, payload) {
    lyCache.set(userId, { ...payload, ts: Date.now() });
  }

  function lyGet(userId) {
    const v = lyCache.get(userId);
    if (!v) return null;
    if (Date.now() - v.ts > LY_TTL) {
      lyCache.delete(userId);
      return null;
    }
    return v;
  }

  /***************************************
   * [六爻文字 Parser]：把 AI 回覆拆成 ①②③ + 總結
   ***************************************/
  function lyParse(aiText = "") {
    const text = String(aiText || "").trim();

    const sumMatch = text.match(/(?:總結|結論)[\s：:]*([\s\S]*)$/);
    const summary = sumMatch ? `總結：${sumMatch[1].trim()}` : "";

    const p1 = pickBlock(text, /①[\s\S]*?(?=②|$)/);
    const p2 = pickBlock(text, /②[\s\S]*?(?=③|$)/);
    const p3 = pickBlock(text, /③[\s\S]*?(?=$)/);

    const future = summary
      ? p3.replace(/(?:總結|結論)[\s\S]*$/g, "").trim()
      : p3;

    return {
      past: p1.trim(),
      now: p2.trim(),
      future: future.trim(),
      summary: summary.trim(),
      raw: text,
    };

    function pickBlock(src, re) {
      const m = src.match(re);
      return m ? m[0] : "";
    }
  }

  /***************************************
   * ✅ 六爻導航（聊天室輸入：六爻總覽 / 六爻過去 / 六爻現在 / 六爻未來）
   ***************************************/
  async function handleNav(userId, text) {
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
      await lyMenuFlex(userId, meta, parsed);
      return true;
    }
    if (t === "六爻過去") {
      await lyPartFlex(userId, meta, parsed, "past");
      return true;
    }
    if (t === "六爻現在") {
      await lyPartFlex(userId, meta, parsed, "now");
      return true;
    }
    if (t === "六爻未來") {
      await lyPartFlex(userId, meta, parsed, "future");
      return true;
    }
    return false;
  }

  /***************************************
   * ✅ routePostback：只吃「六爻 action」
   * - 你在 server.js 解析完 URLSearchParams 後，把 params/state 丟進來
   ***************************************/
  async function routePostback(userId, params, state) {
    const params = new URLSearchParams(data);
    const action = params.get("action");

    // 不是六爻 action 就不處理
    if (!action || !String(action).startsWith("liuyao_")) return false;

    // 你的 state 來源：server.js 會傳進來（state 或 conversationStates[userId]）
    const currState = state;

    // ⭐ 六爻：選主題
    if (action === "liuyao_topic") {
      const topic = params.get("topic");
      const allow = ["love", "career", "wealth", "health"];

      if (!allow.includes(topic)) {
        await pushText(userId, "這個占卜主題我看不懂，請重新點一次按鈕試試。");
        return true;
      }

      // 這段由 server.js 建 state 比較好
      // 因為 conversationStates 仍在 server.js 管理
      // 所以這裡回傳一個「狀態建議」給 server.js 套用
      return {
        handled: true,
        nextState: { mode: "liuyao", stage: "wait_gender", data: { topic } },
        reply: async () => {
          await deps.sendGenderSelectFlex(userId, {
            title: "六爻占卜 · 性別選擇",
            actionName: "liuyao_gender",
          });
        },
      };
    }

    // ✅ 六爻占卜：選擇男/女
    if (action === "liuyao_gender") {
      const gender = params.get("gender");
      if (!currState || currState.mode !== "liuyao") {
        await pushText(
          userId,
          "目前沒有正在進行的六爻占卜流程，想開始請輸入「六爻占卜」。"
        );
        return true;
      }

      if (!["male", "female"].includes(gender)) {
        await pushText(userId, "性別選擇怪怪的，請再選一次～");
        await deps.sendGenderSelectFlex(userId, {
          title: "六爻占卜 · 性別選擇",
          actionName: "liuyao_gender",
        });
        return true;
      }

      currState.data = currState.data || {};
      currState.data.gender = gender;
      currState.stage = "wait_time_mode";

      await deps.sendLiuYaoTimeModeFlex(userId);
      return { handled: true, mutatedState: currState };
    }

    // 六爻：選起卦時間模式
    if (action === "liuyao_time_mode") {
      const mode = params.get("mode");
      if (!currState || currState.mode !== "liuyao") {
        await pushText(
          userId,
          "目前沒有正在進行的六爻占卜流程，如果要重來，可以先輸入「六爻占卜」。"
        );
        return true;
      }

      if (mode === "now") {
        currState.data.timeMode = "now";
        currState.data.questionTime = new Date().toISOString();
        currState.stage = "collect_yao_notice";

        await sendLiuYaoNoticeAndAskFirstYao(userId, currState);
        return { handled: true, mutatedState: currState };
      }

      if (mode === "custom") {
        currState.data.timeMode = "custom";
        currState.stage = "wait_custom_time_input";

        await pushText(
          userId,
          "好的，我們用「指定時間」起卦。\n\n請輸入此卦的時間點，格式如下：\n\n" +
            "1) 2025-11-24-2150\n" +
            "2) 2025-11-24-亥時\n" +
            "3) 2025-11-24-亥\n\n" +
            "⚠️ 六爻起卦盡量不要用「未知」，至少要大約時辰區間。"
        );
        return { handled: true, mutatedState: currState };
      }

      await pushText(userId, "起卦時間的選項怪怪的，請再點一次按鈕看看。");
      return true;
    }

    // 儀式關卡 1：靜心完成 → 請神文
    if (action === "liuyao_calm") {
      if (!currState || currState.mode !== "liuyao") {
        await pushText(
          userId,
          "目前沒有正在進行的六爻流程。想開始請輸入：六爻占卜"
        );
        return true;
      }

      const topicLabel = LIU_YAO_TOPIC_LABEL[currState.data?.topic] || "感情";
      currState.stage = "wait_spelled";

      await sendLiuYaoSpellFlex(userId, topicLabel);
      return { handled: true, mutatedState: currState };
    }

    // 儀式關卡 2：請神完成 → 開始搖爻
    if (action === "liuyao_spelled") {
      if (!currState || currState.mode !== "liuyao") {
        await pushText(
          userId,
          "目前沒有正在進行的六爻流程。想開始請輸入：六爻占卜"
        );
        return true;
      }

      currState.stage = "wait_start_roll";
      await sendLiuYaoStartRollFlex(userId);
      return { handled: true, mutatedState: currState };
    }

    // 儀式關卡 3：開始搖爻 → collect_yao
    if (action === "liuyao_start_roll") {
      if (!currState || currState.mode !== "liuyao") {
        await pushText(
          userId,
          "目前沒有正在進行的六爻流程。想開始請輸入：六爻占卜"
        );
        return true;
      }

      currState.stage = "collect_yao";
      currState.data.yaoIndex = 1;
      currState.data.yy = "";

      await pushText(userId, "第一爻。請默念問題，然後擲幣。");
      await sendLiuYaoRollFlex(userId, 1, "");
      return { handled: true, mutatedState: currState };
    }

    // 儀式關卡 5：過中爻後「默念完畢」→ 進第四爻
    if (action === "liuyao_mid_continue") {
      if (!currState || currState.mode !== "liuyao") {
        await pushText(
          userId,
          "目前沒有正在進行的六爻流程。想開始請輸入：六爻占卜"
        );
        return true;
      }
      if (currState.stage !== "wait_mid_gate") {
        await pushText(userId, "目前不在過中爻的節點，請繼續依流程操作即可。");
        return true;
      }

      currState.stage = "collect_yao";
      await pushText(userId, "第四爻。請默念問題，然後擲幣。");
      await sendLiuYaoRollFlex(userId, 4, currState.data?.yy || "");
      return { handled: true, mutatedState: currState };
    }

    // ✅ 六爻：擲幣選「人頭數」（0~3）
    if (action === "liuyao_roll") {
      const v = params.get("v");
      if (!/^[0-3]$/.test(v)) {
        await pushText(userId, "這次選擇怪怪的，請再選一次～");
        if (currState?.mode === "liuyao" && currState.stage === "collect_yao") {
          await sendLiuYaoRollFlex(
            userId,
            currState.data?.yaoIndex || 1,
            currState.data?.yy || ""
          );
        }
        return true;
      }

      if (
        !currState ||
        currState.mode !== "liuyao" ||
        currState.stage !== "collect_yao"
      ) {
        await pushText(userId, "目前沒有在起卦流程中。想占卜請輸入：六爻占卜");
        return true;
      }

      if (!currState.data.yy) currState.data.yy = "";
      if (!currState.data.yaoIndex) currState.data.yaoIndex = 1;

      const nowIndex = currState.data.yaoIndex;
      currState.data.yy += v;
      currState.data.yaoIndex = nowIndex + 1;

      await pushText(userId, `第 ${nowIndex} 爻已定。天地有應。`);

      // 過中爻
      if (nowIndex === 3) {
        currState.stage = "wait_mid_gate";
        await sendLiuYaoMidGateFlex(userId);
        return { handled: true, mutatedState: currState };
      }

      // 未滿 6
      if (currState.data.yy.length < 6) {
        await sendLiuYaoRollFlex(
          userId,
          currState.data.yaoIndex,
          currState.data.yy
        );
        return { handled: true, mutatedState: currState };
      }

      // ✅ 六爻俱全：先封卦 → 退神 → 背後算 AI → 等使用者按「退神完成」
      const finalCode = currState.data.yy.slice(0, 6);
      currState.stage = "wait_sendoff";

      await sendLiuYaoCompleteFlex(userId, finalCode);
      await sleep(5000);
      await sendLiuYaoSendoffFlex(userId);

      // 背後算卦 + AI（算完存 pendingAiText）
      try {
        const { y, m, d, h, mi } = buildLiuYaoTimeParams(currState);
        const hexData = await getLiuYaoHexagram({
          y,
          m,
          d,
          h,
          mi,
          yy: finalCode,
        });
        currState.data.hexData = hexData;

        const { aiText } = await callLiuYaoAI({
          genderText: currState.data.gender === "female" ? "女命" : "男命",
          topicText: LIU_YAO_TOPIC_LABEL[currState.data.topic] || "感情",
          hexData: currState.data.hexData,
        });

        currState.data.pendingAiText = aiText;

        // quota 在「AI 完成」才扣
        await quotaUsage(userId, "liuyao");

        currState.stage = "wait_sendoff";
        return { handled: true, mutatedState: currState };
      } catch (err) {
        console.error("[liuyao] AI error:", err);
        await pushText(
          userId,
          "六爻解卦 AI 剛剛小卡住 😅 你可以稍後再試一次。"
        );
        return { handled: true, resetState: true };
      }
    }

    // 儀式關卡 4：退神完成（送總覽）
    if (action === "liuyao_sendoff") {
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

      const parsed = lyParse(aiText);
      const meta = {
        topicLabel: LIU_YAO_TOPIC_LABEL?.[currState.data?.topic] || "感情",
        genderLabel: currState.data?.gender === "female" ? "女命" : "男命",
        bengua: currState.data?.hexData?.bengua || "",
        biangua: currState.data?.hexData?.biangua || "",
      };

      lySave(userId, { meta, parsed });
      await lyMenuFlex(userId, meta, parsed);
      await pushText(userId, "卦已立，神已退。\n言盡於此，願你心定路明。");

      return { handled: true, resetState: true };
    }

    // 沒吃到的六爻 action：當作已處理（避免落回 server.js default）
    await pushText(userId, `（六爻）我有收到你的選擇：${params.toString()}`);
    return true;
  }

  /***************************************
   * ✅ 六爻主流程：處理「手動輸入」
   * - 指定時間：wait_custom_time_input
   * - 手打人頭數：collect_yao（0~3）
   ***************************************/
  async function handleFlow(userId, text, state, event) {
    if (!state || state.mode !== "liuyao") return false;

    const trimmed = (text || "").trim();

    // 1) 指定起卦時間
    if (state.stage === "wait_custom_time_input") {
      const birth = parseMiniBirthInput(trimmed);
      if (!birth || !birth.date || birth.timeType === "unknown") {
        await pushText(
          userId,
          "時間格式好像怪怪的，或者沒有包含時辰。\n\n請用這種格式再輸入一次，例如：\n" +
            "- 2025-11-24-2150\n" +
            "- 2025-11-24-亥時\n" +
            "- 2025-11-24-亥"
        );
        return true;
      }

      state.data.customBirth = birth;
      state.stage = "collect_yao_notice";

      await sendLiuYaoNoticeAndAskFirstYao(userId, state);
      return true;
    }

    // 2) 手打 0~3（人頭數）
    if (state.stage === "collect_yao") {
      if (!state.data.yy) state.data.yy = "";
      if (!state.data.yaoIndex) state.data.yaoIndex = 1;

      if (!/^[0-3]$/.test(trimmed)) {
        await pushText(
          userId,
          "請選擇「人頭數」（推薦用按鈕），或直接輸入 0～3。\n\n" +
            "0=零個人頭、1=一個人頭、2=兩個人頭、3=三個人頭。"
        );
        await sendLiuYaoRollFlex(userId, state.data.yaoIndex, state.data.yy);
        return true;
      }

      // 這裡不要重複寫一份完整邏輯（避免雙維護）
      // 直接叫 routePostback 的 liuyao_roll 邏輯最乾淨
      // 但我們現在沒有 params，所以用一個小 helper：
      await applyRollValueFromText(userId, state, trimmed);
      return true;
    }

    return false;
  }

  async function applyRollValueFromText(userId, state, v) {
    // 模擬一個最小處理（跟 postback 一致）
    if (!/^[0-3]$/.test(v)) return;

    const nowIndex = state.data.yaoIndex || 1;
    state.data.yy = (state.data.yy || "") + v;
    state.data.yaoIndex = nowIndex + 1;

    await pushText(userId, `第 ${nowIndex} 爻已定。天地有應。`);

    if (nowIndex === 3) {
      state.stage = "wait_mid_gate";
      await sendLiuYaoMidGateFlex(userId);
      return;
    }

    if (state.data.yy.length < 6) {
      await sendLiuYaoRollFlex(userId, state.data.yaoIndex, state.data.yy);
      return;
    }

    // 手打走到 6 的話：你要不要也走「封卦→退神→AI→按鈕」？
    // 我建議統一走同一套（跟 postback 完全一致）
    const finalCode = state.data.yy.slice(0, 6);
    state.stage = "wait_sendoff";

    await sendLiuYaoCompleteFlex(userId, finalCode);
    await sleep(5000);
    await sendLiuYaoSendoffFlex(userId);

    try {
      const { y, m, d, h, mi } = buildLiuYaoTimeParams(state);
      const hexData = await getLiuYaoHexagram({
        y,
        m,
        d,
        h,
        mi,
        yy: finalCode,
      });
      state.data.hexData = hexData;

      const { aiText } = await callLiuYaoAI({
        genderText: state.data.gender === "female" ? "女命" : "男命",
        topicText: LIU_YAO_TOPIC_LABEL[state.data.topic] || "感情",
        hexData: state.data.hexData,
      });

      state.data.pendingAiText = aiText;
      await quotaUsage(userId, "liuyao");
      state.stage = "wait_sendoff";
    } catch (err) {
      console.error("[liuyao] AI error:", err);
      await pushText(userId, "六爻解卦 AI 剛剛小卡住 😅 你可以稍後再試一次。");
      // server.js 會把 state 清掉（你待會接鉤時做）
    }
  }

  /***************************************
   * ===== 以下是你原本的 Flex helper（幾乎原封不動）=====
   * 你貼的內容我就不再重複抄兩遍了
   * 你把下面這些 function 全部原樣搬進來即可：
   *
   * - sendLiuYaoNoticeFlex
   * - sendLiuYaoSpellFlex
   * - sendLiuYaoNoticeAndAskFirstYao
   * - sendLiuYaoStartRollFlex
   * - sendLiuYaoRollFlex
   * - sendLiuYaoMidGateFlex
   * - sendLiuYaoCompleteFlex
   * - sendLiuYaoSendoffFlex
   * - inferUseGod
   * - callLiuYaoAI
   * - lyMenuFlex
   * - lyPartFlex
   * - lyAllCarousel（可留可刪）
   ***************************************/

  // 你貼的 helper 我只保留「callLiuYaoAI + inferUseGod」這兩個會被用到的
  function inferUseGod({ topicText, genderText }) {
    const gender = (genderText || "").includes("女") ? "female" : "male";
    const t = (topicText || "").trim();

    if (t.includes("感情")) return gender === "female" ? "官鬼" : "妻財";
    if (t.includes("事業") || t.includes("工作")) return "父母";
    if (t.includes("財運") || t.includes("金錢") || t.includes("偏財"))
      return "妻財";
    if (t.includes("健康")) return "子孫";
    return "";
  }

  async function callLiuYaoAI({ genderText, topicText, hexData, useGodText }) {
    const finalUseGodText =
      useGodText || inferUseGod({ topicText, genderText }) || "用神";

    const gzArr = (hexData && hexData.ganzhi) || [];
    const gzLabels = ["年", "月", "日", "時"];
    const gzText =
      gzArr && gzArr.length
        ? gzArr
            .slice(0, 4)
            .map((v, i) => `${v}${gzLabels[i] || ""}`)
            .join("，")
        : "（干支資料缺失）";

    let phaseText = "";
    try {
      const phase = buildElementPhase(gzArr);
      phaseText = phase?.text ? phase.text : "";
    } catch (e) {
      phaseText = "";
    }

    const xk = Array.isArray(hexData?.xunkong) ? hexData.xunkong[2] : "";
    const xkText = xk ? `旬空：${xk}空` : "";

    const sixLinesText = describeSixLines(hexData);

    const systemPrompt =
      "你是一個六爻解卦大師，講話要務實、清楚、有條理，不宿命論、不恐嚇。\n" +
      "結論分段輸出①過去 ②現在 ③未來\n" +
      "並拿掉六爻的專業術語，可以比較嘴炮風又帶親切的回覆\n" +
      "整體不要超過1000中文字";

    const userPrompt =
      `你是一個六爻解卦大師\n` +
      `今天有${genderText}\n` +
      `主題：${topicText}\n` +
      `本卦：${hexData?.bengua || "（缺）"}\n` +
      `變卦：${hexData?.biangua || "（缺）"}\n` +
      `${gzText}\n` +
      (phaseText ? `${phaseText}\n` : "") +
      (xkText ? `${xkText}\n` : "") +
      `\n` +
      `${sixLinesText}\n` +
      `\n` +
      `${genderText}${topicText}\n` +
      `以${finalUseGodText}為用神\n` +
      `請你解卦,最後請以繁體中文回覆`;

    const aiText = await AI_Reading(userPrompt, systemPrompt);
    return { aiText, userPrompt, systemPrompt };
  }

  // ✅ 這三個是你貼的「儀式入口」會用到的
  async function sendLiuYaoNoticeAndAskFirstYao(userId, state) {
    const topic = state?.data?.topic || "general";
    const topicLabel = LIU_YAO_TOPIC_LABEL[topic] || "這件事情";

    state.stage = "wait_calm";
    await sendLiuYaoNoticeFlex(userId, topicLabel);
  }

  // ============================
  // ✅ Helper: 占卜前使用說明 Bubble
  // ============================
  async function sendLiuYaoNoticeFlex(userId, topicLabel = "這件事情") {
    const contents = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "卜卦前",
            weight: "bold",
            size: "xl",
            wrap: true,
          },
          {
            type: "text",
            text: "在開始之前，請先把心放穩。",
            size: "md",
            wrap: true,
          },

          { type: "separator", margin: "md" },

          {
            type: "text",
            text:
              "這一卦，只問一件事。\n" +
              "請你想清楚正在發生、或即將發生的情況，" +
              "不要同時放進太多問題。",
            size: "sm",
            color: "#555555",
            wrap: true,
          },

          {
            type: "text",
            text:
              "起卦之前，讓自己靜一下。\n" +
              "問題越清楚，卦象才會回應得越清楚。",
            size: "sm",
            color: "#555555",
            wrap: true,
          },

          { type: "separator", margin: "md" },

          {
            type: "text",
            text: `現在，請你在心中專注於\n「${topicLabel}」`,
            size: "md",
            wrap: true,
          },
          {
            type: "text",
            text: "準備好後，再進入下一步。",
            size: "xs",
            color: "#999999",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#8E6CEF",
            margin: "md",
            action: {
              type: "postback",
              label: "我已準備好",
              data: "action=liuyao_calm",
              displayText: "我已準備好",
            },
          },
        ],
      },
    };

    await pushFlex(userId, "六爻占卜須知", contents);

    function bullet(title, desc) {
      return {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        contents: [
          {
            type: "text",
            text: `・${title}`,
            weight: "bold",
            size: "md",
            wrap: true,
          },
          {
            type: "text",
            text: desc,
            size: "sm",
            color: "#666666",
            wrap: true,
          },
        ],
      };
    }
  }

  // ============================
  // ✅ Helper: 請神文 Bubble（默念版，不收個資，只帶 topicLabel）
  // ============================
  async function sendLiuYaoSpellFlex(userId, topicLabel = "此事") {
    const verse =
      "陰陽日月最長生，可惜天理難分明\n" + "今有真聖鬼谷子，一出天下定太平\n";

    const invocation =
      "拜請八卦祖師、伏羲、文王、周公\n、孔子、五大聖賢、智聖王禪老祖及孫臏真人、" +
      "諸葛孔明真人、陳摶真人、劉伯溫真人、野鶴真人、九天玄女、觀世音菩薩、混元禪師、\n" +
      "十方世界諸天神聖佛菩薩器眾、飛天過往神聖、本地主司福德正神、\n排卦童子、成卦童郎--\n" +
      "駕臨指示聖卦。";

    const disciple =
      `今有弟子(姓名)，性別(男/女)，\n出生某年次，住在(地址)。\n` +
      `今為「${topicLabel}」憂疑難決，\n` +
      "請諸神佛依實指示聖卦。\n" +
      "先求內卦三爻，再求外卦三爻。\n";

    const contents = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        backgroundColor: "#F7F3ED", // ← 宣紙感
        contents: [
          {
            type: "text",
            text: "請神文",
            weight: "bold",
            size: "xl",
            wrap: true,
          },
          {
            type: "text",
            text: "請默念，並逐字照念。",
            size: "xs",
            color: "#777777",
            wrap: true,
          },

          { type: "separator", margin: "md" },

          // 起首
          hint("起首"),
          bodyBig(verse),

          // 拜請
          hint("拜請"),
          //...chunkToBigTexts(invocation, 80),
          bodyBig(invocation),

          // 稟告
          hint("稟告"),
          bodyBig(disciple),

          {
            type: "text",
            text: "默念完畢後，按下方按鈕。",
            size: "xs",
            color: "#999999",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        backgroundColor: "#FFFFFF",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#8E6CEF",
            margin: "md",
            action: {
              type: "postback",
              label: "我已請神",
              data: "action=liuyao_spelled",
              displayText: "我已請神",
            },
          },
        ],
      },
    };

    await pushFlex(userId, "六爻請神文", contents);

    // 小標題（淡）
    function hint(t) {
      return {
        type: "text",
        text: t,
        size: "xs",
        color: "#999999",
        wrap: true,
      };
    }

    // 正文（放大）
    function bodyBig(t) {
      return {
        type: "text",
        text: t,
        size: "md",
        color: "#222222",
        wrap: true,
      };
    }

    // 長段落切段（避免 Flex 爆）
    function chunkToBigTexts(str, size) {
      const out = [];
      let i = 0;
      while (i < str.length) {
        out.push(bodyBig(str.slice(i, i + size)));
        i += size;
      }
      return out;
    }
  }

  // 六爻 請神後「開始搖爻」（primary button）
  async function sendLiuYaoStartRollFlex(userId) {
    const contents = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "請神儀式",
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          { type: "separator" },
          {
            type: "text",
            text: "請你在心裡（或小聲）唸完請神文。\n唸完後，按下開始搖爻。",
            size: "sm",
            color: "#666666",
            wrap: true,
          },
          {
            type: "button",
            style: "primary",
            color: "#8E6CEF",
            margin: "md",
            action: {
              type: "postback",
              label: "開始搖爻",
              data: "action=liuyao_start_roll",
              displayText: "開始搖爻",
            },
          },
        ],
      },
    };
    await pushFlex(userId, "請神儀式", contents);
  }

  // 六爻 送出「選人頭數」的 Flex（每一爻共用）
  async function sendLiuYaoRollFlex(userId, yaoIndex, yySoFar = "") {
    const IMG_3 = "https://chen-yi.tw/liuyao/heads_3-2.jpg";
    const IMG_2 = "https://chen-yi.tw/liuyao/heads_2-2.jpg";
    const IMG_1 = "https://chen-yi.tw/liuyao/heads_1-2.jpg";
    const IMG_0 = "https://chen-yi.tw/liuyao/heads_0-2.jpg";

    // ✅ 小條形圖：6 格
    const done = yySoFar ? yySoFar.length : 0;
    // ✅ 綠色 6 格進度條（完成=綠，未完成=灰）
    function progressRow(doneCount) {
      const total = 6;
      const boxes = [];
      for (let i = 1; i <= total; i++) {
        boxes.push({
          type: "text",
          text: "■",
          size: "sm",
          weight: "bold",
          color: i <= doneCount ? "#16a34a" : "#d1d5db", // 綠 / 灰
          flex: 0,
        });
      }
      return {
        type: "box",
        layout: "horizontal",
        spacing: "xs",
        contents: boxes,
      };
    }

    const contents = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: `第 ${yaoIndex} 爻 · 擲幣結果`,
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: "請依照你實際擲出的結果選擇\n（只看人頭數即可）",
            size: "sm",
            color: "#666666",
            wrap: true,
          },

          // ✅ 進度：數字 + 小條形圖（永遠顯示，0/6 也顯示）
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            contents: [
              {
                type: "text",
                text: `進度：${done} / 6`,
                size: "xs",
                color: "#999999",
              },
              progressRow(done),
            ],
          },

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
                  imagePick(IMG_3, "三個人頭", "3"),
                  imagePick(IMG_2, "兩個人頭", "2"),
                ],
              },
              {
                type: "box",
                layout: "horizontal",
                spacing: "sm",
                contents: [
                  imagePick(IMG_1, "一個人頭", "1"),
                  imagePick(IMG_0, "零個人頭", "0"),
                ],
              },
            ],
          },

          {
            type: "text",
            text: "（也可以直接輸入 0～3 ）",
            size: "xs",
            color: "#999999",
          },
        ],
      },
    };

    await pushFlex(userId, `第 ${yaoIndex} 爻起卦`, contents);

    function imagePick(imgUrl, label, value) {
      return {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "image",
            url: imgUrl,
            size: "full",
            aspectMode: "cover",
            aspectRatio: "1:1",
            action: {
              type: "postback",
              data: `action=liuyao_roll&v=${value}`,
              displayText: label,
            },
          },
          {
            type: "text",
            text: label,
            size: "sm",
            align: "center",
          },
        ],
        cornerRadius: "12px",
        borderWidth: "1px",
        borderColor: "#EEEEEE",
        paddingAll: "6px",
      };
    }
  }

  // 六爻過中爻「過門」Flex（第 3 爻結束後使用）
  async function sendLiuYaoMidGateFlex(userId) {
    const contents = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "下卦已成\n卦象逐漸成形",
            weight: "bold",
            size: "xl",
            wrap: true,
          },

          // ───── 進度條區塊 ─────
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            margin: "md",
            contents: [
              {
                type: "text",
                text: "進度 3 / 6",
                size: "xs",
                color: "#2E7D32", // 深綠
              },
              {
                type: "box",
                layout: "horizontal",
                height: "8px",
                backgroundColor: "#E0E0E0", // 灰底
                contents: [
                  {
                    type: "box",
                    layout: "vertical",
                    flex: 3,
                    backgroundColor: "#4CAF50", // 綠色進度
                    contents: [],
                  },
                  {
                    type: "box",
                    layout: "vertical",
                    flex: 3,
                    backgroundColor: "#E0E0E0",
                    contents: [],
                  },
                ],
              },
            ],
          },
          // ───────────────────

          {
            type: "separator",
            margin: "md",
          },
          {
            type: "text",
            text:
              "請你默念：\n\n" +
              "「內卦三爻吉凶未判」\n「再求外卦三爻，以成全卦。」",
            size: "md",
            wrap: true,
          },
          {
            type: "text",
            text: "默念完畢後，按下方按鈕，進入第四爻。",
            size: "xs",
            color: "#999999",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#8E6CEF",
            margin: "md",
            action: {
              type: "postback",
              label: "默念完畢，進入第四爻",
              data: "action=liuyao_mid_continue",
              displayText: "默念完畢",
            },
          },
        ],
      },
    };

    await pushFlex(userId, "下卦已成", contents);
  }

  // 六爻 完成版六爻
  async function sendLiuYaoCompleteFlex(userId, finalCode) {
    const contents = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "六爻俱全",
            weight: "bold",
            size: "xl",
            wrap: true,
          },
          {
            type: "text",
            text: "此卦卦已立，正在封卦。",
            size: "sm",
            color: "#666666",
            wrap: true,
          },

          // ✅ 6/6 綠色條
          {
            type: "box",
            layout: "horizontal",
            spacing: "xs",
            contents: Array.from({ length: 6 }).map(() => ({
              type: "text",
              text: "■",
              size: "sm",
              weight: "bold",
              color: "#16a34a",
              flex: 0,
            })),
          },

          {
            type: "text",
            text: `起卦碼：${finalCode}`,
            size: "xs",
            color: "#9ca3af",
            wrap: true,
          },
          { type: "separator" },
          {
            type: "text",
            text: "接下來請做收卦退神，我會在你完成後開始解讀。",
            size: "sm",
            color: "#666666",
            wrap: true,
          },
        ],
      },
    };

    await pushFlex(userId, "六爻完成", contents);
  }

  // 六爻 退神儀式
  async function sendLiuYaoSendoffFlex(userId) {
    const contents = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "收卦 · 退神",
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          { type: "separator" },
          {
            type: "text",
            text:
              "卦已立，謝神明指引。\n請念以下退神文：\n「於今六爻已成，吉凶分判\n" +
              "弟子(姓名)在此叩謝\n" +
              "十方世界諸佛菩薩。」\n" +
              "完成後，我會把此卦解讀送上。",
            size: "sm",
            color: "#666666",
            wrap: true,
          },
          {
            type: "button",
            style: "primary",
            color: "#8E6CEF",
            margin: "md",
            action: {
              type: "postback",
              label: "收卦 · 退神",
              data: "action=liuyao_sendoff",
              displayText: "退神完成",
            },
          },
        ],
      },
    };
    await pushFlex(userId, "退神儀式", contents);
  }

  /***************************************
   * [六爻總覽 Flex]：1 張總覽 + 2×2 章節選單 + Footer CTA
   ***************************************/
  async function lyMenuFlex(userId, meta, parsed) {
    const {
      topicLabel = "六爻占卜",
      genderLabel = "",
      bengua = "",
      biangua = "",
    } = meta || {};
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

          // ✅ 本卦一行、變卦一行（不用 \n / join）
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

          /*
  {
    type: "text",
    text: "一句話總結",
    size: "sm",
    weight: "bold",
    color: "#555555",
  },
  */
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

          /* 1×3 選單（box 當按鈕） */
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

      /* Footer：回到流程 / 請老師解卦（接 booking） */
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

  /***************************************
   * [六爻章節頁 Flex]：單頁（過去/現在/未來）
   * Footer：下一頁 / 回總覽
   ***************************************/
  async function lyPartFlex(userId, meta, parsed, partKey) {
    /***************************************
     * [章節設定]：標題 + 順序 + 下一頁
     ***************************************/
    const titleMap = { past: "① 過去", now: "② 現在", future: "③ 未來" };
    const order = ["past", "now", "future"];
    const idx = order.indexOf(partKey);
    const nextKey = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

    /***************************************
     * [章節內容]：依 partKey 取對應段落文字
     ***************************************/
    const text =
      partKey === "past"
        ? parsed?.past
        : partKey === "now"
        ? parsed?.now
        : parsed?.future;

    /***************************************
     * [按鈕指令]：避免跟八字「看總覽」撞名
     * - 六爻全部用「六爻xxx」指令
     ***************************************/
    const keyToCmd = {
      past: "六爻過去",
      now: "六爻現在",
      future: "六爻未來",
    };
    const nextCmd = nextKey ? keyToCmd[nextKey] : "六爻總覽";

    /***************************************
     * [Footer CTA]：
     * - 非最後一頁：主按鈕 = 下一頁
     * - 最後一頁：主按鈕 = 請老師解卦（避免跟回總覽重複）
     * - 永遠保留：link = 回六爻總覽
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
        action: {
          type: "message",
          label: "請老師解卦",
          text: "預約",
        },
      });
    }

    footerContents.push({
      type: "button",
      style: "link",
      height: "sm",
      action: { type: "message", label: "回六爻總覽", text: "六爻總覽" },
    });

    /***************************************
     * [Flex Bubble]：單頁章節卡
     ***************************************/
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
          {
            type: "text",
            text: meta?.topicLabel ? `主題：${meta.topicLabel}` : "",
            size: "xs",
            color: "#777777",
            wrap: true,
          },
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

  /***************************************
   * 對外輸出（server.js 會用到）
   ***************************************/
  return {
    handleNav,
    handleFlow,
    routePostback,
  };
}

module.exports = { makeLiuyao };
