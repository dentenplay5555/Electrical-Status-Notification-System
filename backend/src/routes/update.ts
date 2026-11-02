import type { Env, DeviceUpdate, SensorReading } from "../types";
import { saveLatestStatus, insertReadings, checkSequence, commitSequence, getLatestStatus, getLastReadingTime } from "../lib/db";
import { jsonResponse } from "../lib/cors";

// บันทึกประวัติลงตาราง readings อย่างน้อยทุกกี่ ms (หรือทันทีเมื่อสถานะเปลี่ยน)
// ลดแถวที่เขียนต่อวัน: latest_status ยังอัปเดตทุก heartbeat เพื่อให้ N/A (30 วิ) ทำงานเหมือนเดิม
const HISTORY_INTERVAL_MS = 60_000;

function sensorsChanged(prev: { sensor_id: string; is_on: boolean; ok: boolean }[] | undefined, next: { sensor_id: string; is_on: boolean; ok: boolean }[]): boolean {
    if (!prev || prev.length !== next.length) return true;
    return next.some((n) => {
        const p = prev.find((x) => x.sensor_id === n.sensor_id);
        return !p || p.is_on !== n.is_on || p.ok !== n.ok;
    });
}

async function shouldRecordHistory(env: Env, update: DeviceUpdate): Promise<boolean> {
    try {
        const [prev, lastAt] = await Promise.all([
            getLatestStatus(env, update.device_id),
            getLastReadingTime(env, update.device_id),
        ]);
        if (!prev || !lastAt) return true;
        if (sensorsChanged(prev.sensors, update.sensors)) return true;
        return Date.now() - new Date(lastAt).getTime() >= HISTORY_INTERVAL_MS;
    } catch {
        return true; // อ่านไม่ได้ → บันทึกไว้ก่อน ดีกว่าข้อมูลหาย
    }
}

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
            const seqCheck = await checkSequence(env, body.device_id, body.sequence_number, body.boot_id);
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

        // 5. เขียนลง D1: latest_status ทุกครั้ง + readings (ประวัติ) เมื่อสถานะเปลี่ยนหรือครบ HISTORY_INTERVAL_MS
        // ใช้ Promise.allSettled เพื่อให้ทำงานต่อแบบ degraded mode แม้ตารางใดตารางหนึ่งล้มเหลว
        const recordHistory = await shouldRecordHistory(env, body);
        const [statusResult, readingsResult] = await Promise.allSettled([
            saveLatestStatus(env, body),
            recordHistory ? insertReadings(env, body) : Promise.resolve(),
        ]);

        const statusOk = statusResult.status === "fulfilled";
        const readingsOk = readingsResult.status === "fulfilled";

        // ล้มเหลวหมด (หรือ latest_status ล้มเหลวขณะรอบนี้ไม่ได้บันทึกประวัติ) = ไม่มีอะไรถูกเก็บ
        // → ไม่ commit sequence แล้วตอบ 503 เพื่อให้ ESP32 ส่ง seq เดิมซ้ำได้
        if (!statusOk && (!recordHistory || !readingsOk)) {
            console.error("[update] D1 write failed:", statusResult.status === "rejected" ? statusResult.reason : "", readingsResult.status === "rejected" ? readingsResult.reason : "");
            return jsonResponse(
                {
                    error: "database temporarily unavailable",
                    detail: "D1 database write failed. ESP32 will buffer and retry upon recovery.",
                },
                { status: 503 }
            );
        }

        // 6. เขียนสำเร็จอย่างน้อยหนึ่งตาราง → commit sequence (เพื่อให้ replay ถูกปฏิเสธนับจากตรงนี้)
        if (body.sequence_number !== undefined && body.sequence_number > 0) {
            try {
                await commitSequence(env, body.device_id, body.sequence_number, body.boot_id);
            } catch (seqErr) {
                console.warn("[update] commitSequence failed (data saved):", seqErr);
            }
        }

        // กรณีสำเร็จบางส่วน (Degraded Mode)
        if (!statusOk) {
            console.warn("[update] saveLatestStatus failed (readings saved):", statusResult.reason);
        }
        if (recordHistory && !readingsOk) {
            console.warn("[update] insertReadings failed (latest_status saved):", readingsResult.reason);
        }

        return jsonResponse({
            ok: true,
            degraded: !statusOk || (recordHistory && !readingsOk),
            warning: recordHistory && !readingsOk ? "readings history write failed, latest status updated" : undefined,
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

