#include <Arduino.h>
#include "config.h"
#include "sensor.h"
#include "wifi_manager.h"
#include "api_client.h"

static bool lastIsOn1 = false;
static bool lastIsOn2 = false;
static unsigned long lastSendMs = 0;
static bool hasPendingStatusChange = false;
static bool lastSendFailed = false;

// ----- Replay Protection: Monotonic Sequence Number & Boot Session ID -----
static uint32_t sequenceNumber = 0;
static char bootId[17] = {0};

static void initBootId() {
    uint32_t r1 = esp_random();
    uint32_t r2 = esp_random();
    snprintf(bootId, sizeof(bootId), "%08X%08X", r1, r2);
    Serial.printf("[boot] เริ่มต้นระบบ Session boot_id: %s\n", bootId);
}

// ----- Offline Ring Buffer: ป้องกันข้อมูลหายเมื่อ WiFi หลุด หรือ D1 ขัดข้อง -----
struct BufferedReading {
    SensorReading r1;
    SensorReading r2;
    uint32_t seq;
};

static BufferedReading offlineBuffer[OFFLINE_BUFFER_CAPACITY];
static int bufferHead = 0;
static int bufferCount = 0;

static void bufferPush(const SensorReading &r1, const SensorReading &r2, uint32_t seq) {
    if (bufferCount >= OFFLINE_BUFFER_CAPACITY) {
        // Buffer เต็ม: เลื่อน head ทิ้งข้อมูลเก่าสุด เพื่อเก็บข้อมูลล่าสุดไว้
        bufferHead = (bufferHead + 1) % OFFLINE_BUFFER_CAPACITY;
        bufferCount--;
        Serial.println("[buffer] Offline buffer เต็ม: ตัดชุดข้อมูลเก่าสุดทิ้ง");
    }
    int tail = (bufferHead + bufferCount) % OFFLINE_BUFFER_CAPACITY;
    offlineBuffer[tail] = {r1, r2, seq};
    bufferCount++;
    Serial.printf("[buffer] บันทึกลง Offline Buffer แล้ว (ค้างอยู่: %d ชุด, seq=%lu)\n", bufferCount, (unsigned long)seq);
}

// ระบายข้อมูลที่ตกค้างใน Offline Buffer ส่งไปยัง Cloudflare D1
// ระบายตามลำดับ FIFO ก่อนส่งข้อมูลสดรอบปัจจุบัน เพื่อรักษา monotonic sequence
static bool drainOfflineBuffer() {
    int flushed = 0;
    while (bufferCount > 0 && flushed < 5) { // ทยอยส่งรอบละไม่เกิน 5 ชุด
        BufferedReading &item = offlineBuffer[bufferHead];

        Serial.printf("[recovery] กำลังส่งข้อมูลย้อนหลังจาก Offline Buffer (seq=%lu)...\n", (unsigned long)item.seq);
        bool ok = api_sendReadings(item.r1, item.r2, item.seq, bootId);
        if (!ok) {
            Serial.println("[recovery] ส่งย้อนหลังไม่สำเร็จ — พักการระบาย buffer ไว้ก่อน");
            return false; // ไม่เลื่อน head เพื่อให้ข้อมูลชุดเดิมคงอยู่ที่หัวคิว
        }

        // เลื่อน head เมื่อส่งสำเร็จแล้วเท่านั้น
        bufferHead = (bufferHead + 1) % OFFLINE_BUFFER_CAPACITY;
        bufferCount--;
        flushed++;
        delay(150); // เว้นระยะเล็กน้อยระหว่างชุดย้อนหลัง
    }
    if (flushed > 0) {
        Serial.printf("[recovery] ระบายข้อมูลย้อนหลังสำเร็จ %d ชุด (เหลือค้าง: %d ชุด)\n", flushed, bufferCount);
    }
    return (bufferCount == 0);
}

void setup() {
    Serial.begin(115200);
    delay(500);
    initBootId();
    // ไม่ใช้ if(!sensor_init()) { while(true); } — ต้องทำงานต่อแม้เซนเซอร์ตัวหนึ่งหลุดเสมอ
    sensor_init();
    wifi_connect();
}

void loop() {
    SensorReading r1 = readSensor1();
    SensorReading r2 = readSensor2();

    bool statusChanged = (r1.is_on != lastIsOn1) || (r2.is_on != lastIsOn2);
    if (statusChanged) {
        hasPendingStatusChange = true;
    }

    // กำหนดรอบการส่ง:
    // 1) มีการเปลี่ยนสถานะ (statusChanged หรือ hasPendingStatusChange)
    // 2) ถ้าส่งรอบก่อนล้มเหลว ให้ใช้ FAST_RETRY_INTERVAL_MS (2s)
    // 3) ถ้ารอบปกติ ให้ใช้ HEARTBEAT_INTERVAL_MS (10s)
    unsigned long interval = (lastSendFailed || hasPendingStatusChange)
                             ? FAST_RETRY_INTERVAL_MS
                             : HEARTBEAT_INTERVAL_MS;

    bool timeDue = (millis() - lastSendMs >= interval);

    if (hasPendingStatusChange || timeDue) {
        if (wifi_ensureConnected()) {
            // 1. ระบายข้อมูลตกค้างใน offline buffer ให้หมดก่อนส่งข้อมูลสดรอบปัจจุบัน
            // ป้องกันข้อมูลย้อนหลังถูก reject จาก Replay Protection
            if (bufferCount > 0) {
                bool drained = drainOfflineBuffer();
                if (!drained) {
                    // หากยังระบายไม่หมด (ส่งไม่ผ่าน) ให้ข้ามรอบนี้ก่อนเพื่อรักษาลำดับ sequence
                    lastSendFailed = true;
                    lastSendMs = millis();
                    delay(500);
                    return;
                }
            }

            // 2. ส่งข้อมูลสดรอบปัจจุบัน
            sequenceNumber++;  // เพิ่มก่อนส่งเสมอ — ห้ามส่ง seq ซ้ำ
            bool sent = api_sendReadings(r1, r2, sequenceNumber, bootId);

            if (sent) {
                // ส่งสำเร็จ: อัพเดตสถานะและเวลาล่าสุด
                lastIsOn1 = r1.is_on;
                lastIsOn2 = r2.is_on;
                hasPendingStatusChange = false;
                lastSendFailed = false;
                lastSendMs = millis();
            } else {
                // ส่งไม่สำเร็จ:
                // 1) ไม่ overwrite lastIsOn เพื่อให้สถานะเปลี่ยนค้างอยู่
                // 2) เก็บชุดข้อมูลนี้เข้า Offline Buffer ป้องกันข้อมูลหาย
                // 3) ตั้ง flag เพื่อ retry แบบรวดเร็วใน 2 วินาทีถัดไป
                Serial.println("[retry] ส่งข้อมูลไม่สำเร็จ — บันทึกเข้า Buffer และเตรียม Fast Retry");
                bufferPush(r1, r2, sequenceNumber);
                lastSendFailed = true;
                lastSendMs = millis();
            }
        } else {
            // ไม่มี WiFi: เก็บเข้า buffer ไว้รอจนต่อติด
            Serial.println("[offline] WiFi ยังไม่เชื่อมต่อ — บันทึกเข้า Offline Buffer");
            sequenceNumber++;
            bufferPush(r1, r2, sequenceNumber);
            lastSendFailed = true;
            lastSendMs = millis();
        }
    }

    Serial.printf("INA219 #1 %s (%.1f mA, %s) | INA219 #2 %s (%.1f mA, %s) | Buffer: %d\n",
                  r1.ok ? "OK" : "ERROR", r1.current_ma, r1.is_on ? "ON" : "OFF",
                  r2.ok ? "OK" : "ERROR", r2.current_ma, r2.is_on ? "ON" : "OFF",
                  bufferCount);
    delay(1000);  // sensor sampling ทุก 1 วิ (ตรงกับ README/spec)
}
