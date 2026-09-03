#include "sensor.h"
#include "config.h"
#include <Wire.h>

static Adafruit_INA219 ina219_1(INA219_1_ADDRESS);
static Adafruit_INA219 ina219_2(INA219_2_ADDRESS);
static bool sensor1Present = false;
static bool sensor2Present = false;

bool sensor_init() {
    Wire.begin();  // GPIO21=SDA, GPIO22=SCL (default) ใช้ร่วมกันทั้งสองตัว

    sensor1Present = ina219_1.begin();
    sensor2Present = ina219_2.begin();

    if (!sensor1Present) Serial.println("[sensor] INA219 #1 (0x40) not found");
    if (!sensor2Present) Serial.println("[sensor] INA219 #2 (0x41) not found");

    // คืนค่า true ถ้าเจออย่างน้อย 1 ตัว — ไม่ให้ ESP32 ค้าง/crash เพียงเพราะตัวเดียวหลุด
    return sensor1Present || sensor2Present;
}

static SensorReading readOne(Adafruit_INA219 &sensor, const char *sensorId, bool present) {
    SensorReading r;
    r.sensor_id = sensorId;

    if (!present) {
        r.voltage_v = 0;
        r.current_ma = 0;
        r.power_mw = 0;
        r.is_on = false;
        r.ok = false;
        return r;
    }

    r.voltage_v  = sensor.getBusVoltage_V();
    r.current_ma = sensor.getCurrent_mA();
    r.power_mw   = sensor.getPower_mW();
    r.is_on      = fabs(r.current_ma) > CURRENT_THRESHOLD_MA;
    r.ok         = true;
    return r;
}

SensorReading readSensor1() {
    return readOne(ina219_1, SENSOR_1_ID, sensor1Present);
}

SensorReading readSensor2() {
    return readOne(ina219_2, SENSOR_2_ID, sensor2Present);
}
