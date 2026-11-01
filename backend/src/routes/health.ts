import type { Env } from "../types";
import { jsonResponse } from "../lib/cors";

// GET /health — เช็คสถานะความพร้อมของ Worker และการเชื่อมต่อ D1 Database
export async function handleHealth(env?: Env): Promise<Response> {
    let d1Status = "untested";
    let d1LatencyMs: number | null = null;
    let d1Error: string | null = null;

    if (env?.DB) {
        const start = Date.now();
        try {
            await env.DB.prepare("SELECT 1").first();
            d1LatencyMs = Date.now() - start;
            d1Status = "connected";
        } catch (err) {
            d1Status = "error";
            d1Error = err instanceof Error ? err.message : String(err);
        }
    } else {
        d1Status = "missing_binding";
    }

    const isHealthy = d1Status === "connected";
    const statusCode = isHealthy ? 200 : 503;

    return jsonResponse(
        {
            status: isHealthy ? "ok" : "degraded",
            service: "appliance-notifier-backend",
            timestamp: new Date().toISOString(),
            d1: {
                status: d1Status,
                latency_ms: d1LatencyMs,
                error: d1Error,
            },
        },
        { status: statusCode }
    );
}
