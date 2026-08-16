// แก้ line.ts — เปลี่ยนจาก push (ต้องมี to) เป็น broadcast (ส่งหาทุกคนที่แอดบอท)
export async function sendLineMessage(env, text) {
    const response = await fetch("https://api.line.me/v2/bot/message/broadcast", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
            messages: [{ type: "text", text }],
            // ไม่มี field "to" เลย เพราะ broadcast ส่งหาทุกคนอัตโนมัติ
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[line] broadcast ไม่สำเร็จ (HTTP ${response.status}): ${errorBody}`);
    }

    return response.ok;
}
