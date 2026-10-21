#include "api_client.h"
#include "config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

// จุดตรวจ priority 4: field ที่ใส่ตรงนี้ต้องตรงกับชื่อใน SensorReading (sensor.h)
// และตรงกับ backend/types.ts (SensorReading interface) แบบ 1:1 ทุกตัว
static void addSensorToDoc(JsonArray &sensorsArray, const SensorReading &r) {
    JsonObject s = sensorsArray.add<JsonObject>();
    s["sensor_id"]  = r.sensor_id;   // sensor.h: sensor_id   | types.ts: sensor_id   ✓
    s["voltage_v"]  = r.voltage_v;   // sensor.h: voltage_v   | types.ts: voltage_v   ✓
    s["current_ma"] = r.current_ma;  // sensor.h: current_ma  | types.ts: current_ma  ✓
    s["power_mw"]   = r.power_mw;    // sensor.h: power_mw    | types.ts: power_mw    ✓
    s["is_on"]      = r.is_on;       // sensor.h: is_on       | types.ts: is_on       ✓
    s["ok"]         = r.ok;          // sensor.h: ok          | types.ts: ok          ✓
}

bool api_sendReadings(const SensorReading &reading1, const SensorReading &reading2) {
    HTTPClient http;
    http.begin(API_ENDPOINT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " DEVICE_TOKEN);
    http.setTimeout(5000);

    JsonDocument doc;
    doc["device_id"] = DEVICE_ID;   // ต้องตรงกับ backend validate: device_id (string)
    JsonArray sensorsArray = doc["sensors"].to<JsonArray>();  // ต้องเป็น array เสมอ
    addSensorToDoc(sensorsArray, reading1);
    addSensorToDoc(sensorsArray, reading2);

    String payload;
    serializeJson(doc, payload);

    int httpCode = http.POST(payload);
    bool ok = httpCode >= 200 && httpCode < 300;

    if (ok) {
        Serial.printf("[api] ส่งสำเร็จ (HTTP %d)\n", httpCode);
    } else {
        Serial.printf("[api] ส่งไม่สำเร็จ (HTTP %d)\n", httpCode);
    }

    http.end();
    return ok;
}
