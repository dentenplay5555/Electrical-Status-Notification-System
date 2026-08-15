-- ตารางเก็บทุกครั้งที่ ESP32 ส่งข้อมูลเข้ามา (ทั้ง heartbeat และตอนสถานะเปลี่ยน)
CREATE TABLE IF NOT EXISTS logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL,
    is_on       INTEGER NOT NULL,       -- 0 หรือ 1
    voltage_v   REAL,
    current_ma  REAL,
    power_mw    REAL,
    created_at  TEXT NOT NULL           -- ISO timestamp เก็บเป็น UTC
);

CREATE INDEX IF NOT EXISTS idx_logs_device_time ON logs (device_id, created_at);
