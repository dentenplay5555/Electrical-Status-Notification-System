import type { Env, DeviceUpdate, StoredStatus, SensorSummaryRow } from "../types";

// ----- D1: สถานะล่าสุด (แทน KV) -----
// upsert ทุก heartbeat (~10s) — 1 row ต่อ device_id เท่านั้น
export async function saveLatestStatus(env: Env, update: DeviceUpdate): Promise<void> {
    const now = new Date().toISOString();
    await env.DB.prepare(
        `INSERT INTO latest_status (device_id, sensors_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
             sensors_json = excluded.sensors_json,
             updated_at   = excluded.updated_at`
    )
        .bind(update.device_id, JSON.stringify(update.sensors), now)
        .run();
}

export async function getLatestStatus(env: Env, deviceId: string): Promise<StoredStatus | null> {
    const row = await env.DB.prepare(
        `SELECT device_id, sensors_json, updated_at FROM latest_status WHERE device_id = ?`
    )
        .bind(deviceId)
        .first<{ device_id: string; sensors_json: string; updated_at: string }>();

    if (!row) return null;
    try {
        return {
            device_id: row.device_id,
            sensors: JSON.parse(row.sensors_json),
            updated_at: row.updated_at,
        } as StoredStatus;
    } catch {
        return null;
    }
}

// ----- D1: บันทึกทุก reading + upsert devices (sensors upsert เฉพาะ INSERT ใหม่) -----
// ลด D1 writes: sensor upsert ข้ามไปถ้ามีอยู่แล้ว (INSERT OR IGNORE) — ประหยัด ~2 writes/request
export async function insertReadings(env: Env, update: DeviceUpdate): Promise<void> {
    const now = new Date().toISOString();

    const statements: D1PreparedStatement[] = [];

    // 1. Upsert ตาราง devices (last_seen ทุก heartbeat)
    statements.push(
        env.DB.prepare(
            `INSERT INTO devices (device_id, last_seen) VALUES (?, ?)
             ON CONFLICT(device_id) DO UPDATE SET last_seen = excluded.last_seen`
        ).bind(update.device_id, now)
    );

    // 2. sensors: INSERT OR IGNORE (ไม่เขียนซ้ำถ้ามีอยู่แล้ว) + readings ทุกครั้ง
    for (const s of update.sensors) {
        statements.push(
            env.DB.prepare(
                `INSERT OR IGNORE INTO sensors (sensor_id, device_id, name) VALUES (?, ?, ?)`
            ).bind(s.sensor_id, update.device_id, s.sensor_id)
        );

        statements.push(
            env.DB.prepare(
                `INSERT INTO readings (device_id, sensor_id, voltage_v, current_ma, power_mw, is_on, ok, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                update.device_id,
                s.sensor_id,
                s.voltage_v,
                s.current_ma,
                s.power_mw,
                s.is_on ? 1 : 0,
                s.ok ? 1 : 0,
                now
            )
        );
    }

    if (statements.length > 0) {
        await env.DB.batch(statements);
    }
}

// ดึงสรุปของ "วันนี้" (เวลาไทย UTC+7) แยกตามเซนเซอร์ ไว้ใช้ตอนส่งสรุปผ่าน LINE หรือเรียกผ่าน API
export async function getTodaySummary(env: Env, deviceId: string): Promise<SensorSummaryRow[]> {
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
            COALESCE(MAX(power_mw), 0) as peak_power_mw,
            ROUND(AVG(voltage_v), 2) as avg_voltage_v,
            ROUND(AVG(current_ma), 1) as avg_current_ma
         FROM readings
         WHERE device_id = ? AND created_at >= ?
         GROUP BY sensor_id`
    )
        .bind(deviceId, startOfDayUtc)
        .all<SensorSummaryRow>();

    return result.results ?? [];
}

// ดึงประวัติอ่านค่าย้อนหลัง (เช่น 20 รายการล่าสุด) สำหรับแสดงผลใน frontend dashboard
export async function getRecentReadings(env: Env, deviceId: string, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const result = await env.DB.prepare(
        `SELECT id, device_id, sensor_id, voltage_v, current_ma, power_mw, is_on, ok, created_at
         FROM readings
         WHERE device_id = ?
         ORDER BY id DESC
         LIMIT ?`
    )
        .bind(deviceId, safeLimit)
        .all();

    return result.results ?? [];
}

// ----- ล้าง readings เก่า (เรียกจาก cron หรือ manual) -----
// ควร schedule ทุกวันหลังส่ง LINE summary เพื่อป้องกัน D1 ล้นโควตา
export async function deleteOldReadings(env: Env, keepDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await env.DB.prepare(
        `DELETE FROM readings WHERE created_at < ?`
    )
        .bind(cutoff)
        .run();
    return result.meta.changes ?? 0;
}
