#include "sensor_dual.h"
#include <Wire.h>

// ประกาศ object สองตัว พร้อมระบุ address ให้ตรงกับที่บัดกรีจริงบนโมดูล
Adafruit_INA219 ina219_ch1(0x40);
Adafruit_INA219 ina219_ch2(0x41);

bool sensor_init() {
    Wire.begin();  // GPIO21=SDA, GPIO22=SCL (default) ใช้ร่วมกันทั้งสองตัว

    bool ok1 = ina219_ch1.begin();
    bool ok2 = ina219_ch2.begin();

    if (!ok1) Serial.println("[sensor] ไม่พบ INA219 ที่ 0x40 (ช่อง 1)");
    if (!ok2) Serial.println("[sensor] ไม่พบ INA219 ที่ 0x41 (ช่อง 2)");

    return ok1 && ok2;
}

SensorReading sensor_read(Adafruit_INA219 &sensor) {
    SensorReading reading;
    reading.busVoltage_V = sensor.getBusVoltage_V();
    reading.current_mA   = sensor.getCurrent_mA();
    reading.power_mW     = sensor.getPower_mW();
    return reading;
}

// ตัวอย่างการเรียกใช้ใน main.cpp:
//
//   SensorReading r1 = sensor_read(ina219_ch1);
//   SensorReading r2 = sensor_read(ina219_ch2);
//   Serial.printf("ช่อง1: %.1f mA | ช่อง2: %.1f mA\n", r1.current_mA, r2.current_mA);
