const API_URL = "https://your-worker.workers.dev"; // แก้เป็น URL ของ Worker ที่ deploy แล้ว
const DEVICE_ID = "ESP32-01";  // device_id ของ ESP32 ไม่ใช่ sensor_id
const POLL_INTERVAL_MS = 5000;

const sensorsEl = document.getElementById("sensors");
const lastUpdatedEl = document.getElementById("last-updated");

async function fetchStatus() {
    try {
        const response = await fetch(`${API_URL}/status?device_id=${DEVICE_ID}`);
        const result = await response.json();
        render(result);
    } catch (err) {
        render({ status: "N/A", last_seen: null, sensors: [] });
    }
}

function render(result) {
    lastUpdatedEl.textContent = result.last_seen ? formatTime(result.last_seen) : "-";

    if (result.status === "N/A" || result.sensors.length === 0) {
        sensorsEl.innerHTML = `<div class="sensor-card"><span class="badge badge--na">N/A (ไม่ทราบสถานะ)</span></div>`;
        return;
    }

    sensorsEl.innerHTML = "";
    for (const sensor of result.sensors) {
        sensorsEl.appendChild(renderSensorCard(sensor));
    }
}

function renderSensorCard(sensor) {
    const card = document.createElement("div");
    card.className = "sensor-card";

    let badgeClass = "badge--off";
    let badgeText = "ปิดอยู่";

    if (!sensor.ok) {
        badgeClass = "badge--error";
        badgeText = "เซนเซอร์หลุด";
    } else if (sensor.is_on) {
        badgeClass = "badge--on";
        badgeText = "เปิดอยู่";
    }

    card.innerHTML = `
        <div class="sensor-card__id">${sensor.sensor_id}</div>
        <div class="badge ${badgeClass}">${badgeText}</div>
        <dl class="readings">
            <div>
                <dt>แรงดัน</dt>
                <dd>${sensor.voltage_v.toFixed(2)} V</dd>
            </div>
            <div>
                <dt>กระแส</dt>
                <dd>${sensor.current_ma.toFixed(1)} mA</dd>
            </div>
            <div>
                <dt>กำลังไฟ</dt>
                <dd>${sensor.power_mw.toFixed(1)} mW</dd>
            </div>
        </dl>
    `;
    return card;
}

function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString("th-TH");
}

fetchStatus();
setInterval(fetchStatus, POLL_INTERVAL_MS);
