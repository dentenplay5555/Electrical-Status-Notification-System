-- สร้าง table สำหรับ ESP32 แต่ละตัว
CREATE TABLE IF NOT EXISTS devices (
    device_id   TEXT PRIMARY KEY,
    name        TEXT,
    last_seen   TEXT
);
-- เซนเซอร์แต่ละตัวที่ผูกกับอุปกรณ์ (รองรับเพิ่มเซนเซอร์ในอนาคตโดยไม่ต้องแก้ตัว schema เลย)
CREATE TABLE IF NOT EXISTS sensors (
    sensor_id   TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL REFERENCES devices(device_id),
    name        TEXT
);

-- ค่าที่วัดได้ทุกครั้งที่ ESP32 ส่งเข้ามา (heartbeat ทุก 10 วินาที(10000 ms))
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

-- สถานะล่าสุดต่อ device (แทน KV) — upsert ทุก heartbeat, ใช้ร่วมกับ /status
-- เก็บ sensors[] เป็น JSON string เพื่อให้ query ได้ง่ายโดยไม่ต้อง JOIN บ่อยๆ
CREATE TABLE IF NOT EXISTS latest_status (
    device_id   TEXT PRIMARY KEY,
    sensors_json TEXT NOT NULL,    -- JSON array ของ SensorReading[]
    updated_at  TEXT NOT NULL      -- ISO timestamp (UTC) ใช้คำนวณ N/A (> 30s)
);
