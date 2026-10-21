import type { Env } from "../types";
import { getTodaySummary, getRecentReadings } from "../lib/db";
import { jsonResponse } from "../lib/cors";

// GET /summary?device_id=ESP32-01 — สรุปสถิติประจำวันของวันนี้ (เวลาไทย)
export async function handleSummary(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device_id") ?? "ESP32-01";

    try {
        const summary = await getTodaySummary(env, deviceId);
        return jsonResponse({
            device_id: deviceId,
            date: new Date().toISOString().slice(0, 10),
            summary,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: "failed to fetch summary", detail: message }, { status: 500 });
    }
}

// GET /history?device_id=ESP32-01&limit=20 — ดึงประวัติอ่านค่าย้อนหลัง
export async function handleHistory(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device_id") ?? "ESP32-01";
    const limitParam = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 20;

    try {
        const readings = await getRecentReadings(env, deviceId, limit);
        return jsonResponse({
            device_id: deviceId,
            count: readings.length,
            readings,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: "failed to fetch history", detail: message }, { status: 500 });
    }
}
