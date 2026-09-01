-- migrations/008_web_tool_ai_reports.sql
-- Web 八字/紫微 AI 免費短解析 + Pro 綜合報告
-- 部署：psql "$DATABASE_URL" -f migrations/008_web_tool_ai_reports.sql

CREATE TABLE IF NOT EXISTS web_ai_usage (
  visitor_id TEXT NOT NULL,
  usage_date_tw DATE NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (visitor_id, usage_date_tw)
);

CREATE INDEX IF NOT EXISTS idx_web_ai_usage_date
  ON web_ai_usage (usage_date_tw DESC);

CREATE TABLE IF NOT EXISTS web_tool_reports (
  id UUID PRIMARY KEY,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  source TEXT NOT NULL DEFAULT 'ecpay',
  email TEXT NOT NULL,
  visitor_id TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  birth JSONB NOT NULL,
  bazi_chart JSONB,
  ziwei_chart JSONB,
  bazi_analysis TEXT,
  ziwei_analysis TEXT,
  zonghe_analysis TEXT,
  poster_json JSONB,
  html TEXT,
  activity_code TEXT NOT NULL DEFAULT '',
  payment_merchant_trade_no TEXT NOT NULL DEFAULT '',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_tool_reports_token
  ON web_tool_reports (token);

CREATE INDEX IF NOT EXISTS idx_web_tool_reports_payment
  ON web_tool_reports (payment_merchant_trade_no)
  WHERE payment_merchant_trade_no <> '';

CREATE INDEX IF NOT EXISTS idx_web_tool_reports_email_created
  ON web_tool_reports (email, created_at DESC);

CREATE TABLE IF NOT EXISTS web_report_activity_codes (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  batch_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ,
  redeemed_email TEXT NOT NULL DEFAULT '',
  redeemed_visitor_id TEXT NOT NULL DEFAULT '',
  report_id UUID REFERENCES web_tool_reports(id)
);

CREATE INDEX IF NOT EXISTS idx_web_report_activity_codes_status
  ON web_report_activity_codes (status, created_at DESC);
