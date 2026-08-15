import type { Env } from "../types";
import { getLatestStatus } from "../lib/db";

const STALE_THRESHOLD_MS = 30_000; // ตรงกับ diagram: เกิน 30 วิ = N/A

// GET /status?device_id=device-01 — เว็บไซต์เรียก endpoint นี้ (polling ทุก 5 วิ)
export async function handleStatus(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device_id") ?? "device-01";

    const status = await getLatestStatus(env, deviceId);

    if (!status) {
        return Response.json({ status: "N/A", reason: "ยังไม่เคยได้รับข้อมูลจากอุปกรณ์นี้" });
    }

    const ageMs = Date.now() - new Date(status.updated_at).getTime();

    if (ageMs > STALE_THRESHOLD_MS) {
        // ค่าเก่าเกินไป ถือว่า ESP32 หลุดการเชื่อมต่อ
        return Response.json({ status: "N/A", reason: "ไม่ได้รับข้อมูลเกิน 30 วินาที", last_seen: status.updated_at });
    }

    return Response.json({ status: "OK", data: status });
}
