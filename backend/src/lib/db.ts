import type { Env, DeviceUpdate, StoredStatus, SensorSummaryRow, DbQuotaInfo } from "../types";

// ===== D1 Retry Wrapper =====
// D1 อาจล้มเหลวชั่วคราว (transient error) — retry 1 ครั้งก่อน throw
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    try {
        return await fn();
    } catch (firstErr) {
        console.warn(`[db:${label}] first attempt failed, retrying once...`, firstErr);
        try {
            return await fn();
        } catch (secondErr) {
            console.error(`[db:${label}] retry also failed:`, secondErr);
            throw secondErr;
        }
    }
}

// ===== Replay Protection: ตรวจ sequence_number ร่วมกับ boot_id =====
// คืน true ถ้าเป็น session ใหม่ (boot_id เปลี่ยน) หรือ seq ใหม่กว่าค่าเดิมใน session เดียวกัน
// คืน false ถ้า seq ซ้ำหรือเก่ากว่าใน session เดิม → ปฏิเสธเป็น replay
export async function checkAndUpdateSequence(
    env: Env,
    deviceId: string,
    newSeq: number,
    bootId?: string
): Promise<{ allowed: boolean; lastSeq: number; isNewSession?: boolean }> {
    const now = new Date().toISOString();

    // ดึง boot_id และ sequence ล่าสุดของ device นี้
    const row = await env.DB.prepare(
        `SELECT boot_id, last_sequence FROM device_sequence WHERE device_id = ?`
    )
        .bind(deviceId)
        .first<{ boot_id: string | null; last_sequence: number }>();

    if (row) {
        // หากส่ง bootId มา และไม่ตรงกับใน DB => อุปกรณ์เพิ่ง reboot / เริ่ม boot session ใหม่
        if (bootId && row.boot_id !== bootId) {
            await env.DB.prepare(
                `UPDATE device_sequence SET boot_id = ?, last_sequence = ?, updated_at = ? WHERE device_id = ?`
            )
                .bind(bootId, newSeq, now, deviceId)
                .run();

            return { allowed: true, lastSeq: 0, isNewSession: true };
        }

        const lastSeq = row.last_sequence ?? 0;

        // ถ้า newSeq <= lastSeq ใน session เดียวกัน → replay/out-of-order → reject
        if (newSeq <= lastSeq) {
            return { allowed: false, lastSeq, isNewSession: false };
        }

        // newSeq > lastSeq → อัพเดต sequence ใหม่
        await env.DB.prepare(
            `UPDATE device_sequence SET last_sequence = ?, updated_at = ? WHERE device_id = ?`
        )
            .bind(newSeq, now, deviceId)
            .run();

        return { allowed: true, lastSeq, isNewSession: false };
    }

    // ยังไม่เคยมี record ของ device นี้ => INSERT ครั้งแรก
    await env.DB.prepare(
        `INSERT INTO device_sequence (device_id, boot_id, last_sequence, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
             boot_id       = excluded.boot_id,
             last_sequence = excluded.last_sequence,
             updated_at    = excluded.updated_at`
    )
        .bind(deviceId, bootId ?? null, newSeq, now)
        .run();

    return { allowed: true, lastSeq: 0, isNewSession: true };
}

// ----- D1: สถานะล่าสุด (แทน KV) -----
// upsert ทุก heartbeat (~10s) — 1 row ต่อ device_id เท่านั้น
export async function saveLatestStatus(env: Env, update: DeviceUpdate): Promise<void> {
    const now = new Date().toISOString();
    await withRetry(
        () =>
            env.DB.prepare(
                `INSERT INTO latest_status (device_id, sensors_json, updated_at) VALUES (?, ?, ?)
                 ON CONFLICT(device_id) DO UPDATE SET
                     sensors_json = excluded.sensors_json,
                     updated_at   = excluded.updated_at`
            )
                .bind(update.device_id, JSON.stringify(update.sensors), now)
                .run(),
        "saveLatestStatus"
    );
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
        await withRetry(() => env.DB.batch(statements), "insertReadings");
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
    const result = await withRetry(
        () =>
            env.DB.prepare(
                `DELETE FROM readings WHERE created_at < ?`
            )
                .bind(cutoff)
                .run(),
        "deleteOldReadings"
    );
    return result.meta.changes ?? 0;
}

// ===== Quota Monitoring =====
// ดึงสถิติการใช้งาน D1 Database สำหรับแสดงใน Admin Console
export async function getDbQuota(env: Env): Promise<DbQuotaInfo> {
    const [readingsRes, devicesRes, sensorsRes, statusRes, oldestRes, newestRes] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) as count FROM readings").first<{ count: number }>(),
        env.DB.prepare("SELECT COUNT(*) as count FROM devices").first<{ count: number }>(),
        env.DB.prepare("SELECT COUNT(*) as count FROM sensors").first<{ count: number }>(),
        env.DB.prepare("SELECT COUNT(*) as count FROM latest_status").first<{ count: number }>(),
        env.DB.prepare("SELECT MIN(created_at) as oldest FROM readings").first<{ oldest: string | null }>(),
        env.DB.prepare("SELECT MAX(created_at) as newest FROM readings").first<{ newest: string | null }>(),
    ]);

    const readingsCount = readingsRes?.count ?? 0;
    const devicesCount = devicesRes?.count ?? 0;
    const sensorsCount = sensorsRes?.count ?? 0;
    const statusCount = statusRes?.count ?? 0;

    // ประมาณขนาด: readings row ~150 bytes, index ~50 bytes → ~200 bytes/row
    const estimatedSizeMb = (readingsCount * 200) / (1024 * 1024);
    const d1FreeTierMb = 5120; // 5 GB
    const usagePercent = (estimatedSizeMb / d1FreeTierMb) * 100;

    return {
        readings_count: readingsCount,
        devices_count: devicesCount,
        sensors_count: sensorsCount,
        latest_status_count: statusCount,
        estimated_size_mb: Math.round(estimatedSizeMb * 100) / 100,
        oldest_reading: oldestRes?.oldest ?? undefined,
        newest_reading: newestRes?.newest ?? undefined,
        d1_free_tier_limit_mb: d1FreeTierMb,
        usage_percent: Math.round(usagePercent * 100) / 100,
    };
}

// ===== Backup: Export readings เป็น JSON =====
// ดึง readings ทั้งหมด (หรือตาม range) สำหรับ download backup
export async function exportReadings(
    env: Env,
    deviceId?: string,
    limit = 10000
): Promise<{ readings: unknown[]; devices: unknown[]; latest_status: unknown[]; exported_at: string }> {
    const safeLimit = Math.min(Math.max(limit, 1), 50000);

    const readingsQuery = deviceId
        ? env.DB.prepare("SELECT * FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT ?").bind(deviceId, safeLimit)
        : env.DB.prepare("SELECT * FROM readings ORDER BY id DESC LIMIT ?").bind(safeLimit);

    const [readingsRes, devicesRes, statusRes] = await Promise.all([
        readingsQuery.all(),
        env.DB.prepare("SELECT * FROM devices").all(),
        env.DB.prepare("SELECT * FROM latest_status").all(),
    ]);

    return {
        readings: readingsRes.results ?? [],
        devices: devicesRes.results ?? [],
        latest_status: statusRes.results ?? [],
        exported_at: new Date().toISOString(),
    };
}

// ===== Restore: Import readings จาก JSON backup =====
// รับ array ของ reading objects แล้วเขียนลง DB (skip duplicates ด้วย INSERT OR IGNORE)
export async function importReadings(
    env: Env,
    readings: Array<{
        device_id: string;
        sensor_id: string;
        voltage_v: number;
        current_ma: number;
        power_mw: number;
        is_on: number;
        ok: number;
        created_at: string;
    }>
): Promise<{ imported: number; skipped: number }> {
    if (!readings || readings.length === 0) {
        return { imported: 0, skipped: 0 };
    }

    // จำกัด batch ละ 50 rows เพื่อไม่ให้เกิน D1 statement limit
    const batchSize = 50;
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < readings.length; i += batchSize) {
        const batch = readings.slice(i, i + batchSize);
        const statements: D1PreparedStatement[] = [];

        for (const r of batch) {
            // Validate ก่อน import
            if (
                typeof r.device_id !== "string" ||
                typeof r.sensor_id !== "string" ||
                typeof r.created_at !== "string"
            ) {
                skipped++;
                continue;
            }

            statements.push(
                env.DB.prepare(
                    `INSERT INTO readings (device_id, sensor_id, voltage_v, current_ma, power_mw, is_on, ok, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    r.device_id,
                    r.sensor_id,
                    r.voltage_v ?? 0,
                    r.current_ma ?? 0,
                    r.power_mw ?? 0,
                    r.is_on ?? 0,
                    r.ok ?? 0,
                    r.created_at
                )
            );
        }

        if (statements.length > 0) {
            try {
                await env.DB.batch(statements);
                imported += statements.length;
            } catch (err) {
                console.error(`[db:importReadings] batch ${i}-${i + batchSize} failed:`, err);
                skipped += statements.length;
            }
        }
    }

    return { imported, skipped };
}
