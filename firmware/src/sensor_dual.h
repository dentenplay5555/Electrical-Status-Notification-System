#pragma once

#include <Adafruit_INA219.h>

// สร้าง object แยกตามที่อยู่ I2C ของแต่ละตัว
extern Adafruit_INA219 ina219_ch1;  // ที่อยู่ default 0x40
extern Adafruit_INA219 ina219_ch2;  // เปลี่ยนที่อยู่เป็น 0x41 ผ่านจุดบัดกรี A0

struct SensorReading {
    float busVoltage_V;
    float current_mA;
    float power_mW;
};

bool sensor_init();
SensorReading sensor_read(Adafruit_INA219 &sensor);
