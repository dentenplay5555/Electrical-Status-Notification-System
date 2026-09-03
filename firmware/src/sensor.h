#pragma once
#include <Adafruit_INA219.h>

struct SensorReading {
    const char *sensor_id;
    float voltage_v;
    float current_ma;
    float power_mw;
    bool is_on;
    bool ok;   // false ถ้าอ่านค่าจากเซนเซอร์ตัวนี้ไม่ได้ (หลุด/ต่อผิด)
};

// เรียกครั้งเดียวใน setup() — คืนค่า true ถ้าเจอครบทั้ง 2 ตัว
// (ถ้าตัวใดตัวหนึ่งหาย ยัง init สำเร็จได้ แค่ readSensorX() ตัวนั้นจะ ok=false)
bool sensor_init();

SensorReading readSensor1();
SensorReading readSensor2();
