#pragma once
#include "sensor.h"

// ส่ง reading ของ sensor ทั้ง 2 ตัวไปพร้อมกันเป็น 1 request
// รูปแบบ JSON: { "device_id": "...", "sensors": [ {...}, {...} ] }
bool api_sendReadings(const SensorReading &reading1, const SensorReading &reading2);
