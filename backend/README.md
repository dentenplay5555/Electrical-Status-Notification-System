# backend/ — Cloudflare Worker

รับข้อมูลจาก `firmware/`, เก็บลง DB(Data Base) KV + D1, ให้ `frontend/` อ่านสถานะล่าสุด และส่งสรุปประจำวันเข้า LINE ผ่าน Cron Trigger (ดูภาพรวมทั้งระบบที่ [README หลัก](../README.md))

## โครงสร้าง

```
backend/
├── wrangler.toml           # config หลัก: bind KV + D1, ตั้ง cron 09:10 UTC
├── schema.sql               # โครงตาราง D1
├── .dev.vars.example         # ชื่อตัวแปร secret (ไม่มีค่าจริง)
└── src/
    ├── index.ts              # entry point: route + cron handler
    ├── types.ts
    ├── routes/                # update.ts, status.ts, health.ts
    └── lib/                   # db.ts, line.ts
```

## ⚠️ ข้อควรระวังเฉพาะส่วนนี้

- **LOA (LINE Official Account) มี Limit push/pull 300 ครั้ง/เดือน** (แผน Free) — ระวังอย่าทดสอบส่งข้อความถี่เกินไปตอน dev เพราะโควตาจะหมดก่อนสิ้นเดือน แนะนำ `console.log` ดูผ่าน `wrangler tail` แทนการยิงข้อความจริงระหว่างเทส
- **`.dev.vars` ต้องอยู่โฟลเดอร์เดียวกับ `wrangler.toml` เท่านั้น** (คือ root ของ `backend/`) ย้ายไปที่อื่นจะหาไม่เจอ
- `database_id` / KV namespace id ใน `wrangler.toml` **ไม่ใช่ความลับ** commit ขึ้น GitHub ได้ปกติ — สิ่งที่ห้าม commit คือ `.dev.vars` (มี token จริง) เท่านั้น

## Setup

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars   # แล้วใส่ค่าจริงใน .dev.vars

npx wrangler d1 create appliance-db     # สร้างฐานข้อมูล D1 ครั้งแรก
npx wrangler d1 execute appliance-db --file=./schema.sql
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler deploy
```

## ทดสอบว่า deploy สำเร็จ

```bash
curl -i https://your-worker.workers.dev/health
```

ควรได้ `{"status":"ok"}` กลับมา

## Cron Trigger — เรื่อง timezone ที่พลาดง่าย

Cloudflare Cron ใช้เวลา **UTC เท่านั้น** ไม่ใช่เวลาไทย ถ้าจะให้ทำงานตอน 16:10 น. เวลาไทย ต้องตั้งเป็น `09:10 UTC` (ไทยเร็วกว่า UTC 7 ชั่วโมง):

```toml
[triggers]
crons = ["10 9 * * *"]  # 09:10 UTC = 16:10 น. เวลาไทย
```

## 🔧 ปัญหาที่เคยเจอ — LINE webhook Verify แล้วขึ้น 404

**สาเหตุที่พบบ่อยสุด**: โค้ดล่าสุดยังไม่ถูก deploy จริง หรือ URL ที่กรอกใน LINE Developers Console ไม่ตรง (ลืม `/webhook` ท้าย URL, มี `/` เกิน, หรือ deploy คนละ Worker ชื่อ)

**วิธีตรวจ**:
```bash
npx wrangler deploy               # deploy ใหม่ให้ชัวร์
curl -i -X POST https://your-worker.workers.dev/webhook \
  -H "Content-Type: application/json" -d '{"events":[]}'
```
ถ้า curl ได้ 200 OK แต่ Verify ใน LINE Console ยัง fail แปลว่า URL ที่กรอกใน Console ผิด ไม่ใช่ปัญหาโค้ด
