# Appliance Status Notifier (ระบบแจ้งเตือนสถานะอุปกรณ์ไฟฟ้า)

ระบบแจ้งเตือนสถานะอุปกรณ์ไฟฟ้าโดยทีเวลาใกล้เคียง 0 ms -> 50 ms ด้วย ESP32 ร่วมด้วย INA219 ส่งข้อมูลผ่าน Cloudflare Worker นำไปแสดงสถานะบนเว็บไซต์ และแจ้งเตือนสรุปประจำวันผ่าน LINE Messaging API ผ่าน LOA(Line Offical Account) เวลา 16:10 น. โดยมีจุดประสงค์เป็นแนวทางการพัฒนาและต่อยอดเพิ่มขึ้นได้เรื่อยๆ ในด้านที่ท่านต้องการ

**โครงงานการศึกษาค้นคว้าอิสระ (IS) <br>ภายในโรงเรียนนครสวรรค์ อำเภอเมืองนครสวรรค์ จังหวัดนครสวรรค์ ชั้นมัธยมศึกษาปีที่ 3**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-ESP32-informational)
![Build](https://img.shields.io/badge/build-passing-brightgreen)

---

## สารบัญ

- [ภาพรวมระบบ](#ภาพรวมระบบ)
- [สถาปัตยกรรม](#สถาปัตยกรรม)
- [คุณสมบัติ](#คุณสมบัติ)
- [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์)
- [ฮาร์ดแวร์ที่ใช้](#ฮาร์ดแวร์ที่ใช้)
- [เริ่มต้นใช้งาน](#เริ่มต้นใช้งาน)
  - [1. Firmware (ESP32)](#1-firmware-esp32)
  - [2. Backend (Cloudflare Worker)](#2-backend-cloudflare-worker)
  - [3. Frontend (เว็บแสดงสถานะ)](#3-frontend-เว็บแสดงสถานะ)
- [API Endpoints](#api-endpoints)
- [ผู้จัดทำ](#ผู้จัดทำ)
- [License](#license)

---

## ภาพรวมระบบ

ระบบนี้ตรวจจับสถานะเปิด/ปิดของอุปกรณ์ไฟฟ้า DC (3-9V) โดยวัดกระแสไฟฟ้าผ่านเซนเซอร์ INA219 ประมวลผลด้วย ESP32 แล้วส่งข้อมูลไปเก็บและแสดงผลผ่าน Cloudflare Worker แบบเรียลไทม์ พร้อมสรุปแจ้งเตือนผ่าน Line Offical Account(LOA) ทุกวันเวลา 16:10 น.

## สถาปัตยกรรม หรือ หลักการทำงาน

```mermaid
flowchart LR
    A[ESP32 DevKit] -->|POST ทุก 10-15s| B[Cloudflare Worker<br/>/update]
    B --> C[(KV + D1<br/>สถานะล่าสุด + log)]
    C --> D[Website<br/>N/A ถ้าเกิน 30s]
    C --> E[Cron Trigger<br/>09:10 UTC = 16:10 น.]
    E --> F[LINE Messaging API<br/>ส่งสรุปประจำวัน]
```

## คุณสมบัติ

- ตรวจจับสถานะเปิด/ปิดอุปกรณ์ไฟฟ้า ได้ทุกที่ ทุกเวลา
- วัดกระแส/แรงดัน/กำลังไฟฟ้าผ่าน INA219
- แสดงผลผ่านเว็บไซต์ พร้อมสถานะ `N/A` เมื่อ ESP32 หลุดการเชื่อมต่อ
- แจ้งเตือนสรุปประจำวันผ่าน LINE Messaging API เวลา 16:10 น.
- บันทึกประวัติการใช้งานย้อนหลังผ่าน Cloudflare D1

## โครงสร้างโปรเจกต์

```
appliance-notifier/
├── firmware/       # Source code ESP32 (PlatformIO)
├── backend/        # Cloudflare Worker (Server กลาง)
├── frontend/       # เว็บไซต์แสดงสถานะ
├── hardware/       # ไฟล์ KiCad (expansion-board)
└── docs/           # เอกสารประกอบ + เล่มรายงาน IS
```

## ฮาร์ดแวร์ที่ใช้ (Requirement)

| ชิ้นส่วน | รายละเอียด |
|---|---|
| ESP32 DevKit | ไมโครคอนโทรลเลอร์หลัก |
| INA219 | เซนเซอร์วัดกระแส/แรงดัน/กำลังไฟฟ้า (I2C) |
| Expansion Board | บอร์ดเชื่อมต่อเซนเซอร์ + LED + สวิตช์เลือกแรงดัน |

## วิธีการเริ่มต้นใช้งาน
**มีความจำเป็นที่จะต้องติดตั้ง Platform IO CLI, Node.js และ LOA จึงมีสืทธิใช้ Line Messaging Api ได้โดยมี Limit push/pull คือ 300 ครั้ง**
**ข้อควรระวังสำหรัับผู้ใช้ Linux การ upload code ผ่าน USB อาจเจอ error "access denied" ได้ ควรอนุญาติผ่าน serial ของ port ที่ท่านมีความประสงค์ใช้ การอนุญาติสามารถมี command ได้มากจากการมี distro แตกต่างกันจึงไม่สามารถแนะนำได้**

### 1. Firmware (ESP32)

```bash
cd firmware
pio run --target compiledb   # สร้าง compile_commands.json สำหรับ LSP
pio run --target upload      # อัปโหลดโค้ดขึ้นบอร์ด
pio device monitor           # ดู Serial Monitor (Log)
```

สามารถตั้งค่า Wi-Fi และ URL ของ Worker ในไฟล์ `firmware/src/config.h` โดยมีตัวอย่างภายใน File
**ไม่สามาถใช้ WiFi ชนิด login ใน website**<br>
**ใน .env.example ท่านควรนำไปเป็นตัวอย่างในการปรับแต่ง config.h ใน project ของท่าน**

```cpp
#define WIFI_SSID "WIFI NAME"
#define WIFI_PASSWORD "WIFI PASS"
#define API_ENDPOINT "URL"
```

### 2. Backend (Cloudflare Worker)

```bash
cd backend
npm install
npx wrangler d1 create appliance-db     # สร้าง Data base D1 ครั้งแรก
npx wrangler d1 execute appliance-db --file=./schema.sql
npx wrangler secret put LINE_ACCESS_TOKEN
npx wrangler deploy
```

### 3. Frontend (เว็บแสดงสถานะ)

```bash
cd frontend
# แก้ API_URL ใน script.js ให้ตรงกับ Worker ของท่านที่ deploy แล้ว
npx wrangler pages deploy .
```

## API Endpoints 

| Method | Endpoint | คำอธิบาย |
|---|---|---|
| `POST` | `/update` | ESP32 ส่งค่าสถานะ/กระแส/กำลังไฟฟ้า |
| `GET` | `/status` | เว็บไซต์ดึงสถานะล่าสุดมาแสดงผล |
| `GET` | `/health` | ตรวจสอบว่า Worker ทำงานปกติ |

## คณะจัดทำ
- ชื่อ-นามสกุลผู้จัดทำ
   1.ด.ช.กฤตภาส ใจใหญ่ เลขที่ 1 ม.3/1<br>
   2.ด.ช.กิตติศักดิ์ วงษา เลขที่ 4 ม.3/1<br>
   3.ด.ช.ปกรณ์เกียรติ แหวนแก้ว เลขที่ 15 ม.3/1<br>
   4.ด.ช.วรัญชัย พุทธวงค์ เลขที่ 19 ม.3/1<br>
   5.ด.ช.วิชญะ เสาไธสง เลขที่ 20 ม.3/1<br>
   6.ด.ช.อชิระ ลิ้มสุวรรณ เลขที่ 21 ม.3/1<br>
   
- ครูที่ปรึกษา
   1.ครูศิรประภา ปิ่นเทศ<br>
   2.ครูสุพรรณี อภิชัยเอนก<br>
   3.ครูธันยาณัฐ รังสิยานนท์<br>
   
**โครงงานการศึกษาค้นคว้าอิสระ (Independent Study(IS)) ประจำภาคเรียนที่ 1 ปีการศึกษา 2569 <br>โรงเรียนนครสวรรค์ อำเภอเมืองนครสวรรค์ จังหวัดนครสวรรค์**

## License

โครงงานนี้เผยแพร่ภายใต้สัญญาอนุญาต [MIT License](LICENSE)
