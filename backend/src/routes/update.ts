import type { Env, DeviceUpdate, SensorReading } from "../types";
import { saveLatestStatus, insertReadings, checkAndUpdateSequence } from "../lib/db";
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

    const subtleWithTiming = crypto.subtle as unknown as { timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean };
    if (typeof subtleWithTiming.timingSafeEqual === "function") {
        return subtleWithTiming.timingSafeEqual(ha, hb);
    }

    // Constant-time comparison fallback for environments without crypto.subtle.timingSafeEqual (e.g. Node.js runner)
    const viewA = new Uint8Array(ha);
    const viewB = new Uint8Array(hb);
    let diff = 0;
    for (let i = 0; i < viewA.length; i++) {
        diff |= viewA[i] ^ viewB[i];
    }
    return diff === 0;
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
    if (obj.boot_id !== undefined && (typeof obj.boot_id !== "string" || obj.boot_id.trim().length === 0)) {
        return false;
    }
    if (!Array.isArray(obj.sensors) || obj.sensors.length === 0) return false;
    // sequence_number เป็น optional — ถ้ามีต้องเป็น integer >= 0
    if (obj.sequence_number !== undefined) {
        if (typeof obj.sequence_number !== "number" || !Number.isInteger(obj.sequence_number) || obj.sequence_number < 0) {
            return false;
        }
    }
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
            { error: "invalid payload: expected { device_id: string, boot_id?: string, sensors: SensorReading[], sequence_number?: number }" },
            { status: 400 }
        );
    }

    try {
        // 4. Replay Protection: ตรวจ sequence_number ร่วมกับ boot_id (ถ้ามี)
        // ถ้า ESP32 ส่ง sequence_number มา → ต้อง > ค่าล่าสุดใน DB (ใน boot session นั้น)
        // ถ้า boot_id เปลี่ยน (ESP32 reboot) → Backend ยอมรับและเริ่ม session ใหม่
        if (body.sequence_number !== undefined && body.sequence_number > 0) {
            const seqCheck = await checkAndUpdateSequence(env, body.device_id, body.sequence_number, body.boot_id);
            if (!seqCheck.allowed) {
                console.warn(
                    `[update] replay detected: device=${body.device_id} boot=${body.boot_id ?? "legacy"} sent seq=${body.sequence_number} but last_seq=${seqCheck.lastSeq}`
                );
                return jsonResponse(
                    {
                        error: "replay detected",
                        detail: `sequence_number ${body.sequence_number} <= last accepted ${seqCheck.lastSeq}`,
                    },
                    { status: 409 } // 409 Conflict
                );
            }
        }

        // 5. เขียนลง D1 พร้อมกัน: latest_status (แทน KV) + readings (ประวัติ)
        // ใช้ Promise.allSettled เพื่อให้ระบบทำงานต่อได้แบบ degraded mode แม้ตารางใดตารางหนึ่งขัดข้องชั่วคราว
        const [statusResult, readingsResult] = await Promise.allSettled([
            saveLatestStatus(env, body),
            insertReadings(env, body),
        ]);

        const statusOk = statusResult.status === "fulfilled";
        const readingsOk = readingsResult.status === "fulfilled";

        // หากล้มเหลวทั้งสองตาราง = D1 ล่มอย่างสิ้นเชิง
        if (!statusOk && !readingsOk) {
            console.error("[update] D1 completely unavailable:", statusResult.reason, readingsResult.reason);
            // คืน 503 เพื่อให้ ESP32 รับรู้และเก็บข้อมูลเข้า Offline Ring Buffer รอส่งใหม่
            return jsonResponse(
                {
                    error: "database temporarily unavailable",
                    detail: "D1 database write failed. ESP32 will buffer and retry upon recovery.",
                },
                { status: 503 }
            );
        }

        // กรณีสำเร็จบางส่วน (Degraded Mode)
        if (!statusOk) {
            console.warn("[update] saveLatestStatus failed (readings saved):", statusResult.reason);
        }
        if (!readingsOk) {
            console.warn("[update] insertReadings failed (latest_status saved):", readingsResult.reason);
        }

        return jsonResponse({
            ok: true,
            degraded: !statusOk || !readingsOk,
            warning: !readingsOk ? "readings history write failed, latest status updated" : undefined,
            timestamp: new Date().toISOString(),
            boot_id: body.boot_id ?? null,
            sequence_number: body.sequence_number ?? null,
        });
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[update] error processing update:", errorMsg);
        return jsonResponse({ error: "internal server error", detail: errorMsg }, { status: 500 });
    }
}

