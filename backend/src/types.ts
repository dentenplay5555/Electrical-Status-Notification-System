export interface Env {
    // KV ถูก replace ด้วย D1 latest_status table แล้ว — ลบ binding ออกจาก wrangler.toml ได้เมื่อพร้อม
    // LATEST_STATUS: KVNamespace;
    DB: D1Database;
    LINE_ACCESS_TOKEN?: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_USER_ID?: string;
    DEVICE_TOKEN?: string;          // Bearer token สำหรับ POST /update (wrangler secret put DEVICE_TOKEN)
}

export interface SensorReading {
    sensor_id: string;
    voltage_v: number;
    current_ma: number;
    power_mw: number;
    is_on: boolean;
    ok: boolean; // false ถ้า ESP32 อ่านเซนเซอร์ตัวนี้ไม่ได้
}

export interface DeviceUpdate {
    device_id: string;
    sensors: SensorReading[];
}

export interface StoredStatus extends DeviceUpdate {
    updated_at: string; // ISO timestamp - ใช้คำนวณว่า "หลุดการเชื่อมต่อ" หรือยัง
}

export interface SensorSummaryRow {
    sensor_id: string;
    total_readings: number;
    on_readings: number;
    peak_power_mw: number;
    avg_voltage_v?: number;
    avg_current_ma?: number;
}
