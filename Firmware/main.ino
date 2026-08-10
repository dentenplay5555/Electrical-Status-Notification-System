#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>
#include "API.h"

// === Pin Assignment ===
#define PIN_TV        34
#define PIN_AUDIO     35
#define PIN_PC        32
#define PIN_UPS       33
#define PIN_CUTOUT    25

// === SCT-013 Config ===
#define ADC_RES       4095.0
#define VCC           3.3
#define BURDEN_R      33.0      // burden resistor 33Ω
#define SCT_RATIO     2000.0    // SCT-013-000: 100A/50mA = 2000
#define SAMPLES       1000      // จำนวน sample สำหรับ RMS
#define CURRENT_THRESHOLD 0.3   // แอมป์ขั้นต่ำที่ถือว่า "เปิด"

struct Device {
  const char* name;
  int pin;
  int alertMin;
  int duration;
  bool on;
  bool alerted;
};

Device devices[] = {
  { "TV",              PIN_TV,    120, 0, false, false },
  { "Audio Interface", PIN_AUDIO, 0,   0, false, false },
  { "PC",              PIN_PC,    0,   0, false, false },
  { "UPS",             PIN_UPS,   0,   0, false, false },
};

const int NUM_DEVICES = sizeof(devices) / sizeof(devices[0]);
bool cutAlerted = false;

// === Line Notify ===
void lineNotify(String message) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin("https://notify-api.line.me/api/notify");
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  http.addHeader("Authorization", "Bearer " + String(LINE_TOKEN));
  int code = http.POST("message=" + message);
  Serial.println("Line: " + String(code));
  http.end();
}

// === อ่านค่า RMS จาก SCT-013 ===
float readCurrentRMS(int pin) {
  float sumSq = 0;
  float midpoint = VCC / 2.0;

  for (int i = 0; i < SAMPLES; i++) {
    float raw = analogRead(pin);
    float voltage = (raw / ADC_RES) * VCC;
    float delta = voltage - midpoint;
    sumSq += delta * delta;
    delayMicroseconds(100);
  }

  float vrms = sqrt(sumSq / SAMPLES);
  float irms = (vrms / BURDEN_R) * SCT_RATIO;
  return irms;
}

// === Setup ===
void setup() {
  Serial.begin(115200);
  pinMode(PIN_CUTOUT, INPUT_PULLUP);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi: " + WiFi.localIP().toString());
  lineNotify("\n✅ Smart Room Monitor เริ่มทำงานแล้ว");
}

// === Loop ===
unsigned long lastTick = 0;

void loop() {
  // --- Cut Out ตรวจทันที ---
  bool cutTripped = digitalRead(PIN_CUTOUT) == LOW;
  if (cutTripped && !cutAlerted) {
    cutAlerted = true;
    lineNotify("\n🚨 Cut Out ตัดไฟ! ตรวจสอบวงจรด่วน!");
  } else if (!cutTripped && cutAlerted) {
    cutAlerted = false;
    lineNotify("\n✅ Cut Out กลับมาปกติแล้ว");
  }

  // --- tick ทุก 1 นาที ---
  if (millis() - lastTick < 60000) return;
  lastTick = millis();

  for (int i = 0; i < NUM_DEVICES; i++) {
    Device& d = devices[i];
    float current = readCurrentRMS(d.pin);
    bool on = current > CURRENT_THRESHOLD;

    Serial.printf("%s: %.3fA — %s\n", d.name, current, on ? "ON" : "OFF");

    // สถานะเปลี่ยน
    if (on != d.on) {
      if (on) {
        lineNotify("\n🟢 " + String(d.name) + " เปิดใช้งานแล้ว");
      } else {
        lineNotify("\n⚫ " + String(d.name) + " ปิดแล้ว (ใช้งาน " + String(d.duration) + " นาที)");
        d.duration = 0;
        d.alerted = false;
      }
      d.on = on;
    }

    // นับเวลา + alert
    if (d.on) {
      d.duration++;
      if (d.alertMin > 0 && d.duration >= d.alertMin && !d.alerted) {
        d.alerted = true;
        lineNotify("\n⚠️ " + String(d.name) + " เปิดค้างไว้ " + String(d.duration) + " นาทีแล้ว!");
      }
    }
  }
}