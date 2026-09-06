#include <Arduino.h>
#include "config.h"
#include "sensor.h"
#include "wifi_manager.h"
#include "api_client.h"

static bool lastIsOn1 = false;
static bool lastIsOn2 = false;
static unsigned long lastSendMs = 0;

void setup() {
    Serial.begin(115200);
    delay(500);

    // ไม่ใช้ if(!sensor_init()) { while(true); } — ต้องทำงานต่อแม้เซนเซอร์ตัวหนึ่งหลุด
    sensor_init();

    wifi_connect();
}

void loop() {
    SensorReading r1 = readSensor1();
    SensorReading r2 = readSensor2();

    bool statusChanged = (r1.is_on != lastIsOn1) || (r2.is_on != lastIsOn2);
    bool heartbeatDue   = millis() - lastSendMs >= HEARTBEAT_INTERVAL_MS;

    if (statusChanged || heartbeatDue) {
        if (wifi_ensureConnected()) {
            api_sendReadings(r1, r2);
        }
        lastIsOn1  = r1.is_on;
        lastIsOn2  = r2.is_on;
        lastSendMs = millis();
    }

    Serial.printf("INA219 #1 %s (%.1f mA, %s) | INA219 #2 %s (%.1f mA, %s)\n",
                  r1.ok ? "OK" : "ERROR", r1.current_ma, r1.is_on ? "ON" : "OFF",
                  r2.ok ? "OK" : "ERROR", r2.current_ma, r2.is_on ? "ON" : "OFF");

    delay(1000);  // sensor sampling ทุก 1 วิ (ตรงกับ README/spec)
}
