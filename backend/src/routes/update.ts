import type { Env, DeviceUpdate, SensorReading } from "../types";
import { saveLatestStatus, insertReadings } from "../lib/db";
import { jsonResponse } from "../lib/cors";

// ----- Auth -----
// ถ้า DEVICE_TOKEN secret ไม่ได้ตั้งค่าไว้ใน Worker → ข้าม auth (dev/local mode)
function checkBearerToken(request: Request, env: Env): boolean {
    if (!env.DEVICE_TOKEN) return true; // ยังไม่ได้ตั้ง secret → ผ่าน (ควรตั้งก่อน deploy)
    const auth = request.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    return token === env.DEVICE_TOKEN;
}

// ----- Payload validation -----
function isValidSensor(s: unknown): s is SensorReading {
    if (typeof s !== "object" || s === null) return false;
    const obj = s as Record<string, unknown>;
    return (
        typeof obj.sensor_id === "string" &&
        obj.sensor_id.trim().length > 0 &&
        typeof obj.voltage_v === "number" &&
        Number.isFinite(obj.voltage_v) &&
        typeof obj.current_ma === "number" &&
        Number.isFinite(obj.current_ma) &&
        typeof obj.power_mw === "number" &&
        Number.isFinite(obj.power_mw) &&
        typeof obj.is_on === "boolean" &&
        typeof obj.ok === "boolean"
    );
}

function isValidPayload(body: unknown): body is DeviceUpdate {
    if (typeof body !== "object" || body === null) return false;
    const obj = body as Record<string, unknown>;
    if (typeof obj.device_id !== "string" || obj.device_id.trim().length === 0) return false;
    if (!Array.isArray(obj.sensors) || obj.sensors.length === 0) return false;
    return obj.sensors.every(isValidSensor);
}

// POST /update — ESP32 เรียก endpoint นี้ทุก 10 วินาที พร้อม sensors[]
// ต้องแนบ header: Authorization: Bearer <DEVICE_TOKEN>
export async function handleUpdate(request: Request, env: Env): Promise<Response> {
    // 1. ตรวจ Bearer token ก่อนอ่าน body
    if (!checkBearerToken(request, env)) {
        return jsonResponse({ error: "unauthorized" }, { status: 401 });
    }

    // 2. Parse JSON
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: "invalid JSON" }, { status: 400 });
    }

    // 3. Validate payload ให้ตรง schema ก่อนเก็บลง DB เสมอ
    if (!isValidPayload(body)) {
        return jsonResponse(
            { error: "invalid payload: expected { device_id: string, sensors: SensorReading[] }" },
            { status: 400 }
        );
    }

    try {
        // 4. เขียนลง D1 พร้อมกัน: latest_status (แทน KV) + readings (ประวัติ)
        await Promise.all([
            saveLatestStatus(env, body),
            insertReadings(env, body),
        ]);

        return jsonResponse({ ok: true, timestamp: new Date().toISOString() });
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[update] error processing update:", errorMsg);
        return jsonResponse({ error: "internal server error", detail: errorMsg }, { status: 500 });
    }
}
