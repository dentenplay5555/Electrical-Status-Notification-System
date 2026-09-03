import type { Env, DeviceUpdate, SensorReading } from "../types";
import { saveLatestStatus, insertReadings } from "../lib/db";

function isValidSensor(s: unknown): s is SensorReading {
    if (typeof s !== "object" || s === null) return false;
    const obj = s as Record<string, unknown>;
    return (
        typeof obj.sensor_id === "string" &&
        typeof obj.voltage_v === "number" &&
        typeof obj.current_ma === "number" &&
        typeof obj.power_mw === "number" &&
        typeof obj.is_on === "boolean" &&
        typeof obj.ok === "boolean"
    );
}

function isValidPayload(body: unknown): body is DeviceUpdate {
    if (typeof body !== "object" || body === null) return false;
    const obj = body as Record<string, unknown>;
    if (typeof obj.device_id !== "string" || obj.device_id.length === 0) return false;
    if (!Array.isArray(obj.sensors)) return false;
    return obj.sensors.every(isValidSensor);
}

// POST /update — ESP32 เรียก endpoint นี้ทุก 10-15 วินาที พร้อม sensors[]
export async function handleUpdate(request: Request, env: Env): Promise<Response> {
    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
    }

    // อย่าเชื่อ JSON จาก ESP32 โดยตรง — validate ให้ตรง schema ก่อนเสมอ
    if (!isValidPayload(body)) {
        return Response.json({ error: "invalid payload: expected { device_id, sensors[] }" }, { status: 400 });
    }

    await Promise.all([saveLatestStatus(env, body), insertReadings(env, body)]);

    return Response.json({ ok: true });
}
