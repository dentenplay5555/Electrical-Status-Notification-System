#pragma once
#include <Adafruit_INA219.h>

struct SensorReading {
    const char *sensor_id;
    float voltage_v;
    float current_ma;
    float power_mw;
    bool is_on;
    bool ok;   // false = อ่านค่าจากเซนเซอร์ตัวนี้ไม่ได้ (หลุด/ต่อผิด)
};

bool sensor_init();
SensorReading readSensor1();
SensorReading readSensor2();
