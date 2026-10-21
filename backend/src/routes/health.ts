import { jsonResponse } from "../lib/cors";

// GET /health — เช็คว่า Worker ทำงานปกติ พร้อมส่ง headers CORS
export function handleHealth(): Response {
    return jsonResponse({
        status: "ok",
        service: "appliance-notifier-backend",
        timestamp: new Date().toISOString(),
    });
}
