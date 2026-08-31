# Web 六爻與命理工具交接文件

最後更新：2026-08-31

## 目的

這份文件用來讓新開的 Codex 聊天視窗快速接上目前「命理工具 / Web 六爻」狀態，後續可繼續做 `/tools` 內的八字、紫微工具啟用。

## Repos 與目前重要 commit

- 後端：`/Users/casper/fanhe-yi-booking-api`
  - `c18bd55 Add web liuyao reading flow`
  - `54b7671 Allow web liuyao paid booking orders`
  - `7f8235c feat(liuyao): 加 DELETE /api/admin/liuyao-records/:id`
- 前台：`/Users/casper/bazi_api_test/hello-vue`
  - `7501318 Add mingli tools liuyao page`
  - `71124cf Refine liuyao tool intro styling`
  - `eca9edd Refactor liuyao tool to one page flow`
  - `a466865 Require email for web liuyao bookings`
- 後台：`/Users/casper/bazi_api_test/admin-template-vuecli`
  - 只參考，不修改。

## 目前 Web 六爻免費流程

前台路由：

- `/tools`：命理工具總入口，目前六爻可用，八字與紫微可在下一階段啟用。
- `/tools/liuyao`：Web 六爻免費起卦流程。

前台行為：

- 一頁式垂直流程。
- 流程：介紹、問題、性別、時間、靜心、請神、擲爻、退神、結果。
- 擲爻使用文字按鈕，不用硬幣圖片：`0/1/2/3 個正面`。
- 擲爻站點：`初爻 › 二爻 › 三爻 › 中場 › 四爻 › 五爻 › 六爻`。
- 六爻暫存由下往上顯示，讓使用者知道目前卜到哪一爻。
- 免費結果刷新後 v1 不保存。

後端 API：

- `POST /api/liuyao/free-reading`
- 輸入包含 `visitorId`, `topicText`, `gender`, `timeMode`, `questionTime/customTime`, `prayerKey`, `hexCode`。
- 使用 `web_liuyao_usage` 限制同一 `visitor_id + 台北日期` 每日一次。
- 呼叫既有六爻 API 與 parser 產生卦盤。
- 使用免費簡版 AI prompt。
- 不寫 `liuyao_records`。
- 不通知老師。

## 目前 Web 六爻付費流程

免費結果頁 CTA 進 `/booking`：

- query：`serviceId=liuyao&source=liuyao_web_free_cta`
- sessionStorage key：`liuyao_paid_context`
- 預約表單會帶入問題、性別、起卦時間、起卦碼。
- Web 六爻付費預約要求姓名與有效 Email。
- 電話與 LINE ID 選填，因為陌生客可能沒有 LINE。

後端 `/api/bookings`：

- Web 六爻付費預約建立 `status = pending_payment`。
- 建立 `payment_orders`：
  - `source = web_liuyao_paid`
  - `booking_id = booking.id`
  - `meta` 保存 `bookingId`, `liuyaoContext`, `name`, `email`, `phone`, `lineId`, `contact`
  - `user_id` 仍可用 `web_booking:{bookingId}` 作內部辨識，但不再依賴 LINE `user_access`

綠界付款：

- Web 六爻付款入口：`GET /pay/order/:merchantTradeNo`
- 只在 Web 六爻付款單加入 `OrderResultURL`。
- `ReturnURL = {BASE_URL}/ecpay/return` 是付款真相來源，負責標記付款成功。
- `OrderResultURL = {BASE_URL}/pay/success?type=web_liuyao&bookingId=...` 讓客戶刷卡完成後導回成功頁。
- `ClientBackURL` 保留作備用返回。
- `GET /pay/success` 與 `POST /pay/success` 都會顯示成功頁；POST 是給綠界刷卡完成後的 client redirect 使用。

付款成功後：

- `/ecpay/return` 驗證 CheckMacValue。
- `payment_orders` 從 `INIT` 改 `PAID`。
- Web 六爻分支呼叫 `completeWebLiuYaoPaidOrder(order)`。
- booking 改 `paid`。
- 後端用 `booking_id` 找回 `bookings.json` 內的 `liuyaoContext`。
- 重新取卦盤並呼叫老師版 `callLiuYaoAI`。
- 寫入 `liuyao_records`，`source = web_paid`，`booking_id = booking.id`。
- 目前 Web 六爻付費成功通知仍主要送 `ADMIN_LIUYAO_USER_ID`。
- Web admin 通知改用 `ADMIN_NOTIFY_USER_IDS` 尚未做，之後如要做，必須只改 Web 流程，不動 LINE。

## DB migrations

已新增：

- `migrations/006_web_liuyao_payment_support.sql`
  - 建立 `web_liuyao_usage`
  - 擴充 `payment_orders.source`, `payment_orders.booking_id`, `payment_orders.meta`
  - 擴充 `liuyao_records.source`, `liuyao_records.booking_id`
- `migrations/007_payment_orders_allow_web_orders.sql`
  - 移除 `payment_orders_user_id_fkey`
  - 原因：Web 陌生客不是 LINE user，不一定存在 `user_access`

VPS 若尚未跑過：

```bash
cd /你的/fanhe-yi-booking-api/路徑
psql "postgresql://booking_user:你的密碼@127.0.0.1:5432/booking_db" -f migrations/006_web_liuyao_payment_support.sql
psql "postgresql://booking_user:你的密碼@127.0.0.1:5432/booking_db" -f migrations/007_payment_orders_allow_web_orders.sql
```

若 `006` 已跑過，只跑 `007`。

## 部署流程

後端 VPS：

```bash
cd /你的/fanhe-yi-booking-api/路徑
git pull
psql "postgresql://booking_user:你的密碼@127.0.0.1:5432/booking_db" -f migrations/007_payment_orders_allow_web_orders.sql
pm2 restart all
```

前台本機：

```bash
cd /Users/casper/bazi_api_test/hello-vue
git pull
npm run build:seo
```

然後照原本流程 rsync `dist/`。

## 重要限制

- 不要修改 `admin-template-vuecli`，除非使用者明確要求。
- 不要改 LINE 官方帳號六爻流程。
- 不要改 LINE booking 的 `notifyNewBooking` 流程。
- 不要改 LINE quota 付款補額度流程。
- Web 六爻付款導回只套 Web 付款單，不套 LINE 付款單。
- 不要把 DB 密碼寫進 repo。
- AGENTS 規則：禁止批量刪除文件或目錄，不使用 `rm -rf`。

## 下一步：命理工具八字 / 紫微

建議下一個聊天視窗先從前台 `/tools` 規劃：

- 保留 `/tools` 作命理工具總入口。
- 新增或啟用八字工具卡與紫微工具卡。
- 先決定每個工具是免費試算、付費預約 CTA，或純 SEO 介紹頁。
- 優先沿用 Web 六爻既有模式：
  - 公開 SEO route
  - 一頁式流程
  - 結果頁 CTA 到 `/booking`
  - 需要付費承接時用 booking/payment source 區分，不混 LINE 流程

## 已知待辦

- Web 六爻付款成功通知若要跟一般預約一樣發多位管理員，需新增 Web 專用 helper 讀 `ADMIN_NOTIFY_USER_IDS + ADMIN_LIUYAO_USER_ID` 並去重。
- 這個通知調整尚未實作，且實作時仍不可改 LINE 流程。
- 免費卦結果刷新後不保存，這是 v1 已決策行為。

