#include "wifi_manager.h"
#include "config.h"
#include <WiFi.h>
//wifi connect src file
static unsigned long lastReconnectAttemptMs = 0;
static const unsigned long RECONNECT_INTERVAL_MS = 5000; // ลองเชื่อมต่อใหม่ทุก 5 วิ (ไม่สแปม driver)

void wifi_connect() {
    Serial.printf("[wifi] กำลังเชื่อมต่อ %s", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    unsigned long startAttempt = millis();
    const unsigned long timeoutMs = 8000; // ลดเวลารอตอนบูตเหลือ 8s

    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < timeoutMs) {
        delay(250);
        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[wifi] เชื่อมต่อสำเร็จ IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[wifi] เชื่อมต่อไม่สำเร็จ จะทำการเชื่อมต่อต่อในเบื้องหลัง");
    }
}

bool wifi_ensureConnected() {
    if (WiFi.status() == WL_CONNECTED) {
        return true;
    }

    unsigned long now = millis();
    // Throttle การสั่ง reconnect ไม่ให้เรียกถี่เกินไปจนกระทบ sensor sampling
    if (now - lastReconnectAttemptMs >= RECONNECT_INTERVAL_MS) {
        lastReconnectAttemptMs = now;
        Serial.println("[wifi] หลุดการเชื่อมต่อ — กำลังเริ่มเชื่อมต่อใหม่ (Non-blocking)...");
        WiFi.disconnect();
        WiFi.reconnect();
    }

    // ตรวจสอบอย่างรวดเร็ว (รอไม่เกิน 500ms) เพื่อไม่ให้กระทบ sensor loop
    unsigned long checkStart = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - checkStart < 500) {
        delay(50);
    }

    return WiFi.status() == WL_CONNECTED;
}
