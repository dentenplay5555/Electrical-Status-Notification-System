-- อุปกรณ์ ESP32 แต่ละตัว
CREATE TABLE IF NOT EXISTS devices (
    device_id   TEXT PRIMARY KEY,
    name        TEXT,
    last_seen   TEXT
);

-- เซนเซอร์แต่ละตัวที่ผูกกับอุปกรณ์ (รองรับเพิ่มเซนเซอร์ในอนาคตโดยไม่ต้องแก้ schema)
CREATE TABLE IF NOT EXISTS sensors (
    sensor_id   TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL REFERENCES devices(device_id),
    name        TEXT
);

-- ค่าที่วัดได้ทุกครั้งที่ ESP32 ส่งเข้ามา (ทั้ง heartbeat และตอนสถานะเปลี่ยน)
CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL,
    sensor_id   TEXT NOT NULL,
    voltage_v   REAL,
    current_ma  REAL,
    power_mw    REAL,
    is_on       INTEGER NOT NULL,  -- 0 หรือ 1
    ok          INTEGER NOT NULL,  -- 0 = เซนเซอร์ตัวนี้อ่านไม่ได้ตอนนั้น
    created_at  TEXT NOT NULL      -- ISO timestamp (UTC)
);

CREATE INDEX IF NOT EXISTS idx_readings_device_time ON readings (device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_readings_sensor_time ON readings (sensor_id, created_at);
