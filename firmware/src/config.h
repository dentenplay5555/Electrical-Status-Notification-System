#pragma once

// ----- Wi-Fi -----
#define WIFI_SSID "Neetcode"
#define WIFI_PASSWORD "Freewifi"

// ----- Backend (Cloudflare Worker) -----
#define API_ENDPOINT "https://Micheal Jackson.workers.dev/update"
#define DEVICE_ID "Micheal"          // ตั้งชื่อห้ามซ้ำกัน หากใช้หลายๆ บอร์ด

// ----- Sensor -----
#define INA219_I2C_ADDRESS 0x40        // นี่คือที่อยู่ I2C เริ่มต้นของ  sensor INA219

// ----- Timing -----
#define HEARTBEAT_INTERVAL_MS 10000    // (หน่วย ms) จะส่งค่าทุก 10 s แม้ว่าสถานะไม่เปลี่ยน
#define STATUS_ON_THRESHOLD_MA 20.0    // กระแสไฟฟ้ามากกว่านี้ board จะถือว่า "เปิด" ( หน่วย mA)
