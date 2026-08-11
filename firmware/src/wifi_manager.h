#pragma once

// เชื่อมต่อ Wi-Fi ตาม SSID/PASSWORD ใน config.h
// บล็อกรอจนกว่าจะต่อติด (มี timeout + พิมพ์สถานะทาง Serial)
void wifi_connect();

// เช็คว่ายังเชื่อมต่ออยู่ไหม เรียกก่อนส่งข้อมูลทุกครั้ง
// ถ้าหลุดจะพยายามเชื่อมต่อใหม่ให้อัตโนมัติ
bool wifi_ensureConnected();
