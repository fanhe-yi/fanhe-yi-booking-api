-- ==========================================================
-- migrations/007_payment_orders_allow_web_orders.sql
--
-- 網頁版六爻付費預約：
-- payment_orders 需要同時承接 LINE quota 訂單與 Web 陌生客訂單。
-- Web 陌生客沒有 user_access row，因此 user_id 不應再強制綁 LINE user_access。
-- 實際流程分流改用 source + booking_id + meta。
-- ==========================================================

ALTER TABLE payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_user_id_fkey;

