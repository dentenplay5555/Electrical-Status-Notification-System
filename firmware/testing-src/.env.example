#pragma once

// ----- Wi-Fi -----
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// ----- Backend (Cloudflare Worker) -----
#define API_ENDPOINT "https://appliance-notifier-backend.benten012555.workers.dev/update"
#define DEVICE_ID "ESP32-01"

// ----- Sensors -----
// ต้องบัดกรีจุด A0 บนโมดูลตัวที่ 2 เท่านั้น (ตัวแรกปล่อย default)
#define INA219_1_ADDRESS 0x40
#define INA219_2_ADDRESS 0x41
#define SENSOR_1_ID "INA219-01"
#define SENSOR_2_ID "INA219-02"

// ----- Timing -----
#define HEARTBEAT_INTERVAL_MS 10000   // upload ทุก 10 วิ (ตรงกับ README/spec)

// ----- Threshold (hysteresis 2 ขอบ กัน state กระพริบ) -----
// ค่าประมาณเริ่มต้น — priority 5 ต้องวัดจริงกับโหลดจริงแล้วปรับค่านี้
#define CURRENT_ON_THRESHOLD_MA 25.0
#define CURRENT_OFF_THRESHOLD_MA 15.0
