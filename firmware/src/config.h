#pragma once

// ----- Wi-Fi -----
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// ----- Backend (Cloudflare Worker) -----
#define API_ENDPOINT "https://your-worker.workers.dev/update"
#define DEVICE_ID "ESP32-01"          // อุปกรณ์ ESP32 ตัวนี้ (ไม่ใช่ sensor)

// ----- Sensors -----
// ต้องบัดกรีจุด A0 บนโมดูลตัวที่ 2 เพื่อเปลี่ยน address เป็น 0x41
// (ตัวแรกปล่อยเป็นค่า default 0x40 ไม่ต้องแก้อะไร)
#define INA219_1_ADDRESS 0x40
#define INA219_2_ADDRESS 0x41
#define SENSOR_1_ID "INA219-01"
#define SENSOR_2_ID "INA219-02"

// ----- Timing -----
#define HEARTBEAT_INTERVAL_MS 10000    // ส่งค่าทุก 10 วินาที แม้สถานะไม่เปลี่ยน
#define CURRENT_THRESHOLD_MA 20.0      // กระแสมากกว่านี้ถือว่า "เปิด" (mA)
