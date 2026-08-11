#include <Arduino.h>
#include "config.h"
#include "sensor.h"
#include "wifi_manager.h"
#include "api_client.h"

static bool lastIsOn = false;
static unsigned long lastSendMs = 0;

void setup() {
    Serial.begin(115200);
    delay(500);

    if (!sensor_init()) {
        Serial.println("[main] ตรวจสอบการต่อ INA219 แล้วรีสตาร์ทบอร์ด");
    }

    wifi_connect();
}

void loop() {
    SensorReading reading = sensor_read();

    bool statusChanged = reading.isOn != lastIsOn;
    bool heartbeatDue   = millis() - lastSendMs >= HEARTBEAT_INTERVAL_MS;

    // ส่งข้อมูลทันทีเมื่อสถานะเปลี่ยน หรือส่ง heartbeat ตามรอบเวลาปกติ
    if (statusChanged || heartbeatDue) {
        if (wifi_ensureConnected()) {
            api_sendReading(reading);
        }
        lastIsOn   = reading.isOn;
        lastSendMs = millis();
    }

    delay(1000);  // สุ่มตัวอย่างค่าทุก 1 วินาที เพื่อจับการเปลี่ยนสถานะได้ไว
}
