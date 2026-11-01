import type { Env } from "./types";
import { handleUpdate } from "./routes/update";
import { handleStatus } from "./routes/status";
import { handleHealth } from "./routes/health";
import { handleSummary, handleHistory } from "./routes/metrics";
import { handleAdmin } from "./routes/admin";
import { handleOptions, jsonResponse } from "./lib/cors";
import { getTodaySummary, deleteOldReadings, getDbQuota } from "./lib/db";
import { sendLineMessage } from "./lib/line";

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        // จัดการ Preflight CORS สำหรับ browser requests
        if (request.method === "OPTIONS") {
            return handleOptions();
        }

        const url = new URL(request.url);

        if (url.pathname === "/update" && request.method === "POST") {
            return handleUpdate(request, env);
        }
        if (url.pathname === "/status" && request.method === "GET") {
            return handleStatus(request, env);
        }
        if (url.pathname === "/health" && request.method === "GET") {
            return handleHealth(env);
        }
        if (url.pathname === "/summary" && request.method === "GET") {
            return handleSummary(request, env);
        }
        if (url.pathname === "/history" && request.method === "GET") {
            return handleHistory(request, env);
        }
        if (url.pathname === "/admin") {
            return handleAdmin(request, env);
        }

        return jsonResponse({ error: "not found", path: url.pathname }, { status: 404 });
    },

    // ----- Cron trigger: รันทุกวัน 09:10 UTC = 16:10 น. ไทย -----
    async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
        const deviceId = "ESP32-01";
        try {
            // 1. ล้าง readings เก่าเกิน 7 วันก่อนเสมอ (Data Retention Policy)
            try {
                const deleted = await deleteOldReadings(env, 7);
                if (deleted > 0) {
                    console.log(`[scheduled] pruned ${deleted} old readings`);
                }
            } catch (pruneErr) {
                console.error("[scheduled] prune error:", pruneErr);
            }

            const thaiDate = new Intl.DateTimeFormat("th-TH", {
                timeZone: "Asia/Bangkok",
                dateStyle: "medium",
                timeStyle: "short",
            }).format(new Date());

            // 2. ตรวจสอบ Database Quota & Alert เมื่อใกล้เต็ม
            let quotaInfoText = "";
            try {
                const quota = await getDbQuota(env);
                quotaInfoText = `\n💾 D1 Database: ${quota.readings_count.toLocaleString()} แถว (~${quota.estimated_size_mb} MB / ${quota.usage_percent}%)`;

                // Alert ทันทีหากความจุเกิน 80% หรือเกิน 1 ล้านแถว
                if (quota.usage_percent >= 80 || quota.readings_count >= 1000000) {
                    const quotaAlert = `🚨 [D1 Quota Alert: พื้นที่ใกล้เต็ม!]\n📅 เวลา: ${thaiDate}\n💾 การใช้งาน: ${quota.usage_percent}% (~${quota.estimated_size_mb} MB / ${quota.d1_free_tier_limit_mb} MB)\n📊 ข้อมูลคงเหลือ: ${quota.readings_count.toLocaleString()} แถว\n📅 เก่าสุด: ${quota.oldest_reading ?? "N/A"}\n\n⚠️ คำแนะนำ: เข้าสู่หน้า Admin Console เพื่อ Prune หรือ Export Backup ข้อมูลออก`;
                    await sendLineMessage(env, quotaAlert);
                }
            } catch (quotaErr) {
                console.error("[scheduled] quota check error:", quotaErr);
            }

            // 3. ดึงสรุปการใช้พลังงานประจำวัน
            const summaryRows = await getTodaySummary(env, deviceId);

            if (!summaryRows || summaryRows.length === 0) {
                await sendLineMessage(
                    env,
                    `📊 สรุปการใช้พลังงานประจำวัน\n📅 ${thaiDate}\n🤖 อุปกรณ์: ${deviceId}\n\n⚠️ ไม่มีข้อมูลบันทึกในวันนี้${quotaInfoText}`
                );
                return;
            }

            let text = `⚡ สรุปการใช้พลังงานประจำวัน\n📅 ${thaiDate}\n🤖 อุปกรณ์: ${deviceId}\n`;
            for (const row of summaryRows) {
                const onPct = row.total_readings > 0
                    ? ((row.on_readings / row.total_readings) * 100).toFixed(1)
                    : "0.0";
                const peakMw = row.peak_power_mw ?? 0;
                const peakStr = peakMw >= 1000 ? `${(peakMw / 1000).toFixed(2)} W` : `${peakMw.toFixed(0)} mW`;

                text += `\n────────────────\n`;
                text += `🔹 เซนเซอร์: ${row.sensor_id}\n`;
                text += `⏱ อัตราการเปิดใช้งาน: ${onPct}% (${row.on_readings}/${row.total_readings} ครั้ง)\n`;
                text += `⚡ กำลังไฟฟ้าสูงสุด: ${peakStr}\n`;
                if (row.avg_voltage_v !== undefined && row.avg_voltage_v !== null) {
                    text += `🔌 แรงดันเฉลี่ย: ${row.avg_voltage_v} V\n`;
                }
            }

            text += `\n────────────────${quotaInfoText}\nติดตามสถานะเรียลไทม์ได้ที่หน้าเว็บไซต์แดชบอร์ด`;
            await sendLineMessage(env, text);
        } catch (err) {
            console.error("[scheduled] error in cron trigger:", err);
        }
    },
};
