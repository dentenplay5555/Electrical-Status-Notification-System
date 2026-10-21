import type { Env, DeviceUpdate, SensorReading } from "../types";
import { saveLatestStatus, insertReadings } from "../lib/db";
import { jsonResponse } from "../lib/cors";

// ----- Auth -----
// แฮชด้วย SHA-256 ทั้งสองด้านก่อน เพื่อให้ buffer มีความยาว 32 bytes เท่ากันเสมอ
// ป้องกัน crypto.subtle.timingSafeEqual โยน TypeError เมื่อ token มีความยาวไม่เท่ากัน
async function safeEqual(a: string, b: string): Promise<boolean> {
    const enc = new TextEncoder();
    const [ha, hb] = await Promise.all([
        crypto.subtle.digest("SHA-256", enc.encode(a)),
        crypto.subtle.digest("SHA-256", enc.encode(b)),
    ]);
    return crypto.subtle.timingSafeEqual(ha, hb);
}

// ตรวจสอบ Bearer token (fail-closed):
// - หากตั้ง ALLOW_NO_AUTH=true ใน .dev.vars → ยอมรับทุก request (ใช้เฉพาะ local dev)
// - หากไม่มี DEVICE_TOKEN บน Worker → ปฏิเสธ (401) เสมอ พร้อม log แจ้งเตือน
async function checkBearerToken(request: Request, env: Env): Promise<boolean> {
    if (env.ALLOW_NO_AUTH === "true") {
        return true;
    }

    if (!env.DEVICE_TOKEN) {
        console.error(
            "[auth] DEVICE_TOKEN is not configured on Worker (fail-closed). " +
            "Run 'npx wrangler secret put DEVICE_TOKEN' on production, " +
            "or set ALLOW_NO_AUTH=true in .dev.vars for local development."
        );
        return false;
    }

    const auth = request.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
        return false;
    }

    const token = auth.slice(7).trim();
    if (!token) return false;

    return safeEqual(token, env.DEVICE_TOKEN);
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
    if (!(await checkBearerToken(request, env))) {
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
