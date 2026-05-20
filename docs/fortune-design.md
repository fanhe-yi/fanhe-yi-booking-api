# 免費占卜功能 · 設計文件

> 給未來實作者（含另一個 Claude session）的完整 spec。
> 本文件假設你**沒有任何前情提要**，看完就能直接動手寫程式。

---

## 1. 是什麼

**LINE Bot 上的免費占卜服務**，使用者可以選一位神明、用「擲筊 + 抽籤 + AI 解讀」三段式流程獲得指引。

**MVP 第一階段**：只做**月老**（感情問題），其他神明（文昌/關聖帝君/媽祖/觀音）之後再加。

**商業定位**：免費引流工具，吸引粉絲加 LINE，後續導流到付費服務（八字 1200 / 紫微 1200 / 六爻 600 / 測字 200）。

**主要漏斗**：
```
Threads 看到貼文 → 加 LINE → 輸入「免費占卜」→ 選神明 → 擲筊 → 抽籤 → AI 解讀 → 結尾軟推預約付費
```

---

## 2. 已就緒的基礎建設

### Database schema
✅ **已建立** `fortune_draws` 表，見 `migrations/001_fortune_draws.sql`。

欄位：
| 欄位 | 型別 | 用途 |
|---|---|---|
| `id` | BIGSERIAL | PK |
| `user_id` | TEXT | LINE userId |
| `draw_date` | DATE | 台北時區 YYYY-MM-DD（**不是 timestamp，避免時區坑**）|
| `deity` | TEXT | `yuelao` / `wenchang` / `guangong` / ... |
| `poem_id` | INTEGER（可 NULL）| 抽到第幾支籤；NULL = 陰筊擋下沒抽 |
| `jiao_result` | TEXT | `shengjiao` / `xiaojiao` / `yinjiao` |
| `question_text` | TEXT | 使用者問題原文 |
| `ai_response` | TEXT | AI 解讀全文 |
| `created_at` | TIMESTAMPTZ | now() |

**Index**：
- `idx_fortune_draws_user_date(user_id, draw_date)` → quota 判定
- `idx_fortune_draws_deity_date(deity, draw_date)` → analytics

### 後端架構
- Node.js / Express 5
- 連線：`db.js` 用 `pg` 套件 + `process.env.DATABASE_URL`
- LINE Bot 邏輯主要在 `server.js`（routeGeneralCommands / handleXxxFlow / handleXxxPostback 系列）
- 既有 conversation state pattern：`const conversationStates = {}` (in-memory)
- 既有 AI 呼叫：`aiClient.js` 的 `AI_Reading` 函式（OpenAI）

---

## 3. 已確定的設計決策

| 項目 | 選擇 |
|---|---|
| 第一個神明 | 月老（感情題） |
| AI 語氣 | 古典莊重「神諭」風（**見下方 §7**）|
| Quota | **每人每天 1 次**（不分神明） |
| 結尾 CTA | 軟推 — 一個小卡片 + 一個預約 button |

---

## 4. 三大關鍵設計（本文重點）

### 4.1 笑筊 / 陰筊處理規則

#### 設計原理
擲筊是儀式感的核心。**「神明不允許」這個機制必須存在**，否則整個流程變垃圾線上算命。

但也不能太挫敗使用者，所以：

#### 規則

```
擲筊 1 次（不是傳統的擲 3 次連聖筊）
  ├─ 聖筊（shengjiao）→ 神明允許 → 進入抽籤 → poem_id 記錄
  ├─ 笑筊（xiaojiao）→ 問題不明確 → 引導用戶重描述問題 → 重擲（同一天最多重試 2 次）
  └─ 陰筊（yinjiao）→ 神明不便回答 → 引導用戶「換問題或明天再來」 → 不扣 quota
```

#### 機率分佈

```
聖筊 70%（多數通過，避免使用者挫敗）
笑筊 20%（製造重試感）
陰筊 10%（少數，但讓「神明會拒絕」變真實）
```

實作：
```js
function castJiao() {
  const r = Math.random();
  if (r < 0.70) return "shengjiao";
  if (r < 0.90) return "xiaojiao";
  return "yinjiao";
}
```

#### Quota 計算規則（重要）

```
聖筊 → 抽到籤 → poem_id 存實際數字 → 算「今天用過」
笑筊 → poem_id 留 NULL → 重試（最多 2 次）→ 第 3 次強制變聖筊或結束
陰筊 → poem_id 留 NULL → 「明天再來」→ 不算用過 quota（隔天還能用）
```

**SQL 判定「今天用過 quota 沒」**：
```sql
SELECT COUNT(*) FROM fortune_draws
 WHERE user_id = $1 AND draw_date = $2
   AND poem_id IS NOT NULL;
-- > 0 = 今天用過了
```

#### 每次擲筊都寫 row
不管結果是聖/笑/陰，**都寫一筆 row 到 fortune_draws**，方便分析：
- 笑筊 row：`poem_id=NULL, jiao_result='xiaojiao', question_text=當時問題`
- 陰筊 row：`poem_id=NULL, jiao_result='yinjiao', question_text=當時問題`
- 聖筊 row：`poem_id=<實際>, jiao_result='shengjiao', question_text=..., ai_response=...`

#### 笑筊重試 UX 訊息範本

```
（笑筊圖片 / emoji）

神明示：笑筊
籤未現，蓋因所問未明。

請者宜：將心中所問再想清楚一次，
具體述明「對誰、何事、現況如何」。

[再次擲筊] [換個問題] [離開]
```

#### 陰筊 UX 訊息範本

```
（陰筊圖片 / emoji）

神明示：陰筊
此事此時，緣未至，神不便答。

請者宜：靜待時機，或改詢他位神明。
（今日仍可改向其他神明請示，不消耗每日 quota）

[換位神明] [明天再來] [離開]
```

#### 笑筊上限為什麼是 2 次重試
- 0 次：太挫敗（一次笑筊就死）
- 2 次：給機會但有壓力（最後一次強制聖筊讓使用者完成）
- 5 次：失去儀式感（變成「按按按聖筊就好」）

第 3 次強制聖筊（避免使用者卡關離開）：
```js
let attempt = state.data.jiaoAttempt || 0;
let result = castJiao();
attempt++;
if (attempt >= 3 && result === "xiaojiao") result = "shengjiao";
state.data.jiaoAttempt = attempt;
```

---

### 4.2 100 支月老籤詩誰準備（資料來源）

#### 推薦做法：**混合**

**50 支公版 + 50 支客製**

**公版來源（推薦）**：
- 「月老百籤」傳統籤詩，超過 100 年公版，網路上多版本可查證
- 可信來源：
  - 台北霞海城隍廟（月老祖廟之一）官方公佈版
  - 紫南宮、行天宮等知名月老廟版本
  - 維基文庫「月老籤詩」條目

**取得方式**：
1. Google 搜「月老籤 1 至 100」、「月老百籤詩」
2. 找 2-3 個來源交叉比對（公版會有小差異）
3. 整理成 JSON：

```json
[
  {
    "id": 1,
    "name": "第一籤",
    "level": "上上",
    "poem": [
      "光風霽月正當時",
      "桃李芬芳遍九嶼",
      "問是姻緣天有定",
      "莫教錯過月為期"
    ],
    "category": "general_love",
    "source": "public_domain"
  },
  ...
]
```

**客製化 50 支（推薦給 AI 解讀加強）**：
- 為什麼客製：跟其他線上占卜站差異化、能對齊你的品牌語氣
- 怎麼客製：請 AI（Claude / GPT）依「七言四句傳統格律」生成 50 支，主題涵蓋：
  - 復合（10 支）
  - 曖昧進展（10 支）
  - 婚姻決定（10 支）
  - 桃花機運（10 支）
  - 放下/結束（10 支）
- **必須老師（你）親自 review 每一支**，避免 AI 寫出怪句、平仄不對、宗教冒犯

**儲存位置**：
```
/Users/casper/fanhe-yi-booking-api/fortune-deities/
  ├── yuelao-poems.json       ← 100 支月老籤詩
  ├── wenchang-poems.json     ← 未來
  └── ...
```

**結構建議**：

```json
{
  "deity": "yuelao",
  "name_display": "月老",
  "description": "司掌姻緣紅絲，問感情、桃花、復合事宜",
  "poems": [
    {
      "id": 1,
      "name": "第一籤",
      "level": "上上",
      "poem": ["桃花含露映春風", "月老紅絲尚未通", "待得緣時花再放", "莫教急火亂心中"],
      "tags": ["復合", "等待"],
      "interpretation_hint": "此籤示緣未至。求復合者，需先修整自身、不可強求"
    }
  ]
}
```

`interpretation_hint` 是給 AI 看的「籤意提示」，**不直接顯示給使用者**，幫助 AI 解讀方向不歪。

**抽籤演算法**：
```js
function drawPoem(poems) {
  const idx = Math.floor(Math.random() * poems.length);
  return poems[idx];
}
```

未來可以加「依問題類型加權抽」（例如問復合就提高「復合類」籤的權重），但 MVP 不需要。

---

### 4.3 使用者問題輸入規範

#### 規則

**字數**：30 ~ 150 字
- 太短（< 30）：「請描述清楚一點，神明才能明示」
- 太長（> 150）：「神明只需聽要點，請濃縮在 150 字內」

**內容**：月老**只接感情類問題**
- 問事業/考試/錢 → bot 提示「該類問題請問XX神明」+ deity carousel button
- 完全無關（gibberish / 罵髒話）→ bot 提示「請描述清楚你想問的事」

#### 內容過濾實作

```js
function validateFortuneQuestion(text, deity) {
  // 1. 字數
  const len = text.trim().length;
  if (len < 30) return { ok: false, reason: "too_short" };
  if (len > 150) return { ok: false, reason: "too_long" };

  // 2. 月老限感情
  if (deity === "yuelao") {
    const offTopicKeywords = ["工作", "升遷", "加薪", "考試", "升學", "投資", "股票", "創業", "搬家", "買房"];
    if (offTopicKeywords.some(k => text.includes(k))) {
      return { ok: false, reason: "off_topic_yuelao", suggested_deity: "guangong或文昌" };
    }
  }

  // 3. 沒實質內容（單一重複字、純符號）
  if (/^([^一-龥\w])\1+$/.test(text.trim())) {
    return { ok: false, reason: "no_content" };
  }

  return { ok: true };
}
```

#### 訊息範本

**Too short**：
```
神明傾聽，但聲音太細不易明示。
請將你心中所問再描述完整一些，
含「對誰、何事、現況如何」三要素。
（至少 30 字）
```

**Too long**：
```
神明示意：所問過繁。
請者宜將心中重點濃縮為 150 字內，
擇最關鍵的事項問之。
```

**Off-topic（問月老但問了事業）**：
```
請者所問「事業／升遷」之事，
非月老掌管之域。

月老司：感情、姻緣、復合、桃花

若想問事業，可請示關聖帝君；
若想問考試，可請示文昌帝君。

[換位神明] [回到月老]
```

**強制三要素確認**：
擲筊前**必加一步「再確認」**：
```
你的問題：

「我和前任分手 3 個月，
最近他開始傳訊息，
我不知道該回還是該放下」

—————

確認此問題後即可擲筊請示。

[確認，擲筊] [我要修改]
```

讓使用者**自己讀一次自己問了什麼**，能大幅降低「我隨便寫一句結果 AI 解的不準」的客訴。

---

## 5. AI 解讀語氣規範

### 風格定位
**古典莊重「神諭」風**，但**不擬神明本人發言**（避免宗教爭議）。

### 用詞規範

✅ **可以用**：
- 「籤示」「籤意」「請者宜」「請者忌」
- 「此籤云」「籤中言」「按籤而論」
- 「月老示」（中性引述，不擬人）
- 「時機未至」「緣絲未通」「桃花將綻」

❌ **避免用**：
- 「月老告訴你」「神明對你說」（擬人化過強）
- 「一定會」「必然」「絕對」（過度承諾）
- 「不可能」「絕對不會」（負面斷言）
- 過度口語：「啦」「喔」「呢」「欸」
- 過度西化：「親愛的」「上帝」「祝福你」

### 輸出結構（每次 AI 解讀固定 4 段）

```
籤示：第 X 籤 · {等級}

籤詩：
　{第一句}
　{第二句}
　{第三句}
　{第四句}

籤意（針對問題客製化解讀）：
　{依籤詩 + 使用者問題，3-5 句說明}

請者宜：
　{2-3 條具體建議}

請者忌：
　{1-2 條警告}

月老示：
「{1-2 句畫龍點睛的短語}」

──────────
籤詩僅供參考方向，重要人生抉擇，
建議深入命盤分析（八字、紫微）。
```

### AI Prompt 範例（給 OpenAI）

```js
const systemPrompt = `你是一位協助使用者解讀月老籤的助手。

【嚴格規則】
1. 用古典中文神諭風格，但不可擬神明本人發言。
2. 用詞使用「籤示／籤意／請者宜／請者忌／月老示」等中性詞。
3. 嚴禁用「絕對」「一定」「必然」等斷言詞。
4. 嚴禁口語「啦／喔／呢／欸」。
5. 解讀必須依使用者實際問題客製化，不可只重複籤詩本意。
6. 結尾固定加入「僅供參考」disclaimer。

【輸出格式】固定四段，標題用全形冒號：
籤示：第 {id} 籤 · {level}
籤詩：{原句四行，每行前一個全形空格}
籤意：（3-5 句解讀，扣住使用者問題）
請者宜：（2-3 條具體建議）
請者忌：（1-2 條警告）
月老示：「{1-2 句短語}」

【篇幅】總長 200-350 字。
`;

const userPrompt = `
使用者問題：${userQuestion}
抽到的籤：第 ${poem.id} 籤 · ${poem.level}
籤詩：
${poem.poem.join("\n")}
籤意提示（內部不顯示）：${poem.interpretation_hint}

請依以上資料生成解讀。
`;
```

### AI 參數建議
```js
{
  model: "gpt-4o-mini",      // 月老解讀不需要旗艦模型，cost 低
  temperature: 0.7,            // 有古典感但保持結構
  max_tokens: 600,             // 防止暴衝
  presence_penalty: 0.2,       // 避免重複用詞
}
```

---

## 6. 整體流程（給實作參考）

### Conversation states

```
state.mode = "fortune"
state.stage 可以是：
  - "waiting_deity"        ← 等使用者選神明
  - "waiting_question"     ← 等使用者打問題
  - "confirm_question"     ← 顯示問題給使用者確認
  - "casting_jiao"         ← 擲筊（隨機產生結果）
  - "showing_poem"         ← 抽籤 + AI 解讀完成
```

### 觸發詞
```js
// 在 server.js routeGeneralCommands 加：
if (
  text === "免費占卜" ||
  text === "占卜" ||
  text === "求籤" ||
  text === "求神問卜"
) {
  conversationStates[userId] = {
    mode: "fortune",
    stage: "waiting_deity",
    data: {},
  };
  await sendDeitySelectFlex(userId);
  return;
}
```

### 神明選擇 Flex
（MVP 階段只有月老一張卡，未來擴充）

```js
const deities = [
  {
    id: "yuelao",
    label: "月老",
    desc: "司掌姻緣紅絲｜問感情、復合、桃花",
    image: "https://assets.chen-yi.tw/.../yuelao.jpg",
  },
  // 未來加 wenchang / guangong ...
];
```

---

## 7. Quota 判定邏輯（SQL 範例）

```js
// 判定「user X 今天能不能再占卜」
async function canCastFortuneToday(userId) {
  const today = getTaiwanDateString(); // "2026-05-20"
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS used
       FROM fortune_draws
      WHERE user_id = $1
        AND draw_date = $2
        AND poem_id IS NOT NULL`,
    [userId, today]
  );
  return Number(rows[0].used) === 0;
}

// 寫入抽籤紀錄
async function recordFortuneDraw({
  userId, deity, poemId, jiaoResult, questionText, aiResponse,
}) {
  const today = getTaiwanDateString();
  await pool.query(
    `INSERT INTO fortune_draws
       (user_id, draw_date, deity, poem_id, jiao_result, question_text, ai_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, today, deity, poemId, jiaoResult, questionText, aiResponse]
  );
}

// 台北日期字串（避免時區坑）
function getTaiwanDateString() {
  const now = new Date();
  const taipei = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const yyyy = taipei.getFullYear();
  const mm = String(taipei.getMonth() + 1).padStart(2, "0");
  const dd = String(taipei.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
```

---

## 8. 結尾 CTA 設計

抽完籤、AI 解讀顯示後，**馬上接一張卡片**：

```
（小卡片）

🌸 籤詩給了你方向

但人生關鍵節點，
更建議透過命盤深入分析：

✦ 八字｜看你的感情格局與大運
✦ 紫微｜看 12 宮位的關係互動

[預約諮詢]   [分享給朋友]
```

兩個 button：
- **預約諮詢** → postback `action=fortune_to_booking` → 觸發既有的 `關於八字/紫微/占卜` 入口
- **分享給朋友** → 連到 `/liff/share`（既有 endpoint），帶上「我剛在梵和易學求了一支月老籤」的分享文字

---

## 9. 隱私 / 同意

第一次使用者進入占卜流程時，**先給一張同意卡**：

```
🌿 占卜小提醒

為了讓老師日後能改善服務、
讓 AI 解讀更準確，
我們會留存以下資料：

✦ 你抽到的籤
✦ 你問的問題內容
✦ AI 給的解讀

【我們會做什麼】
✦ 用於改善 AI 解讀品質
✦ 以「匿名聚合統計」分享於社群
   （例如：本週熱門籤詩、最常被問的議題類型）

【我們不會做什麼】
✦ 不會公開或分享任何可識別你個人的內容
✦ 不會引述你的問題原文
✦ 不會將資料提供給第三方

你隨時可請老師刪除你的紀錄。

[同意，繼續] [先看看，不同意]
```

### 同意紀錄

**MVP 版**：每次進入占卜流程都顯示同意卡（不持久化）。
**未來**：可在 user_access 加 `fortune_consent_at TIMESTAMPTZ` 欄位，同意過就不再問。

未同意則無法使用占卜功能。

### 措辭設計理由

舊版「不會公開」太絕對 → 把後續做 Threads 匿名統計的路堵死。
新版採用「兩段式聲明」：明確列出**會做的**（匿名聚合、改善 AI）+ **不會做的**（公開個人、引述原文、提供第三方）。

這樣使用者**事前知情**老師會用統計資料寫社群內容，符合台灣個資法的「告知後同意」原則，老師也能依此規範做 Threads 內容（見 §9.5）。

---

## 9.5 Threads 內容操作規範

依 §9 隱私聲明，老師可以根據 `fortune_draws` 表的資料做 Threads 內容，但**僅限以下三類**：

### ✅ 可發：純匿名聚合統計

完全沒有任何 user 識別資訊、純數字。

範例：
```
📊 本週月老籤熱度

第 12 籤『月明風清』 ── 18 人抽到
第 27 籤『紅絲未通』 ── 14 人抽到
第 64 籤『鵲橋將成』 ──  9 人抽到

桃花類提問本週成長 32%
```

```
🌸 本週占卜統計

感情類 71% / 事業類 18% / 其他 11%
最高峰時段：晚上 9-11 點
平均提問字數：68 字
笑筊比例：22%（蠻多人問題不夠清晰）
```

對應 SQL（在 §9.5 末尾提供）。

### ⚠️ 邊緣（建議避免）：改編後的象徵性案例

即使老師完全改寫，使用者**仍可能對號入座**（「啊那個是我」）→ 體驗破損。

如真要寫，必須：
- 完全杜撰，不引用真實 question_text 任何片段
- 不出現可識別細節（年齡、職業、地名、特殊情境）
- 以「我觀察到一個趨勢」當引子，導向**一般性**內容

範例（OK）：
```
最近很多人問「該不該等」類的問題。
等待這件事，命盤通常是這樣看的：...
（接一段通用知識性內容）
```

範例（不 OK）：
```
昨晚有位姊妹問：「我跟前任分手 3 個月，他開始傳訊息...」
→ 帶有具體情境，當事人會認出
```

### ❌ 禁止：直接引用問題原文 / AI 回覆

無論如何不准：

```
❌「有人問：『我和某某分手 3 個月後該不該回他訊息？』抽到第 27 籤…」
❌「AI 給某使用者的解讀是這樣：『此籤示緣絲未通...』」
```

即使隱去名字、即使加馬賽克，**只要直接引用文字**都算違反聲明。

### 給未來自己撈統計的 SQL 範例

```sql
-- 本週最熱門籤（月老）
SELECT poem_id, COUNT(*) AS draws
  FROM fortune_draws
 WHERE deity = 'yuelao'
   AND draw_date > CURRENT_DATE - 7
   AND poem_id IS NOT NULL
 GROUP BY poem_id
 ORDER BY draws DESC
 LIMIT 10;

-- 提問時段分佈（台北時區）
SELECT EXTRACT(hour FROM created_at AT TIME ZONE 'Asia/Taipei') AS hr,
       COUNT(*)
  FROM fortune_draws
 WHERE draw_date > CURRENT_DATE - 7
 GROUP BY hr
 ORDER BY hr;

-- 笑筊/陰筊比例（可用於「神明示意」類內容）
SELECT jiao_result, COUNT(*),
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
  FROM fortune_draws
 WHERE draw_date > CURRENT_DATE - 7
 GROUP BY jiao_result;

-- 各神明熱度（未來擴充用）
SELECT deity, COUNT(*) AS draws
  FROM fortune_draws
 WHERE draw_date > CURRENT_DATE - 7
 GROUP BY deity
 ORDER BY draws DESC;
```

撈出來的資料**全部都是聚合數字**，沒有任何 user 識別欄位 → 做 Threads 圖卡零風險。

### 操作流程建議

1. 每週固定（例如週日晚）撈一次本週數據
2. 用 ChatGPT / Canva 做成圖卡
3. 發 Threads + IG Story 同步
4. 附上 hashtag：`#月老 #梵和易學 #本週占卜`
5. 留言區放「想體驗免費占卜→加 LINE」的引導

長期下來會建立「**梵和易學每週都有有趣的占卜統計**」品牌印象，比單純發文章效率更高。

---

## 10. MVP 完成定義（驗收標準）

- [ ] 使用者輸入「免費占卜」可進入流程
- [ ] 顯示月老一張選擇卡
- [ ] 可輸入問題（30-150 字驗證有效）
- [ ] 月老問非感情題會被提示 + 換神明 button
- [ ] 顯示問題確認卡片
- [ ] 擲筊隨機結果（聖 70% / 笑 20% / 陰 10%）
- [ ] 笑筊重試最多 2 次，第 3 次強制聖筊
- [ ] 陰筊不扣 quota
- [ ] 聖筊成功 → 抽籤 → AI 解讀（符合古典神諭風格）
- [ ] AI 解讀後顯示結尾 CTA 卡（預約 / 分享）
- [ ] 同一人同一天再來「免費占卜」會被提示「明天再來」
- [ ] fortune_draws 表正確寫入每次抽籤紀錄
- [ ] 第一次使用顯示同意卡，未同意者無法使用

---

## 11. 未來擴充（不在 MVP）

- 加文昌、關聖帝君、媽祖、觀音
- 「我的占卜紀錄」查詢功能
- 每日抽到熱門籤的 Threads 自動推文
- 抽籤輸出做成精緻 Flex（不只純文字）
- 籤詩配「等級顏色」視覺（上上=金、上吉=紅、中平=灰、下下=黑）
- 跟既有六爻占卜整合（六爻可選日期、占卜走 AI；風格平行）
- 抽 3 支籤的「進階占卜」付費版

---

## 12. 給實作者的最後叮嚀

- **AI 解讀千萬要 review 範例**：先讓 AI 跑 10 個案例你看過，確認語氣、長度、結構都對才上線
- **籤詩 JSON 一定要老師親自 review**：包括 AI 生成的客製化籤，內容歪了會傷品牌
- **第一週上線後密集看 fortune_draws**：哪些問題類型最多、AI 解讀對不對、有沒有人重複測試刷 quota
- **隱私聲明文字找懂的人看過再上**：「不會公開、不會分享給第三方」這類話一旦違反就麻煩
- **monitor OpenAI 帳單**：每天看一下 cost，初期可能會被免費好奇者灌爆

---

## 引用檔案

- Schema: `migrations/001_fortune_draws.sql`（已建立）
- DB pool: `db.js`（已存在）
- AI 呼叫範本: `aiClient.js` 的 `AI_Reading` 函式（既有）
- LINE Bot 路由: `server.js` `routeGeneralCommands` / `handleXxxFlow` / `handleXxxPostback`
- 籤詩資料（**待建立**）: `fortune-deities/yuelao-poems.json`
- 設計文件: `docs/fortune-design.md`（本檔）
