import type { Env, SensorPayload } from "../types";
import { saveLatestStatus, insertLog } from "../lib/db";

// POST /update — ESP32 เรียก endpoint นี้ทุก 10-15 วินาที
export async function handleUpdate(request: Request, env: Env): Promise<Response> {
    let payload: SensorPayload;

    try {
        payload = await request.json();
    } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
    }

    if (!payload.device_id) {
        return Response.json({ error: "missing device_id" }, { status: 400 });
    }

    // เขียนสถานะล่าสุดลง KV (ให้เว็บอ่านเร็ว) และ log ลง D1 (เก็บประวัติ) พร้อมกัน
    await Promise.all([saveLatestStatus(env, payload), insertLog(env, payload)]);

    return Response.json({ ok: true });
}
