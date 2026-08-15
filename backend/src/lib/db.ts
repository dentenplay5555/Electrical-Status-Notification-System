import type { Env, SensorPayload, StoredStatus } from "../types";

// บันทึกสถานะล่าสุดลง KV (อ่านเร็ว ใช้กับหน้าเว็บที่ต้อง poll บ่อย ๆ)
export async function saveLatestStatus(env: Env, payload: SensorPayload): Promise<void> {
    const stored: StoredStatus = {
        ...payload,
        updated_at: new Date().toISOString(),
    };
    await env.LATEST_STATUS.put(payload.device_id, JSON.stringify(stored));
}

// อ่านสถานะล่าสุดจาก KV
export async function getLatestStatus(env: Env, deviceId: string): Promise<StoredStatus | null> {
    const raw = await env.LATEST_STATUS.get(deviceId);
    return raw ? (JSON.parse(raw) as StoredStatus) : null;
}

// บันทึก log ลง D1 (เก็บประวัติทุกครั้ง ใช้สรุปรายวัน)
export async function insertLog(env: Env, payload: SensorPayload): Promise<void> {
    await env.DB.prepare(
        `INSERT INTO logs (device_id, is_on, voltage_v, current_ma, power_mw, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    )
        .bind(
            payload.device_id,
            payload.is_on ? 1 : 0,
            payload.voltage_v,
            payload.current_ma,
            payload.power_mw,
            new Date().toISOString()
        )
        .run();
}

// ดึงสรุปของ "วันนี้" (ตามเวลาไทย) ไว้ใช้ตอนส่งสรุปผ่าน LINE ตอน 16:10
export async function getTodaySummary(env: Env, deviceId: string) {
    // แปลงเป็นเวลาไทย (UTC+7) แล้วหาจุดเริ่มต้นของวัน
    const now = new Date();
    const bangkokOffsetMs = 7 * 60 * 60 * 1000;
    const bangkokNow = new Date(now.getTime() + bangkokOffsetMs);
    const startOfDayBangkok = new Date(
        Date.UTC(bangkokNow.getUTCFullYear(), bangkokNow.getUTCMonth(), bangkokNow.getUTCDate())
    );
    const startOfDayUtc = new Date(startOfDayBangkok.getTime() - bangkokOffsetMs).toISOString();

    const result = await env.DB.prepare(
        `SELECT
            COUNT(*) as total_events,
            SUM(CASE WHEN is_on = 1 THEN 1 ELSE 0 END) as on_events,
            MAX(power_mw) as peak_power_mw
         FROM logs
         WHERE device_id = ? AND created_at >= ?`
    )
        .bind(deviceId, startOfDayUtc)
        .first();

    return result;
}
