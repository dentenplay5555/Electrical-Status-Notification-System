export interface Env {
    // KV ถูก replace ด้วย D1 latest_status table แล้ว — ลบ binding ออกจาก wrangler.toml ได้เมื่อพร้อม
    // LATEST_STATUS: KVNamespace;
    DB: D1Database;
    LINE_ACCESS_TOKEN?: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_USER_ID?: string;
    DEVICE_TOKEN?: string;          // Bearer token สำหรับ POST /update (wrangler secret put DEVICE_TOKEN)
    ALLOW_NO_AUTH?: string;         // ตั้งเป็น "true" เฉพาะใน .dev.vars ตอนพัฒนาเพื่อข้ามการตรวจ token
    ADMIN_USERNAME?: string;        // ชื่อผู้ใช้สำหรับ /admin (default: admin)
    ADMIN_PASSWORD?: string;        // รหัสผ่านสำหรับ /admin (wrangler secret put ADMIN_PASSWORD)
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
    boot_id?: string;          // Session identifier generated on device startup (prevents 409 after reboot)
    sensors: SensorReading[];
    sequence_number?: number;  // replay protection: ถ้าส่งมา ต้อง > ค่าล่าสุดที่ server เก็บไว้ใน boot session นั้น
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

// ----- Database Quota Info -----
export interface DbQuotaInfo {
    readings_count: number;
    devices_count: number;
    sensors_count: number;
    latest_status_count: number;
    estimated_size_mb: number;       // ประมาณจากจำนวน rows
    oldest_reading?: string;         // ISO timestamp
    newest_reading?: string;         // ISO timestamp
    d1_free_tier_limit_mb: number;   // 5GB
    usage_percent: number;
}
