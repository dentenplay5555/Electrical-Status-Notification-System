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

    // ไม่ใช้ if(!sensor_init()) แล้ว halt/loop ค้าง — ให้ทำงานต่อแม้เซนเซอร์ตัวหนึ่งหลุด
    // (ตรงตาม test matrix: "ถอด #1 → #2 ยังทำงาน" และในทางกลับกัน)
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

    Serial.printf("INA219 #1 %s | INA219 #2 %s\n",
                  r1.ok ? "OK" : "ERROR",
                  r2.ok ? "OK" : "ERROR");

    delay(1000);  // สุ่มตัวอย่างค่าทุก 1 วินาที เพื่อจับการเปลี่ยนสถานะได้ไว
}
