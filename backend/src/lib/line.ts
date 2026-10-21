import type { Env } from "../types";

/**
 * ส่งข้อความผ่าน LINE Messaging API
 * รองรับทั้ง LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_ACCESS_TOKEN
 * หากไม่ได้ตั้งค่า token ไว้ จะแจ้งเตือนใน console โดยไม่ทำให้ scheduled event ขัดข้อง
 */
export async function sendLineMessage(env: Env, text: string): Promise<boolean> {
    const token = env.LINE_CHANNEL_ACCESS_TOKEN || env.LINE_ACCESS_TOKEN;

    if (!token || token.trim() === "" || token === "just_token") {
        console.warn("[line] ไม่พบ LINE Access Token (ข้ามการส่งข้อความ)");
        return false;
    }

    try {
        const response = await fetch("https://api.line.me/v2/bot/message/broadcast", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                messages: [{ type: "text", text }],
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[line] broadcast ไม่สำเร็จ (HTTP ${response.status}): ${errorBody}`);
            return false;
        }

        console.log("[line] broadcast ข้อความสำเร็จ");
        return true;
    } catch (err) {
        console.error("[line] error calling LINE API:", err);
        return false;
    }
}
