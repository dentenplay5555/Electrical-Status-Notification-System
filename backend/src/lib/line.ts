import type { Env } from "../types";

// ส่งข้อความ push ผ่าน LINE Messaging API
// ใช้ fetch() ตรงไป LINE server เลย ไม่ผ่านชั้นกลางแบบ Apps Script ที่เคยมีปัญหา
export async function sendLineMessage(env: Env, text: string): Promise<boolean> {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.LINE_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
            to: env.LINE_USER_ID,
            messages: [{ type: "text", text }],
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[line] ส่งไม่สำเร็จ (HTTP ${response.status}): ${errorBody}`);
    }

    return response.ok;
}
