import type { Env, DeviceUpdate, StoredStatus } from "../types";

// ----- KV: เก็บ "สถานะล่าสุด" ทั้งก้อน (device + sensors[]) อ่านเร็ว ใช้กับ /status -----
export async function saveLatestStatus(env: Env, update: DeviceUpdate): Promise<void> {
    const stored: StoredStatus = {
        ...update,
        updated_at: new Date().toISOString(),
    };
    await env.LATEST_STATUS.put(update.device_id, JSON.stringify(stored));
}

export async function getLatestStatus(env: Env, deviceId: string): Promise<StoredStatus | null> {
    const raw = await env.LATEST_STATUS.get(deviceId);
    return raw ? (JSON.parse(raw) as StoredStatus) : null;
}

// ----- D1: บันทึกทุก reading ของทุกเซนเซอร์ลงตาราง readings (ประวัติ ใช้สรุปรายวัน) -----
export async function insertReadings(env: Env, update: DeviceUpdate): Promise<void> {
    const now = new Date().toISOString();

    // upsert ตาราง devices ให้มี last_seen ล่าสุดเสมอ
    await env.DB.prepare(
        `INSERT INTO devices (device_id, last_seen) VALUES (?, ?)
         ON CONFLICT(device_id) DO UPDATE SET last_seen = excluded.last_seen`
    )
        .bind(update.device_id, now)
        .run();

    // insert reading ของแต่ละ sensor แยกแถว — เพิ่ม sensor ตัวที่ 3 ในอนาคตไม่ต้องแก้ schema
    const statements = update.sensors.map((s) =>
        env.DB.prepare(
            `INSERT INTO readings (device_id, sensor_id, voltage_v, current_ma, power_mw, is_on, ok, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(update.device_id, s.sensor_id, s.voltage_v, s.current_ma, s.power_mw, s.is_on ? 1 : 0, s.ok ? 1 : 0, now)
    );

    await env.DB.batch(statements);
}

// ดึงสรุปของ "วันนี้" (เวลาไทย) แยกตามเซนเซอร์ ไว้ใช้ตอนส่งสรุปผ่าน LINE ตอน 16:10
export async function getTodaySummary(env: Env, deviceId: string) {
    const now = new Date();
    const bangkokOffsetMs = 7 * 60 * 60 * 1000;
    const bangkokNow = new Date(now.getTime() + bangkokOffsetMs);
    const startOfDayBangkok = new Date(
        Date.UTC(bangkokNow.getUTCFullYear(), bangkokNow.getUTCMonth(), bangkokNow.getUTCDate())
    );
    const startOfDayUtc = new Date(startOfDayBangkok.getTime() - bangkokOffsetMs).toISOString();

    const result = await env.DB.prepare(
        `SELECT
            sensor_id,
            COUNT(*) as total_readings,
            SUM(CASE WHEN is_on = 1 THEN 1 ELSE 0 END) as on_readings,
            MAX(power_mw) as peak_power_mw
         FROM readings
         WHERE device_id = ? AND created_at >= ?
         GROUP BY sensor_id`
    )
        .bind(deviceId, startOfDayUtc)
        .all();

    return result.results; // array ของสรุปแยกตาม sensor_id
}
