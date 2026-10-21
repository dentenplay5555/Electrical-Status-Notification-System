#include "sensor.h"
#include "config.h"
#include <Wire.h>
static Adafruit_INA219 ina219_1(INA219_1_ADDRESS);
static Adafruit_INA219 ina219_2(INA219_2_ADDRESS);
static bool sensor1Present = false;
static bool sensor2Present = false;
// เก็บสถานะก่อนหน้าแยกต่อช่อง — จำเป็นสำหรับ hysteresis
static bool lastIsOn1 = false;
static bool lastIsOn2 = false;
bool sensor_init() {
    Wire.begin();
    sensor1Present = ina219_1.begin();
    sensor2Present = ina219_2.begin();
    if (!sensor1Present) Serial.println("[sensor] INA219 #1 (0x40) not found");
    if (!sensor2Present) Serial.println("[sensor] INA219 #2 (0x41) not found");
    // ไม่ halt แม้เจอแค่ตัวเดียว — sensor หนึ่งตัวเสียไม่ควรทำให้ทั้งระบบหยุด
    return sensor1Present || sensor2Present;
}
static bool applyHysteresis(float current_ma, bool previousIsOn) {
    float absCurrent = fabs(current_ma);
    if (absCurrent > CURRENT_ON_THRESHOLD_MA) return true;
    if (absCurrent < CURRENT_OFF_THRESHOLD_MA) return false;
    return previousIsOn; // โซนกำกวม — คงสถานะเดิม
}
static SensorReading readOne(Adafruit_INA219 &sensor, const char *sensorId, bool present, bool &lastIsOn) {
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
    r.is_on      = applyHysteresis(r.current_ma, lastIsOn);
    r.ok         = true;
    lastIsOn = r.is_on;
    return r;
}
SensorReading readSensor1() {
    return readOne(ina219_1, SENSOR_1_ID, sensor1Present, lastIsOn1);
}
SensorReading readSensor2() {
    return readOne(ina219_2, SENSOR_2_ID, sensor2Present, lastIsOn2);
}
