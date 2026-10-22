/**
 * Appliance Status Notifier — Frontend Client
 * ระบบแจ้งเตือนสถานะอุปกรณ์ไฟฟ้าแบบเรียลไทม์
 */
const DEFAULT_CONFIG = {
    apiUrl: "https://appliance-notifier-backend.benten012555.workers.dev",
    deviceId: "TM-Opera-O",
    pollIntervalMs: 5000,
};
// อ่านค่า config จาก localStorage หรือไม่ก็ใช้ค่าเริ่มต้น
function loadConfig() {
    return {
        apiUrl: localStorage.getItem("asn_api_url") || DEFAULT_CONFIG.apiUrl,
        deviceId: localStorage.getItem("asn_device_id") || DEFAULT_CONFIG.deviceId,
        pollIntervalMs: parseInt(localStorage.getItem("asn_poll_interval"), 10) || DEFAULT_CONFIG.pollIntervalMs,
    };
}
let config = loadConfig();
// DOM Elements
const sensorsEl = document.getElementById("sensors");
const lastUpdatedEl = document.getElementById("last-updated");
const relativeTimeEl = document.getElementById("relative-time");
const connectionPillEl = document.getElementById("connection-pill");
const connectionTextEl = document.getElementById("connection-text");
const deviceIdLabelEl = document.getElementById("device-id-label");
const pollProgressBarEl = document.getElementById("poll-progress-bar");
const refreshBtnEl = document.getElementById("refresh-btn");
const themeBtnEl = document.getElementById("theme-btn");
const settingsBtnEl = document.getElementById("settings-btn");
const activeSensorCountEl = document.getElementById("active-sensor-count");

// Metric Elements
const metricTotalPowerEl = document.getElementById("metric-total-power");
const metricTotalCurrentEl = document.getElementById("metric-total-current");
const metricActiveChannelsEl = document.getElementById("metric-active-channels");

// Modal Elements
const settingsModalEl = document.getElementById("settings-modal");
const modalCloseBtnEl = document.getElementById("modal-close-btn");
const cfgApiUrlInput = document.getElementById("cfg-api-url");
const cfgDeviceIdInput = document.getElementById("cfg-device-id");
const cfgPollIntervalInput = document.getElementById("cfg-poll-interval");
const cfgSaveBtn = document.getElementById("cfg-save-btn");
const cfgResetBtn = document.getElementById("cfg-reset-btn");

// State
let lastSuccessfulData = null;
let lastSeenDate = null;
let pollTimerId = null;
let pollCountdown = config.pollIntervalMs / 1000;
let isFetching = false;

/* ==========================================================================
   Theme Management
   ========================================================================== */

function initTheme() {
    const savedTheme = localStorage.getItem("asn_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("asn_theme", next);
}

themeBtnEl.addEventListener("click", toggleTheme);

/* ==========================================================================
   Connection & Polling Logic
   ========================================================================== */

function setConnectionState(state, text) {
    connectionPillEl.className = "connection-pill";
    if (state === "online") {
        connectionPillEl.classList.add("connection-pill--online");
        connectionTextEl.textContent = text || "ออนไลน์ (Online)";
    } else if (state === "na" || state === "offline") {
        connectionPillEl.classList.add("connection-pill--na");
        connectionTextEl.textContent = text || "ขาดการเชื่อมต่อ (N/A)";
    } else {
        connectionPillEl.classList.add("connection-pill--connecting");
        connectionTextEl.textContent = text || "กำลังเชื่อมต่อ...";
    }
}

async function fetchStatus(isManual = false) {
    if (isFetching) return;
    isFetching = true;

    if (isManual) {
        const icon = refreshBtnEl.querySelector(".refresh-icon");
        if (icon) icon.classList.add("is-spinning");
        setTimeout(() => icon && icon.classList.remove("is-spinning"), 750);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
        const url = `${config.apiUrl.replace(/\/+$/, "")}/status?device_id=${encodeURIComponent(config.deviceId)}`;
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        render(result);
    } catch (err) {
        console.warn("[fetchStatus] error:", err);
        render({
            status: "N/A",
            last_seen: lastSeenDate ? lastSeenDate.toISOString() : null,
            sensors: [],
            is_stale: true,
        });
    } finally {
        clearTimeout(timeoutId);
        isFetching = false;
        resetPollTimer();
    }
}

function resetPollTimer() {
    if (pollTimerId) clearInterval(pollTimerId);
    pollCountdown = config.pollIntervalMs / 1000;
    updateProgressBar(100);

    pollTimerId = setInterval(() => {
        pollCountdown -= 0.5;
        const pct = Math.max(0, (pollCountdown / (config.pollIntervalMs / 1000)) * 100);
        updateProgressBar(pct);

        if (pollCountdown <= 0) {
            clearInterval(pollTimerId);
            fetchStatus();
        }
    }, 500);
}

function updateProgressBar(pct) {
    if (pollProgressBarEl) {
        pollProgressBarEl.style.width = `${pct}%`;
    }
}

/* ==========================================================================
   Relative Time Updates
   ========================================================================== */

function updateRelativeTime() {
    if (!lastSeenDate) {
        relativeTimeEl.textContent = "";
        return;
    }

    const secondsAgo = Math.max(0, Math.floor((Date.now() - lastSeenDate.getTime()) / 1000));
    if (secondsAgo < 5) {
        relativeTimeEl.textContent = "(เมื่อสักครู่)";
    } else if (secondsAgo < 60) {
        relativeTimeEl.textContent = `(${secondsAgo} วินาทีที่แล้ว)`;
    } else {
        const mins = Math.floor(secondsAgo / 60);
        relativeTimeEl.textContent = `(${mins} นาทีที่แล้ว)`;
    }
}

setInterval(updateRelativeTime, 1000);

/* ==========================================================================
   Render Logic (Flicker-Free DOM Recycling)
   ========================================================================== */

function render(result) {
    deviceIdLabelEl.textContent = result.device_id || config.deviceId;

    if (result.last_seen) {
        lastSeenDate = new Date(result.last_seen);
        lastUpdatedEl.textContent = lastSeenDate.toLocaleTimeString("th-TH");
        updateRelativeTime();
    } else {
        lastUpdatedEl.textContent = "-";
        relativeTimeEl.textContent = "";
    }

    const isOffline = result.status === "N/A" || !result.sensors || result.sensors.length === 0;

    if (isOffline) {
        setConnectionState("na", "ขาดการเชื่อมต่อ (N/A)");
        renderOfflineNotice(result.last_seen);
        updateOverallMetrics([], true);
        return;
    }

    setConnectionState("online", "ออนไลน์ (Online)");
    lastSuccessfulData = result;

    updateOverallMetrics(result.sensors, false);
    renderSensorCards(result.sensors);
}

function updateOverallMetrics(sensors, isOffline) {
    if (isOffline || !sensors || sensors.length === 0) {
        metricTotalPowerEl.innerHTML = `0.0 <span class="unit">mW</span>`;
        metricTotalCurrentEl.innerHTML = `0.0 <span class="unit">mA</span>`;
        metricActiveChannelsEl.innerHTML = `0 <span class="unit">/ 0</span>`;
        activeSensorCountEl.textContent = "0 ช่อง";
        return;
    }

    let totalMw = 0;
    let totalMa = 0;
    let activeCount = 0;

    for (const s of sensors) {
        if (s.ok) {
            totalMw += s.power_mw || 0;
            totalMa += s.current_ma || 0;
            if (s.is_on) activeCount++;
        }
    }

    if (totalMw >= 1000) {
        metricTotalPowerEl.innerHTML = `${(totalMw / 1000).toFixed(2)} <span class="unit">W</span>`;
    } else {
        metricTotalPowerEl.innerHTML = `${totalMw.toFixed(1)} <span class="unit">mW</span>`;
    }

    metricTotalCurrentEl.innerHTML = `${totalMa.toFixed(1)} <span class="unit">mA</span>`;
    metricActiveChannelsEl.innerHTML = `${activeCount} <span class="unit">/ ${sensors.length}</span>`;
    activeSensorCountEl.textContent = `${sensors.length} ช่อง`;
}

function renderOfflineNotice(lastSeen) {
    const timeNotice = lastSeen
        ? `สัญญาณขาดหายไปเกิน 30 วินาที (ล่าสุดเมื่อ ${new Date(lastSeen).toLocaleTimeString("th-TH")})`
        : "ยังไม่เคยได้รับสัญญาณจากอุปกรณ์ ESP32";

    sensorsEl.innerHTML = `
        <div class="sensor-card sensor-card--offline-notice">
            <div class="offline-notice__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                    <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                </svg>
            </div>
            <div class="badge badge--na" style="margin-bottom: 12px;">สถานะ: N/A (ไม่ทราบสถานะ)</div>
            <h3 class="offline-notice__title">ESP32 ขาดการเชื่อมต่อ</h3>
            <p class="offline-notice__desc">
                ${timeNotice}<br />
                ระบบเปลี่ยนสถานะเป็น N/A โดยอัตโนมัติตามเกณฑ์ 30 วินาที โปรดตรวจสอบไฟเลี้ยงบอร์ด ESP32 และเครือข่าย Wi-Fi
            </p>
        </div>
    `;
}

function renderSensorCards(sensors) {
    // ลบการ์ดที่ไม่ใช่เซนเซอร์จริง เช่น offline notice หรือ loading skeleton
    sensorsEl.querySelectorAll(".sensor-card:not([data-sensor-id])").forEach((el) => {
        el.remove();
    });

    const currentCardMap = new Map();
    sensorsEl.querySelectorAll(".sensor-card[data-sensor-id]").forEach((el) => {
        currentCardMap.set(el.dataset.sensorId, el);
    });

    const activeIds = new Set();

    sensors.forEach((sensor) => {
        activeIds.add(sensor.sensor_id);
        let card = currentCardMap.get(sensor.sensor_id);

        if (!card) {
            card = createSensorCard(sensor);
            sensorsEl.appendChild(card);
        } else {
            updateSensorCard(card, sensor);
        }
    });

    // นำการ์ดเซนเซอร์ที่ไม่มีในรายการใหม่ออก
    currentCardMap.forEach((el, id) => {
        if (!activeIds.has(id)) {
            el.remove();
        }
    });
}

function createSensorCard(sensor) {
    const card = document.createElement("div");
    card.className = "sensor-card";
    card.dataset.sensorId = sensor.sensor_id;
    updateSensorCard(card, sensor);
    return card;
}

function updateSensorCard(card, sensor) {
    let badgeClass = "badge--off";
    let badgeText = "ปิดอยู่ (OFF)";
    let cardStateClass = "sensor-card--inactive";

    if (!sensor.ok) {
        badgeClass = "badge--error";
        badgeText = "เซนเซอร์หลุด (FAULT)";
        cardStateClass = "sensor-card--fault";
    } else if (sensor.is_on) {
        badgeClass = "badge--on";
        badgeText = "เปิดอยู่ (ON)";
        cardStateClass = "sensor-card--active";
    }

    // Gauge calculation (relative to 3000 mW typical load, max 100%)
    const typicalMaxMw = 3000;
    const powerPct = Math.min(100, Math.max(0, ((sensor.power_mw || 0) / typicalMaxMw) * 100));
    const isHighPower = powerPct > 75;

    card.className = `sensor-card ${cardStateClass}`;
    card.innerHTML = `
        <div class="sensor-card__top">
            <div class="sensor-card__id">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="4" y="4" width="16" height="16" rx="2"></rect>
                    <rect x="9" y="9" width="6" height="6"></rect>
                </svg>
                ${escapeHtml(sensor.sensor_id)}
            </div>
            <span class="badge ${badgeClass}">${badgeText}</span>
        </div>

        <div class="power-gauge">
            <div class="power-gauge__label">
                <span>ระดับโหลดไฟฟ้า</span>
                <span>${(sensor.power_mw || 0).toFixed(0)} mW</span>
            </div>
            <div class="power-gauge__track">
                <div class="power-gauge__fill ${isHighPower ? "power-gauge__fill--high" : ""}" style="width: ${powerPct}%;"></div>
            </div>
        </div>

        <dl class="readings">
            <div class="reading-col">
                <dt>แรงดัน (V)</dt>
                <dd>${sensor.voltage_v !== undefined ? sensor.voltage_v.toFixed(2) : "0.00"} <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted)">V</span></dd>
            </div>
            <div class="reading-col">
                <dt>กระแส (mA)</dt>
                <dd>${sensor.current_ma !== undefined ? sensor.current_ma.toFixed(1) : "0.0"} <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted)">mA</span></dd>
            </div>
            <div class="reading-col">
                <dt>กำลังไฟ (mW)</dt>
                <dd>${sensor.power_mw !== undefined ? sensor.power_mw.toFixed(1) : "0.0"} <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted)">mW</span></dd>
            </div>
        </dl>
    `;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
}

/* ==========================================================================
   Page Visibility API (Pause polling when tab is hidden to save battery)
   ========================================================================== */

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        if (pollTimerId) clearInterval(pollTimerId);
    } else {
        fetchStatus();
    }
});

/* ==========================================================================
   Settings Modal Interactions
   ========================================================================== */

settingsBtnEl.addEventListener("click", () => {
    cfgApiUrlInput.value = config.apiUrl;
    cfgDeviceIdInput.value = config.deviceId;
    cfgPollIntervalInput.value = config.pollIntervalMs / 1000;
    settingsModalEl.classList.add("is-open");
    settingsModalEl.setAttribute("aria-hidden", "false");
});

modalCloseBtnEl.addEventListener("click", closeModal);
settingsModalEl.addEventListener("click", (e) => {
    if (e.target === settingsModalEl) closeModal();
});

function closeModal() {
    settingsModalEl.classList.remove("is-open");
    settingsModalEl.setAttribute("aria-hidden", "true");
}

cfgSaveBtn.addEventListener("click", () => {
    const newUrl = cfgApiUrlInput.value.trim() || DEFAULT_CONFIG.apiUrl;
    const newDevice = cfgDeviceIdInput.value.trim() || DEFAULT_CONFIG.deviceId;
    const newPollSec = parseInt(cfgPollIntervalInput.value, 10) || 5;

    config.apiUrl = newUrl;
    config.deviceId = newDevice;
    config.pollIntervalMs = Math.max(2, Math.min(60, newPollSec)) * 1000;

    localStorage.setItem("asn_api_url", config.apiUrl);
    localStorage.setItem("asn_device_id", config.deviceId);
    localStorage.setItem("asn_poll_interval", String(config.pollIntervalMs));

    closeModal();
    fetchStatus(true);
});

cfgResetBtn.addEventListener("click", () => {
    localStorage.removeItem("asn_api_url");
    localStorage.removeItem("asn_device_id");
    localStorage.removeItem("asn_poll_interval");
    config = { ...DEFAULT_CONFIG };
    closeModal();
    fetchStatus(true);
});

refreshBtnEl.addEventListener("click", () => fetchStatus(true));

// Initial boot
initTheme();
fetchStatus();
