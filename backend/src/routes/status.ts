import type { Env } from "../types";
import { getLatestStatus } from "../lib/db";
import { jsonResponse } from "../lib/cors";

const STALE_THRESHOLD_MS = 30_000; // เกิน 30 วินาที = N/A ตามข้อกำหนดโครงงาน IS

// GET /status?device_id=ESP32-01 — เว็บไซต์เรียก endpoint นี้ (polling ทุก 5 วิ)
export async function handleStatus(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device_id") ?? "ESP32-01";

    const status = await getLatestStatus(env, deviceId);

    if (!status) {
        return jsonResponse({
            device_id: deviceId,
            status: "N/A",
            last_seen: null,
            sensors: [],
            is_stale: true,
            stale_seconds: null,
            message: "No readings received yet",
        });
    }

    const ageMs = Math.max(0, Date.now() - new Date(status.updated_at).getTime());
    const staleSeconds = Math.round(ageMs / 1000);
    const isStale = ageMs > STALE_THRESHOLD_MS;

    if (isStale) {
        return jsonResponse({
            device_id: deviceId,
            status: "N/A",
            last_seen: status.updated_at,
            sensors: [],
            is_stale: true,
            stale_seconds: staleSeconds,
            last_known_sensors: status.sensors,
        });
    }

    return jsonResponse({
        device_id: status.device_id,
        status: "online",
        last_seen: status.updated_at,
        sensors: status.sensors,
        is_stale: false,
        stale_seconds: staleSeconds,
    });
}
