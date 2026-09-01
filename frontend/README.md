# frontend/ — เว็บไซต์แสดงสถานะ

ดึงสถานะล่าสุดจาก `backend/` มาแสดงผลแบบเรียลไทม์ (poll ทุก 5 วินาที) แสดง `N/A` เมื่อ ESP32 หลุดการเชื่อมต่อเกิน 30 วินาที (ดูภาพรวมทั้งระบบที่ [README หลัก](../README.md))

## โครงสร้าง

```
frontend/
├── index.html
├── style.css
└── script.js     # ต้องตั้งค่า API_URL ตรงนี้
```

## Setup

1. แก้ `API_URL` ใน `script.js` ให้ตรงกับ URL ของ `backend/` ที่ deploy เรียบร้อยแล้ว:

```js
const API_URL = "https://worker-name-example.workers.dev";
```

2. สามารถ Deploy ผ่าน GitHub Pages ได้เลย (เป็นวิธีที่ใช้อยู่ในโปรเจกต์นี้):
   - ตั้งค่าใน repo **Settings → Pages → Source: GitHub Actions**
   - Push ที่แก้ไฟล์ในโฟลเดอร์นี้จะ trigger deploy อัตโนมัติผ่าน `.github/workflows/deploy-pages.yml`
   - URL ที่ได้: `https://<username>.github.io/<repo-name>/`

หรือ deploy ผ่าน Cloudflare Pages แทนก็ได้:
```bash
cd frontend
npx wrangler pages deploy .
```

## ⚠️ ข้อควรระวังเฉพาะส่วนนี้ (frontend)

- ตอนนี้ยังไม่ได้ตั้ง custom domain ใช้ `github.io` แบบ default ไปก่อน
- หน้าเว็บเป็น static file ล้วน **ต้องเรียก API จาก `backend/` เสมอ** ไม่มี logic ประมวลผลฝั่งเว็บเอง
