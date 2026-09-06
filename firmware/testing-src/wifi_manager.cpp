#include "wifi_manager.h"
#include "config.h"
#include <WiFi.h>

void wifi_connect() {
    Serial.printf("[wifi] กำลังเชื่อมต่อ %s", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    unsigned long startAttempt = millis();
    const unsigned long timeoutMs = 15000;

    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < timeoutMs) {
        delay(400);
        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[wifi] เชื่อมต่อสำเร็จ IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[wifi] เชื่อมต่อไม่สำเร็จ จะลองใหม่ระหว่างทำงาน");
    }
}

bool wifi_ensureConnected() {
    if (WiFi.status() == WL_CONNECTED) {
        return true;
    }
    Serial.println("[wifi] หลุดการเชื่อมต่อ กำลังลองใหม่...");
    wifi_connect();
    return WiFi.status() == WL_CONNECTED;
}
