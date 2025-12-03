const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// 先創造 app
const app = express();

// 讓前端可以跨域/丟 JSON 進來
app.use(cors());
app.use(express.json()); // 讓 POST JSON 讀得懂

// 預約資料要存的檔案位置
const DATA_FILE = path.join(__dirname, "bookings.json");

// 不開放設定檔（之後後台會寫這個）
const UNAVAILABLE_FILE = path.join(__dirname, "unavailable.json");

// 簡易後台 Token（正式上線可以改成環境變數）
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-secret";

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// 系統所有可用時段（中心真相）——之後前端/後台都應該跟這個一致
const ALL_TIME_SLOTS = [
  "09:00-10:00",
  "10:30-11:30",
  "14:00-15:00",
  "15:30-16:30",
  "20:00-21:00（線上）",
];

function loadBookings() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error("讀取 bookings.json 發生錯誤：", err);
    return [];
  }
}

function saveBookings(bookings) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2), "utf-8");
    console.log("已寫入 bookings.json，共", bookings.length, "筆預約");
  } catch (err) {
    console.error("寫入 bookings.json 發生錯誤：", err);
  }
}

// 讀取不開放設定（沒有檔案時回傳預設空物件）
function loadUnavailable() {
  try {
    if (!fs.existsSync(UNAVAILABLE_FILE)) {
      return { fullDay: [], slots: [] };
    }
    const raw = fs.readFileSync(UNAVAILABLE_FILE, "utf-8");
    if (!raw.trim()) return { fullDay: [], slots: [] };
    return JSON.parse(raw);
  } catch (err) {
    console.error("讀取 unavailable.json 發生錯誤：", err);
    return { fullDay: [], slots: [] };
  }
}
//不開放設定的存檔
function saveUnavailable(unavailable) {
  try {
    fs.writeFileSync(
      UNAVAILABLE_FILE,
      JSON.stringify(unavailable, null, 2),
      "utf-8"
    );
    console.log("已寫入 unavailable.json");
  } catch (err) {
    console.error("寫入 unavailable.json 發生錯誤：", err);
  }
}

function getSlotsForDate(date) {
  const bookings = loadBookings();
  const unavailable = loadUnavailable();

  // 這一天是否整天不開放
  const isFullDayBlocked =
    Array.isArray(unavailable.fullDay) && unavailable.fullDay.includes(date);

  // 這一天被你標記為不開放的時段
  const blockedSlotsForDate = [];
  if (Array.isArray(unavailable.slots)) {
    unavailable.slots
      .filter((u) => u.date === date)
      .forEach((u) => {
        if (Array.isArray(u.timeSlots)) {
          blockedSlotsForDate.push(...u.timeSlots);
        }
      });
  }

  // 這一天已被預約的時段（從 bookings.json 算出來）
  const bookedSlotsForDate = [];
  bookings
    .filter((b) => b.date === date)
    .forEach((b) => {
      const slots = Array.isArray(b.timeSlots)
        ? b.timeSlots
        : b.timeSlot
        ? [b.timeSlot]
        : [];
      bookedSlotsForDate.push(...slots);
    });

  // 產生這一天所有 slot 的狀態
  return ALL_TIME_SLOTS.map((slot) => {
    if (isFullDayBlocked || blockedSlotsForDate.includes(slot)) {
      return { timeSlot: slot, status: "blocked" };
    }
    if (bookedSlotsForDate.includes(slot)) {
      return { timeSlot: slot, status: "booked" };
    }
    return { timeSlot: slot, status: "open" };
  });
}

// 測試用：GET /
app.get("/", (req, res) => {
  res.send("Booking API is running");
});

//全部預約列表（之後 admin 用）
app.get("/api/bookings", (req, res) => {
  const bookings = loadBookings();
  res.json(bookings);
});

//前台主要查詢時段狀態
app.get("/api/slots", (req, res) => {
  const date = req.query.date;
  if (!date) {
    return res
      .status(400)
      .json({ error: "date is required, e.g. ?date=2025-12-10" });
  }

  const slots = getSlotsForDate(date);
  res.json(slots);
});

// 接收預約資料，新增預約，並檢查是否衝突
app.post("/api/bookings", (req, res) => {
  console.log("收到一筆預約（來自前端）：");
  console.log(req.body);

  // 先讀出目前已經有的預約資料
  const bookings = loadBookings();

  // 幫這筆預約加個 id 和時間戳
  const newBooking = {
    id: Date.now(), // 簡單用時間當 id
    createdAt: new Date().toISOString(),
    status: "pending", // 新增狀態欄位：pending / done / canceled
    ...req.body,
  };

  bookings.push(newBooking);
  // 寫回 bookings.json
  saveBookings(bookings);

  res.json({
    success: true,
    message: "後端已收到預約資料並已寫入 bookings.json",
  });
});

// 後台：讀取所有預約
app.get("/api/admin/bookings", requireAdmin, (req, res) => {
  const bookings = loadBookings();

  // 簡單排序：先按 date，再按 createdAt
  bookings.sort((a, b) => {
    if (a.date === b.date) {
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    }
    return (a.date || "").localeCompare(b.date || "");
  });

  res.json(bookings);
});

// 後台：更新預約的狀態（pending / done / canceled）
app.patch("/api/admin/bookings/:id/status", requireAdmin, (req, res) => {
  const bookings = loadBookings();
  const id = Number(req.params.id);
  const { status } = req.body;

  if (!["pending", "done", "canceled"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const idx = bookings.findIndex((b) => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Booking not found" });
  }

  bookings[idx].status = status;
  saveBookings(bookings);

  res.json({ success: true, booking: bookings[idx] });
});

// 後台：刪除一筆預約
app.delete("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const bookings = loadBookings();
  const id = Number(req.params.id);

  const newList = bookings.filter((b) => b.id !== id);

  if (newList.length === bookings.length) {
    return res.status(404).json({ error: "Booking not found" });
  }

  saveBookings(newList);
  res.json({ success: true });
});

//admin API：讀 / 寫不開放設定
app.get("/api/admin/unavailable", requireAdmin, (req, res) => {
  const unavailable = loadUnavailable();
  res.json(unavailable);
});

//POST /api/admin/unavailable
app.post("/api/admin/unavailable", requireAdmin, (req, res) => {
  const body = req.body;

  // 非常簡單的驗證格式
  const unavailable = {
    fullDay: Array.isArray(body.fullDay) ? body.fullDay : [],
    slots: Array.isArray(body.slots) ? body.slots : [],
  };

  saveUnavailable(unavailable);
  res.json({ success: true });
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Booking API server running at http://localhost:${PORT}`);
});
