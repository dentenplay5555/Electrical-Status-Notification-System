export interface Env {
    LATEST_STATUS: KVNamespace;
    DB: D1Database;
    LINE_ACCESS_TOKEN: string;
    LINE_USER_ID: string;
}

export interface SensorReading {
    sensor_id: string;
    voltage_v: number;
    current_ma: number;
    power_mw: number;
    is_on: boolean;
    ok: boolean;   // false ถ้า ESP32 อ่านเซนเซอร์ตัวนี้ไม่ได้
}

export interface DeviceUpdate {
    device_id: string;
    sensors: SensorReading[];
}

export interface StoredStatus extends DeviceUpdate {
    updated_at: string;  // ISO timestamp - ใช้คำนวณว่า "หลุดการเชื่อมต่อ" หรือยัง
}
