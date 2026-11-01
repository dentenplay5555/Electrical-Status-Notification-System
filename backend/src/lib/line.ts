import type { Env } from "../types";

/**
 * ส่งข้อความผ่าน LINE Messaging API
 * รองรับทั้ง LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_ACCESS_TOKEN
 * มีระบบ Retry สูงสุด 3 ครั้ง พร้อม Exponential Backoff เมื่อเกิด Transient Error
 */
export async function sendLineMessage(env: Env, text: string, maxRetries = 3): Promise<boolean> {
    const token = env.LINE_CHANNEL_ACCESS_TOKEN || env.LINE_ACCESS_TOKEN;

    if (!token || token.trim() === "" || token === "just_token") {
        console.warn("[line] ไม่พบ LINE Access Token (ข้ามการส่งข้อความ)");
        return false;
    }

    const payload = JSON.stringify({
        messages: [{ type: "text", text }],
    });

    let delayMs = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch("https://api.line.me/v2/bot/message/broadcast", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: payload,
            });

            if (response.ok) {
                if (attempt > 1) {
                    console.log(`[line] broadcast ข้อความสำเร็จ (หลังพยายามครั้งที่ ${attempt})`);
                } else {
                    console.log("[line] broadcast ข้อความสำเร็จ");
                }
                return true;
            }

            const errorBody = await response.text();
            console.error(`[line] broadcast ไม่สำเร็จ attempt ${attempt}/${maxRetries} (HTTP ${response.status}): ${errorBody}`);

            // หากเป็น client auth/bad request (ยกเว้น 429 Rate Limit) ให้หยุดทันที ไม่ต้อง retry
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                return false;
            }
        } catch (err) {
            console.error(`[line] error calling LINE API attempt ${attempt}/${maxRetries}:`, err);
        }

        if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs *= 2;
        }
    }

    console.error(`[line] broadcast ล้มเหลวครบ ${maxRetries} ครั้ง`);
    return false;
}
