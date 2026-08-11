#include "sensor.h"
#include "config.h"
#include <Wire.h>
#include <Adafruit_INA219.h>

static Adafruit_INA219 ina219(INA219_I2C_ADDRESS);

bool sensor_init() {
    Wire.begin();  // ใช้ขา I2C เริ่มต้นของ ESP32 (SDA=21, SCL=22)
    if (!ina219.begin()) {
        Serial.println("[sensor] ไม่พบโมดูล INA219 - เช็คการต่อสาย I2C");
        return false;
    }
    Serial.println("[sensor] INA219 พร้อมใช้งาน");
    return true;
}

SensorReading sensor_read() {
    SensorReading reading;

    reading.busVoltage_V = ina219.getBusVoltage_V();
    reading.current_mA   = ina219.getCurrent_mA();
    reading.power_mW     = ina219.getPower_mW();

    // ค่ากระแสจาก INA219 อาจแกว่งเป็นลบเล็กน้อยตอนไม่มีโหลด ใช้ค่าสัมบูรณ์
    float currentAbs = fabs(reading.current_mA);
    reading.isOn = currentAbs > STATUS_ON_THRESHOLD_MA;

    return reading;
}
