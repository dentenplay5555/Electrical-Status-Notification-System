# frontend/ — เว็บไซต์แสดงสถานะ

ดึงสถานะล่าสุดจาก `backend/` มาแสดงผลแบบเรียลไทม์ (poll ทุก 5 วินาที) แสดง `N/A` เมื่อ ESP32 หลุดการเชื่อมต่อเกิน 30 วินาที (ดูภาพรวมทั้งระบบที่ [README หลัก](../README.md))

## โครงสร้าง

```
frontend/
├── index.html
├── style.css
└── script.js     # ต้องตั้งค่า API_URL ตรงนี้
```

## คุณสมบัติและการแสดงผล
- **เรียลไทม์ & ไม่กระตุก (Flicker-Free)**: ทำ DOM Element Recycling อัปเดตเฉพาะค่าตัวเลขและกราฟแถบพลังงานโดยไม่ล้างหน้าจอซ้ำ
- **ระบบเตือนสถานะ N/A**: หาก ESP32 ขาดการส่งข้อมูลเกิน 30 วินาที หน้าจอจะแสดงสถานะ `N/A (ไม่ทราบสถานะ)` พร้อมกล่องแจ้งเตือนทันที
- **ตัวบ่งชี้การเชื่อมต่อ**: แสดงสถานะ Online (เขียว), Offline/Stale (แดง), และ Connecting (ฟ้า) พร้อมแถบนับถอยหลัง Polling 5s ด้านบน
- **ภาพรวมพลังงาน (Metrics Strip)**: แสดงผลรวมกำลังไฟฟ้ารวม (mW / W), กระแสรวม (mA), และจำนวนช่องที่กำลังเปิดใช้งาน
- **Dark / Light Theme**: สลับโหมดการแสดงผลได้ที่มุมขวาบน และบันทึกค่าไว้ใน `localStorage`
- **ตั้งค่าผ่านหน้าเว็บ (Settings Modal)**: สามารถเปลี่ยน `API_URL` หรือ `Device ID` ผ่านปุ่มฟันเฟืองได้โดยตรงโดยไม่ต้องแก้โค้ด

## Setup
1. สามารถแก้ไข `DEFAULT_CONFIG` ใน [script.js](file:///home/dentenplay5555/Desktop/Structure/frontend/script.js) ให้ตรงกับ Worker URL ของท่าน หรือตั้งค่าผ่านปุ่ม Settings ในหน้าเว็บได้ทันที:
```js
const DEFAULT_CONFIG = {
    apiUrl: "https://your-worker.workers.dev",
    deviceId: "ESP32-01",
    pollIntervalMs: 5000,
};
```

2. ทดสอบหรือ Deploy ขึ้น Cloudflare Pages:
```bash
cd frontend
npx wrangler pages deploy .
```

## ข้อควรระวังเฉพาะส่วนนี้ (frontend)
- หน้าเว็บเป็น Single Page Application แบบ Static Files สามารถ Deploy บน Cloudflare Pages, GitHub Pages หรือ Web Server ใดก็ได้
- ต้องเรียกข้อมูลผ่าน API จาก `backend/` ซึ่งรองรับ CORS แล้วเรียบร้อย

