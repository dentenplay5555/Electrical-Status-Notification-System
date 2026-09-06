// i2c_scanner.cpp — รันแยกก่อนใช้ firmware จริง เพื่อยืนยันว่า INA219 ทั้งสองตัว
// ตอบที่ address 0x40 และ 0x41 จริง (ไม่ใช่ 0x40 ซ้ำกันทั้งคู่)
#include <Arduino.h>
#include <Wire.h>

void setup() {
    Serial.begin(115200);
    delay(1000);
    Wire.begin(); // GPIO21=SDA, GPIO22=SCL

    Serial.println("[I2C] scanning...");

    int found = 0;
    for (uint8_t addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        uint8_t error = Wire.endTransmission();

        if (error == 0) {
            Serial.printf("[I2C] found 0x%02X\n", addr);
            found++;
        }
    }

    if (found == 0) {
        Serial.println("[I2C] no devices found - เช็คสาย SDA/SCL/VCC/GND");
    } else if (found == 1) {
        Serial.println("[I2C] เจอแค่ 1 ตัว - เช็คว่าบัดกรีจุด A0 ของตัวที่ 2 แล้วหรือยัง");
    }

    Serial.println("[I2C] scan complete");
}

void loop() {}
