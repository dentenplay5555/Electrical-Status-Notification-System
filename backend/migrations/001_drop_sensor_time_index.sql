-- ลดจำนวนแถวที่ D1 ต้องเขียนต่อ 1 reading (ดัชนีนี้ไม่มี query ไหนใช้)
-- รันกับฐานข้อมูลจริง: npm run db:migrate:remote
DROP INDEX IF EXISTS idx_readings_sensor_time;
