#pragma once
// ----- Wi-Fi -----
// คัดลอกไฟล์นี้เป็น config.h แล้วใส่ค่าจริงของท่าน
// DO NOT commit config.h — ถูก ignore ใน .gitignore แล้ว
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// ----- Backend (Cloudflare Worker) -----
#define API_ENDPOINT "https://<your-worker>.workers.dev/update"
#define DEVICE_ID "ESP32-01"

// ----- Sensors -----
// ต้องบัดกรีจุด A0 บนโมดูลตัวที่ 2 เท่านั้น (ตัวแรกปล่อย default)
#define INA219_1_ADDRESS 0x40
#define INA219_2_ADDRESS 0x41
#define SENSOR_1_ID "INA219-01"
#define SENSOR_2_ID "INA219-02"

// ----- Timing -----
#define HEARTBEAT_INTERVAL_MS 10000 // upload ทุก 10 วิ

// ----- Threshold (hysteresis 2 ขอบ กัน state กระพริบ) -----
// ค่าประมาณเริ่มต้น — ต้องวัดจริงกับโหลดจริงแล้วปรับค่านี้
#define CURRENT_ON_THRESHOLD_MA 25.0
#define CURRENT_OFF_THRESHOLD_MA 15.0
