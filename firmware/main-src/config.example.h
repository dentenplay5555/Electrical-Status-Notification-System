#pragma once
// ----- Wi-Fi -----
// คัดลอกไฟล์นี้เป็น config.h แล้วใส่ค่าจริงของท่าน
// DO NOT commit config.h — ถูก ignore ใน .gitignore แล้ว ไม่มันใจ เอา gitignore ignore gitignore แล้ว ignore gitignore ignoring config.h;
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// ----- Backend (Cloudflare Worker) -----
#define API_ENDPOINT "https://<your-worker>.workers.dev/update"
#define DEVICE_ID "ESP32-01"
#define DEVICE_TOKEN "your_secret_device_token"  // ต้องตรงกับ secret บน Worker (bash -> wrangler secret put DEVICE_TOKEN)

// ----- Sensors -----
// ต้องบัดกรีจุด A0 บนโมดูลตัวที่ 2 เท่านั้น (ตัวแรกปล่อย เพราะเป็น default)
#define INA219_1_ADDRESS 0x40
#define INA219_2_ADDRESS 0x41
#define SENSOR_1_ID "INA219-01"
#define SENSOR_2_ID "INA219-02"

// ----- Timing -----
#define HEARTBEAT_INTERVAL_MS 10000 // upload ทุก 10 วิ parameter หน่วย ms;

// ----- Retry & Backoff -----
// Exponential backoff: 1s → 2s → 4s (cap ที่ 4s เพราะ heartbeat 10s)
#define API_MAX_RETRIES       3       // จำนวนครั้งสูงสุดที่พยายามส่งซ้ำก่อน give up
#define API_INITIAL_BACKOFF_MS 1000   // delay เริ่มต้นหลัง retry ครั้งแรก
#define API_MAX_BACKOFF_MS    4000    // delay สูงสุด (ไม่เกิน heartbeat/2)
#define FAST_RETRY_INTERVAL_MS 2000   // ถ้ารอบก่อนส่งไม่สำเร็จ ลองส่งใหม่ทุก 2 วินาที (ไม่ต้องรอครบ 10 วินาที)
#define OFFLINE_BUFFER_CAPACITY 20    // เก็บข้อมูลล่าสุดสูงสุด 20 ชุด (~3-5 นาที) เมื่อ WiFi หลุดหรือ D1 ขัดข้อง

// ----- Threshold (hysteresis 2 ขอบ กัน state กระพริบ) -----
// ค่าประมาณเริ่มต้น — ต้องวัดจริงกับโหลดจริงแล้วปรับค่านี้ หน่วย mili amp;
#define CURRENT_ON_THRESHOLD_MA 25.0
#define CURRENT_OFF_THRESHOLD_MA 15.0

