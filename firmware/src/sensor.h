#pragma once

struct SensorReading {
    float busVoltage_V;
    float current_mA;
    float power_mW;
    bool isOn;
};

// เรียกครั้งเดียวใน setup() เพื่อเริ่มต้นเซนเซอร์
// คืนค่า false ถ้าหาโมดูล INA219 ไม่เจอ (ต่อสายผิด/ที่อยู่ I2C ไม่ตรง)
bool sensor_init();

// อ่านค่าปัจจุบันจาก INA219 แล้วตัดสินสถานะเปิด/ปิดตาม threshold ใน config.h
SensorReading sensor_read();
