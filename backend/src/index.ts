import type { Env } from "./types";
import { handleUpdate } from "./routes/update";
import { handleStatus } from "./routes/status";
import { handleHealth } from "./routes/health";
import { getTodaySummary } from "./lib/db";
import { sendLineMessage } from "./lib/line";

export default {
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

    // ----- Cron trigger: รันทุกวัน 09:10 UTC = 16:10 น. ไทย -----
    async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
        const deviceId = "ESP32-01";
        const summaryRows = await getTodaySummary(env, deviceId);

        if (!summaryRows || summaryRows.length === 0) {
            await sendLineMessage(env, `📊 สรุปการใช้งานวันนี้\n${deviceId}\nไม่มีข้อมูลบันทึกวันนี้`);
            return;
        }

        let text = `📊 สรุปการใช้งานวันนี้\n${deviceId}\n`;
        for (const row of summaryRows as any[]) {
            text += `\n${row.sensor_id}\n`;
            text += `จำนวนครั้งที่บันทึก: ${row.total_readings}\n`;
            text += `จำนวนครั้งที่เปิด: ${row.on_readings}\n`;
            text += `กำลังไฟฟ้าสูงสุด: ${row.peak_power_mw} mW\n`;
        }

        await sendLineMessage(env, text);
    },
};
