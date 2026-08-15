import type { Env } from "./types";
import { handleUpdate } from "./routes/update";
import { handleStatus } from "./routes/status";
import { handleHealth } from "./routes/health";
import { getTodaySummary } from "./lib/db";
import { sendLineMessage } from "./lib/line";

export default {
    // ----- HTTP requests (จาก ESP32 และเว็บไซต์) -----
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/update" && request.method === "POST") {
            return handleUpdate(request, env);
        }

        if (url.pathname === "/status" && request.method === "GET") {
            return handleStatus(request, env);
        }

        if (url.pathname === "/health" && request.method === "GET") {
            return handleHealth();
        }

        return Response.json({ error: "not found" }, { status: 404 });
    },

    // ----- Cron trigger: รันทุกวัน 09:10 UTC = 16:10 น. ไทย (ตั้งใน wrangler.toml) -----
    async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
        const deviceId = "device-01";
        const summary = await getTodaySummary(env, deviceId);

        const totalEvents = summary?.total_events ?? 0;
        const onEvents = summary?.on_events ?? 0;
        const peakPower = summary?.peak_power_mw ?? 0;

        const text =
            `📊 สรุปการใช้งานวันนี้\n` +
            `จำนวนครั้งที่บันทึกข้อมูล: ${totalEvents}\n` +
            `จำนวนครั้งที่เปิดเครื่อง: ${onEvents}\n` +
            `กำลังไฟฟ้าสูงสุด: ${peakPower} mW`;

        await sendLineMessage(env, text);
    },
};
