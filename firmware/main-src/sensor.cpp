#include "sensor.h"
#include "config.h"
#include <Wire.h>
static Adafruit_INA219 ina219_1(INA219_1_ADDRESS);
static Adafruit_INA219 ina219_2(INA219_2_ADDRESS);
static bool sensor1Present = false;
static bool sensor2Present = false;
static bool lastIsOn1 = false;
static bool lastIsOn2 = false;

bool sensor_init() {
    Wire.begin();
    Wire.setTimeOut(50); // ป้องกัน I2C bus hang เมื่อสายหลุดหรือสัญญาณขัดข้อง
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

// ตรวจสอบว่ามีชิปตอบรับ ACK บน I2C bus จริง ณ รอบปัจจุบันหรือไม่
static bool isDeviceResponding(uint8_t address) {
    Wire.beginTransmission(address);
    return (Wire.endTransmission() == 0);
}

static SensorReading readOne(Adafruit_INA219 &sensor, const char *sensorId, uint8_t address, bool &lastIsOn) {
    SensorReading r;
    r.sensor_id = sensorId;

    // ตรวจจับสายหลุดแบบ Runtime: หากไม่ได้รับ ACK หรือชิปค้าง ให้รายงาน ok = false ทันที
    if (!isDeviceResponding(address)) {
        r.voltage_v = 0.0f;
        r.current_ma = 0.0f;
        r.power_mw = 0.0f;
        r.is_on = false;
        r.ok = false;
        return r;
    }

    float v = sensor.getBusVoltage_V();
    float i = sensor.getCurrent_mA();
    float p = sensor.getPower_mW();

    // ป้องกันค่า NaN
    if (isnan(v) || isnan(i) || isnan(p)) {
        r.voltage_v = 0.0f;
        r.current_ma = 0.0f;
        r.power_mw = 0.0f;
        r.is_on = false;
        r.ok = false;
        return r;
    }

    r.voltage_v  = v;
    r.current_ma = i;
    r.power_mw   = p;
    r.is_on      = applyHysteresis(r.current_ma, lastIsOn);
    r.ok         = true;
    lastIsOn     = r.is_on;
    return r;
}

SensorReading readSensor1() {
    return readOne(ina219_1, SENSOR_1_ID, INA219_1_ADDRESS, lastIsOn1);
}

SensorReading readSensor2() {
    return readOne(ina219_2, SENSOR_2_ID, INA219_2_ADDRESS, lastIsOn2);
}
