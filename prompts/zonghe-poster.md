# 八字 + 紫微綜合印證海報版 JSON 提示詞

請把綜合報告整理成 HTML 模板可用的 JSON。必須輸出繁體中文。不要輸出 Markdown，不要包 ```json，直接以 `{` 開頭，以 `}` 結尾。

## JSON Schema
{
  "meta": {
    "archetype_name": "3-7字標題",
    "axis_oneliner": "30字內主軸"
  },
  "axes": {
    "bazi_main": "45字內八字主軸",
    "ziwei_main": "45字內紫微主軸"
  },
  "consistency": "同向印證|互補印證|存在矛盾",
  "strengths": [
    { "title": "6字內", "desc": "25字內" },
    { "title": "6字內", "desc": "25字內" },
    { "title": "6字內", "desc": "25字內" }
  ],
  "weaknesses": [
    { "title": "6字內", "desc": "25字內" },
    { "title": "6字內", "desc": "25字內" },
    { "title": "6字內", "desc": "25字內" }
  ],
  "section_01": {
    "text": "180-250字主軸印證結論",
    "word_count": 0
  },
  "section_02": {
    "conclusion": "100字內階段印證結論"
  },
  "dim": {
    "career": { "bazi": "30字內", "ziwei": "30字內", "verdict": "🟢 同向|⚠ 部分衝突|🔴 矛盾", "verdict_class": "verdict-yes|verdict-partial|verdict-no", "fused": "30字內" },
    "wealth": { "bazi": "30字內", "ziwei": "30字內", "verdict": "🟢 同向|⚠ 部分衝突|🔴 矛盾", "verdict_class": "verdict-yes|verdict-partial|verdict-no", "fused": "30字內" },
    "marriage": { "bazi": "30字內", "ziwei": "30字內", "verdict": "🟢 同向|⚠ 部分衝突|🔴 矛盾", "verdict_class": "verdict-yes|verdict-partial|verdict-no", "fused": "30字內" },
    "children": { "bazi": "30字內", "ziwei": "30字內", "verdict": "🟢 同向|⚠ 部分衝突|🔴 矛盾", "verdict_class": "verdict-yes|verdict-partial|verdict-no", "fused": "30字內" },
    "family": { "bazi": "30字內", "ziwei": "30字內", "verdict": "🟢 同向|⚠ 部分衝突|🔴 矛盾", "verdict_class": "verdict-yes|verdict-partial|verdict-no", "fused": "30字內" },
    "health": { "bazi": "30字內", "ziwei": "30字內", "verdict": "🟢 同向|⚠ 部分衝突|🔴 矛盾", "verdict_class": "verdict-yes|verdict-partial|verdict-no", "fused": "30字內" }
  },
  "conflicts": [
    { "point": "8字內", "bazi": "25字內", "ziwei": "25字內", "impact": "低|中|高", "impact_class": "low|mid|high", "advice": "30字內" },
    { "point": "8字內", "bazi": "25字內", "ziwei": "25字內", "impact": "低|中|高", "impact_class": "low|mid|high", "advice": "30字內" },
    { "point": "8字內", "bazi": "25字內", "ziwei": "25字內", "impact": "低|中|高", "impact_class": "low|mid|high", "advice": "30字內" }
  ],
  "final": {
    "life_axis": "30字內",
    "nodes": [
      { "age": 0, "year": 0, "event": "40字內" },
      { "age": 0, "year": 0, "event": "40字內" },
      { "age": 0, "year": 0, "event": "40字內" },
      { "age": 0, "year": 0, "event": "40字內" },
      { "age": 0, "year": 0, "event": "40字內" }
    ],
    "risks": [
      { "range": "如 2026-2027 (36-37歲)", "desc": "40字內" },
      { "range": "同上", "desc": "40字內" },
      { "range": "同上", "desc": "40字內" }
    ],
    "leverage": [
      { "title": "10字內", "desc": "40字內" },
      { "title": "10字內", "desc": "40字內" }
    ],
    "advice": ["25字內", "25字內", "25字內", "25字內"]
  },
  "confidence": {
    "bazi_level": "高|中高|中|中低|低",
    "bazi_score": "0.00-1.00",
    "ziwei_level": "高|中高|中|中低|低",
    "ziwei_score": "0.00-1.00",
    "consistency_level": "高|中高|中|中低|低",
    "consistency_score": "0.00-1.00",
    "stability_level": "高|中高|中|中低|低",
    "stability_score": "0.00-1.00",
    "note": "80字內"
  }
}

## 約束
- 所有欄位必填，固定數量不可少。
- 沒有明確材料時給保守判斷，不可硬編重大事件。
- `verdict_class` 只能是 `verdict-yes`、`verdict-partial`、`verdict-no`。
- `impact_class` 只能是 `low`、`mid`、`high`。
