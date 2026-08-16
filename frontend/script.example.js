const API_URL = "https://Micheal Jackson Example.workers.dev"; // แก้เป็น URL ของ Worker ที่ deploy แล้ว
const DEVICE_ID = "device-01";
const POLL_INTERVAL_MS = 5000; // ดึงค่าใหม่ทุก 5 วินาที

const badgeEl = document.getElementById("status-badge");
const voltageEl = document.getElementById("voltage");
const currentEl = document.getElementById("current");
const powerEl = document.getElementById("power");
const lastUpdatedEl = document.getElementById("last-updated");

async function fetchStatus() {
    try {
        const response = await fetch(`${API_URL}/status?device_id=${DEVICE_ID}`);
        const result = await response.json();
        render(result);
    } catch (err) {
        // เรียก API ไม่สำเร็จเลย (เช่น อินเทอร์เน็ตฝั่งเว็บมีปัญหา) ก็ถือว่าไม่รู้สถานะ
        render({ status: "N/A", reason: "เรียก API ไม่สำเร็จ" });
    }
}

function render(result) {
    if (result.status === "N/A") {
        setBadge("badge--na", "N/A (ไม่ทราบสถานะ)");
        lastUpdatedEl.textContent = result.last_seen ? formatTime(result.last_seen) : "-";
        return;
    }

    const data = result.data;
    const isOn = data.is_on;

    setBadge(isOn ? "badge--on" : "badge--off", isOn ? "เปิดอยู่" : "ปิดอยู่");
    voltageEl.textContent = `${data.voltage_v.toFixed(2)} V`;
    currentEl.textContent = `${data.current_ma.toFixed(1)} mA`;
    powerEl.textContent = `${data.power_mw.toFixed(1)} mW`;
    lastUpdatedEl.textContent = formatTime(data.updated_at);
}

function setBadge(className, text) {
    badgeEl.className = `badge ${className}`;
    badgeEl.textContent = text;
}

function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString("th-TH");
}

fetchStatus();
setInterval(fetchStatus, POLL_INTERVAL_MS);
