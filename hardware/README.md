# hardware/ — ไฟล์วงจร/PCB

ไฟล์ KiCad ของ expansion board ที่ออกแบบเอง สำหรับเชื่อมต่อ ESP32 DevKit กับเซนเซอร์ INA219 (ดูภาพรวมทั้งระบบที่ [README หลัก](../README.md))

## โครงสร้าง

```
hardware/
├── Circut.kicad_pro
├── Circut.kicad_sch
└── Circut.kicad_pcb
```

> **หมายเหตุ:** ชื่อไฟล์ `Circut` เป็นชื่อที่ตั้งไว้ตอนสร้างโปรเจกต์ (สะกดผิดจาก "Circuit") — ยังไม่ได้เปลี่ยนเพื่อหลีกเลี่ยง broken reference ใน KiCad

## รายละเอียดวงจร

Expansion board เชื่อมต่อกับ ESP32 DevKit ผ่าน pin header แบบถอดเปลี่ยนได้ ประกอบด้วย:

- จุดเชื่อมต่อเซนเซอร์ INA219 (I2C: SDA/SCL)
- ช่องจ่ายไฟเข้า 3 ทาง (DC Jack, USB Micro-B, USB Type-C) ผ่านไดโอดกันไฟย้อนกลับ (Diode-OR, 1N5819)
- สวิตช์เลือกแรงดันไฟฟ้าขาออก (3.3V หรือ 5V) สำหรับต่อขยายกับอุปกรณ์อื่น
- ไฟแสดงสถานะการทำงาน (Power LED)

## เปิดไฟล์

```bash
kicad hardware/Circut.kicad_pro
```

## ข้อควรระวังเฉพาะส่วนนี้

- **สำหรับผู้ที่ประสงค์ในการผลิต PCB** ก่อนสั่งผลิต PCB ตรวจสอบ footprint และ courtyard ให้ไม่ชนกันก่อนทุกครั้ง (DRC check)
- ไฟล์ backup ของ KiCad (`*-backups/`, `*.kicad_pcb-bak`) และโฟลเดอร์ `.history/` ถูกกันไว้ใน `.gitignore` แล้ว ไม่ต้องกังวลเรื่องไฟล์รกใน repo ได้เลย
