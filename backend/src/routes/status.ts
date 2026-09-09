import type { Env } from "../types";
import { getLatestStatus } from "../lib/db";

const STALE_THRESHOLD_MS = 30_000; // เกิน 30 วิ = N/A

// GET /status?device_id=ESP32-01 — เว็บไซต์เรียก endpoint นี้ (polling ทุก 5 วิ)
export async function handleStatus(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device_id") ?? "ESP32-01";

    const status = await getLatestStatus(env, deviceId);

    if (!status) {
        return Response.json({
            device_id: deviceId,
            status: "N/A",
            last_seen: null,
            sensors: [],
        });
    }

    const ageMs = Date.now() - new Date(status.updated_at).getTime();

    if (ageMs > STALE_THRESHOLD_MS) {
        return Response.json({
            device_id: deviceId,
            status: "N/A",
            last_seen: status.updated_at,
            sensors: [],
        });
    }

    return Response.json({
        device_id: status.device_id,
        status: "online",
        last_seen: status.updated_at,
        sensors: status.sensors,
    });
}
