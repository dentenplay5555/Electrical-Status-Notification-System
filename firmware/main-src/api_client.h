#pragma once
#include "sensor.h"
// ส่งข้อมูลเซนเซอร์พร้อม sequence_number และ boot_id สำหรับ replay protection และ session tracking
// มี retry + exponential backoff ในตัว (ดู config.h)
bool api_sendReadings(const SensorReading &reading1, const SensorReading &reading2, uint32_t sequenceNumber, const char *bootId = nullptr);