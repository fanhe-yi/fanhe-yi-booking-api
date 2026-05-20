# fortune-deities

各神明的籤詩資料庫。每個神明一個 JSON 檔。

## 檔案規範

檔名：`<deity_id>-poems.json`，deity_id 用英文（如 `yuelao`, `wenchang`, `guangong`, `mazu`, `guanyin`）。

## JSON 結構

```json
{
  "deity": "yuelao",
  "name_display": "月老",
  "description": "司掌姻緣紅絲，問感情、桃花、復合事宜",
  "note_to_implementer": "（可選）給未來實作者的備註",
  "poems": [
    {
      "id": 1,
      "name": "第一籤",
      "level": "上上",
      "poem": ["第一句", "第二句", "第三句", "第四句"],
      "tags": ["分類標籤陣列"],
      "interpretation_hint": "（內部不顯示給使用者）給 AI 的籤意指引"
    }
  ]
}
```

### 欄位說明

| 欄位 | 必填 | 說明 |
|---|---|---|
| `deity` | ✅ | 與檔名一致的英文 id |
| `name_display` | ✅ | 中文顯示名 |
| `description` | ✅ | 一句話描述此神明掌管什麼 |
| `note_to_implementer` | ❌ | 給後續維護者的備註 |
| `poems` | ✅ | 籤詩陣列 |
| `poems[].id` | ✅ | 從 1 開始連續整數 |
| `poems[].name` | ✅ | 中文籤名，例如「第二十七籤」 |
| `poems[].level` | ✅ | 四等級之一：上上 / 上吉 / 中平 / 下下 |
| `poems[].poem` | ✅ | 四句陣列，每句約七字 |
| `poems[].tags` | ❌ | 分類標籤，方便分析 |
| `poems[].interpretation_hint` | ✅ | **不顯示給使用者**。給 AI 的籤意提示，讓解讀有方向。約 50-100 字 |

## 等級分佈建議

100 支籤詩建議比例（傳統慣例）：

| 等級 | 比例 | 100 支裡的張數 |
|---|---|---|
| 上上 | ~15% | 15 支 |
| 上吉 | ~35% | 35 支 |
| 中平 | ~40% | 40 支 |
| 下下 | ~10% | 10 支 |

下下籤少而珍，但**必須有**，否則占卜失去威信。

## 補滿 100 支的建議流程

1. **找公版 50 支**：搜尋「月老百籤」「月老籤詩」，從台北霞海城隍廟、紫南宮、行天宮等官方公佈版本交叉比對。整理進 JSON。
2. **客製 50 支**：用 Claude / GPT 生成，主題涵蓋：
   - 復合（10 支）
   - 曖昧進展（10 支）
   - 婚姻決定（10 支）
   - 桃花機運（10 支）
   - 放下/結束（10 支）
3. **每支必須老師親自 review**：避免 AI 寫出怪句、平仄不對。
4. **覆蓋既有 demo**：補滿時直接覆寫 `yuelao-poems.json`，把 demo 的 10 支整合進去（保留結構好的、淘汰不夠精緻的）。

## 加新神明

複製此 README 跟一份 JSON 模板，建立 `<新神明>-poems.json`，並在 `server.js` 的 `DEITY_META` 加新條目（label / desc / offTopicKeywords 等）。

## 抽籤演算法

server.js 用 `Math.random() * poems.length` 隨機抽。
未來可加權（依問題類型偏好抽某類籤），目前 MVP 不需要。
