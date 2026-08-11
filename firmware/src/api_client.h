#pragma once
#include "sensor.h"

// จะคืนค่า true ถ้าเราส่งสำเร็จ (ได้ HTTP Code 2xx กลับมา)
bool api_sendReading(const SensorReading &reading);
