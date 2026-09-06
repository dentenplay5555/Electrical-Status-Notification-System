# firmware/ — โค้ด ESP32

อ่านค่ากระแส/แรงดัน/กำลังไฟฟ้าจากเซนเซอร์ INA219 แล้วส่งเข้า `backend/` ผ่าน HTTP POST ทุก 10 วินาที (ดูภาพรวมทั้งระบบที่ [README หลัก](../README.md))

## โครงสร้าง

```
firmware/
├── platformio.ini
├── main-src/
|   ├── main.cpp
|   ├── config.h          # ตั้งค่า Wi-Fi/URL ที่นี่ 
|   ├── sensor.cpp/.h      # อ่านค่า INA219
|   ├── wifi_manager.cpp/.h
|   └── api_client.cpp/.h  # ส่งข้อมูลไป backend
└──testing-src
    ├── i2c_scanner.cpp # สำหรับ test I2C address ว่าใช่หรือไม่
    ├── config.h          
    ├── sensor.cpp/.h      
    ├── wifi_manager.cpp/.h
    └── api_client.cpp/.h  
```

## ข้อควรระวังเฉพาะส่วนนี้

- **ไม่รองรับ Wi-Fi แบบ login ผ่านหน้าเว็บ** (captive portal เช่น Wi-Fi มหาวิทยาลัย/ที่สาธารณะ) ต้องใช้ Wi-Fi แบบกรอกรหัสผ่านตรง ๆ (WPA2-Personal) เท่านั้น
- ใน `config.h` มีตัวอย่างค่าที่ต้องกรอกไว้แล้ว — คัดลอกโครงจากตัวอย่างในไฟล์แล้วใส่ค่าจริงของตัวเอง **อย่า commit ไฟล์ที่มีค่าจริงขึ้น GitHub**

```cpp
#define WIFI_SSID "WIFI NAME"
#define WIFI_PASSWORD "WIFI PASS"
#define API_ENDPOINT "URL"
```

## ปัญหาที่เคยเจอ — `ledcAttach` was not declared in this scope

**สาเหตุ**: `platform = espressif32` เฉย ๆ ใน `platformio.ini` ดึง Arduino core เวอร์ชันเก่า (2.x) ที่ยังไม่มีฟังก์ชัน `ledcAttach()` แบบใหม่ (มีแค่ `ledcAttachPin` + `ledcSetup` แบบเก่า)

**วิธีแก้**: เปลี่ยนไปใช้ platform [pioarduino](https://github.com/pioarduino/platform-espressif32) ซึ่งเป็น fork ของชุมชนที่รองรับ Arduino core 3.x เต็มรูปแบบ:

```ini
[env:esp32dev]
platform = https://github.com/pioarduino/platform-espressif32/releases/download/stable/platform-espressif32.zip
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
    adafruit/Adafruit INA219@^1.2.3
```

## วิธีใช้งาน

```bash
cd firmware
pio run --target compiledb   # สร้าง compile_commands.json ให้ LSP (เช่น clangd ใน LazyVim) รู้จัก library
pio run --target upload      # อัปโหลดโค้ดขึ้นบอร์ด
pio device monitor           # ดู Serial Monitor (Log)
```

### Linux — ปัญหา `access denied` ตอนอัปโหลดผ่าน USB

ต้องอนุญาตสิทธิ์เข้าถึง serial port ก่อน คำสั่งต่างกันไปตาม distro ตัวอย่างสำหรับ **Fedora**:

```bash
sudo usermod -a -G dialout $USER
# แล้ว logout/login ใหม่ให้สิทธิ์มีผล
```

ถ้า distro อื่นแล้วคำสั่งนี้ใช้ไม่ได้ ให้เช็ค group ของ serial device ก่อน:

```bash
ls -l /dev/ttyUSB0
# ดูว่า group เป็นอะไร แล้ว usermod -a -G <group นั้น> $USER แทน
```
