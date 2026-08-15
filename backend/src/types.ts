export interface Env {
    LATEST_STATUS: KVNamespace;
    DB: D1Database;
    LINE_ACCESS_TOKEN: string;   // ตั้งผ่าน `wrangler secret put`
    LINE_USER_ID: string;        // ตั้งผ่าน `wrangler secret put`
}

export interface SensorPayload {
    device_id: string;
    is_on: boolean;
    voltage_v: number;
    current_ma: number;
    power_mw: number;
}

export interface StoredStatus extends SensorPayload {
    updated_at: string;  // ISO timestamp - ใช้คำนวณว่า "หลุดการเชื่อมต่อ" หรือยัง
}
