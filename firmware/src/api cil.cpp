#include "api_client.h"
#include "config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

bool api_sendReading(const SensorReading &reading) {
    HTTPClient http;
    http.begin(API_ENDPOINT);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);

    JsonDocument doc;
    doc["device_id"]  = DEVICE_ID;
    doc["is_on"]      = reading.isOn;
    doc["voltage_v"]  = reading.busVoltage_V;
    doc["current_ma"] = reading.current_mA;
    doc["power_mw"]   = reading.power_mW;

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
