import test from "node:test";
import assert from "node:assert/strict";
import workerModule from "../src/index.ts";
const worker = workerModule.default || workerModule;

// Mock D1 ที่จำลอง "เขียนไม่ได้" ได้ และนับจำนวนแถว readings ที่ถูกเขียน
function createDb() {
    const st = { sequences: new Map(), latest: new Map(), readings: [], failWrites: false };
    const db = {
        st,
        prepare(sql) {
            let p = [];
            return {
                bind(...a) { p = a; return this; },
                async first() {
                    if (sql.includes("FROM device_sequence")) return st.sequences.get(p[0]) || null;
                    if (sql.includes("FROM latest_status")) return st.latest.get(p[0]) || null;
                    if (sql.includes("MAX(created_at)")) {
                        const r = st.readings.filter((x) => x.device_id === p[0]);
                        return { t: r.length ? r[r.length - 1].created_at : null };
                    }
                    return null;
                },
                async all() { return { results: [] }; },
                async run() {
                    if (st.failWrites) throw new Error("D1 down");
                    if (sql.includes("INTO device_sequence")) st.sequences.set(p[0], { boot_id: p[1], last_sequence: p[2] });
                    if (sql.includes("INTO latest_status")) st.latest.set(p[0], { device_id: p[0], sensors_json: p[1], updated_at: p[2] });
                    if (sql.includes("INTO readings")) st.readings.push({ device_id: p[0], sensor_id: p[1], is_on: p[5], created_at: p[7] });
                    return { success: true };
                },
            };
        },
        async batch(stmts) { for (const s of stmts) await s.run(); return []; },
    };
    return db;
}

const post = (env, seq, isOn = false, boot = "BOOT1") =>
    worker.fetch(new Request("https://x/update", {
        method: "POST",
        headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
        body: JSON.stringify({
            device_id: "ESP32-01", boot_id: boot, sequence_number: seq,
            sensors: [{ sensor_id: "S1", voltage_v: 5, current_ma: isOn ? 60 : 1, power_mw: 1, is_on: isOn, ok: true }],
        }),
    }), env);

test("D1 ล่ม -> 503 และ seq เดิมส่งซ้ำได้ (ไม่ถูกตีเป็น replay)", async () => {
    const env = { DEVICE_TOKEN: "t", DB: createDb() };
    env.DB.st.failWrites = true;
    assert.equal((await post(env, 1)).status, 503);
    assert.equal(env.DB.st.sequences.size, 0, "ต้องไม่ commit seq เมื่อเขียนไม่สำเร็จ");
    env.DB.st.failWrites = false;
    assert.equal((await post(env, 1)).status, 200, "ส่ง seq=1 ซ้ำหลัง D1 กลับมาต้องผ่าน");
    assert.equal((await post(env, 1)).status, 409, "ส่งซ้ำหลังบันทึกแล้วยังเป็น replay");
});

test("บันทึกประวัติเฉพาะตอนสถานะเปลี่ยนหรือครบ 60 วินาที", async () => {
    const env = { DEVICE_TOKEN: "t", DB: createDb() };
    await post(env, 1);                       // ครั้งแรก -> บันทึก
    await post(env, 2);                       // สถานะเดิม ภายใน 60 วิ -> ไม่บันทึก
    await post(env, 3);
    assert.equal(env.DB.st.readings.length, 1);
    await post(env, 4, true);                 // OFF -> ON -> บันทึกทันที
    assert.equal(env.DB.st.readings.length, 2);
    // latest_status ต้องอัปเดตทุกครั้ง (ใช้คำนวณ N/A)
    assert.equal(JSON.parse(env.DB.st.latest.get("ESP32-01").sensors_json)[0].is_on, true);
});
