#include "api_client.h"
#include "config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

// จุดตรวจ priority 4: field ที่ใส่ตรงนี้ต้องตรงกับชื่อใน SensorReading (sensor.h) at line 24
// และตรงกับ backend/types.ts (SensorReading interface) แบบ 1:1 ทุกตัว
static void addSensorToDoc(JsonArray &sensorsArray, const SensorReading &r) {
    JsonObject s = sensorsArray.add<JsonObject>();
    s["sensor_id"]  = r.sensor_id;
    s["voltage_v"]  = r.voltage_v;
    s["current_ma"] = r.current_ma;
    s["power_mw"]   = r.power_mw;
    s["is_on"]      = r.is_on;
    s["ok"]         = r.ok;
}

// ----- Retry with Exponential Backoff -----
// ส่งข้อมูลพร้อม sequence_number สำหรับ replay protection
// retry สูงสุด API_MAX_RETRIES ครั้ง ด้วย exponential backoff: 1s → 2s → 4s
bool api_sendReadings(const SensorReading &reading1, const SensorReading &reading2, uint32_t sequenceNumber, const char *bootId) {
    // สร้าง payload ครั้งเดียว ใช้ซ้ำทุก retry
    JsonDocument doc;
    doc["device_id"] = DEVICE_ID;   // ต้องตรงกับ backend validate: device_id (string)
    if (bootId && strlen(bootId) > 0) {
        doc["boot_id"] = bootId;    // session identifier ป้องกัน replay reject ตอน reboot
    }
    doc["sequence_number"] = sequenceNumber;  // replay protection: ต้อง > ค่าล่าสุดใน DB
    JsonArray sensorsArray = doc["sensors"].to<JsonArray>();  // ต้องเป็น array 1D เสมอ;
    addSensorToDoc(sensorsArray, reading1);
    addSensorToDoc(sensorsArray, reading2);
    String payload;
    serializeJson(doc, payload);

    unsigned long backoffMs = API_INITIAL_BACKOFF_MS;

    for (int attempt = 1; attempt <= API_MAX_RETRIES; attempt++) {
        HTTPClient http;
        http.begin(API_ENDPOINT);
        http.addHeader("Content-Type", "application/json");
        http.addHeader("Authorization", "Bearer " DEVICE_TOKEN);
        http.setTimeout(5000);

        int httpCode = http.POST(payload);
        bool ok = httpCode >= 200 && httpCode < 300;
        http.end();

        if (ok) {
            if (attempt > 1) {
                Serial.printf("[api] ส่งสำเร็จหลังลองครั้งที่ %d (HTTP %d)\n", attempt, httpCode);
            } else {
                Serial.printf("[api] ส่งสำเร็จ (HTTP %d, seq=%lu)\n", httpCode, (unsigned long)sequenceNumber);
            }
            return true;
        }

        // ถ้า 4xx (ยกเว้น 429 Rate Limit) → ข้อมูลผิด ไม่ต้อง retry
        if (httpCode >= 400 && httpCode < 500 && httpCode != 429) {
            Serial.printf("[api] ส่งไม่สำเร็จ (HTTP %d) — client error, ข้ามการ retry\n", httpCode);
            return false;
        }

        // 5xx, timeout, หรือ connection error → retry ด้วย backoff
        if (attempt < API_MAX_RETRIES) {
            Serial.printf("[api] ส่งไม่สำเร็จ (HTTP %d) — retry %d/%d หลังจากรอ %lu ms\n",
                          httpCode, attempt, API_MAX_RETRIES, backoffMs);
            delay(backoffMs);
            // exponential backoff: 1s → 2s → 4s (cap ที่ API_MAX_BACKOFF_MS)
            backoffMs = min(backoffMs * 2, (unsigned long)API_MAX_BACKOFF_MS);
        } else {
            Serial.printf("[api] ส่งไม่สำเร็จ (HTTP %d) — หมดรอบ retry (%d ครั้ง)\n",
                          httpCode, API_MAX_RETRIES);
        }
    }
    return false;
}
