import test from "node:test";
import assert from "node:assert/strict";

import workerModule from "../src/index.ts";
const worker = workerModule.default || workerModule;

function createMockD1() {
    const sequences = new Map();
    const latestStatus = new Map();
    const readings = [];

    return {
        prepare(sql) {
            let boundParams = [];
            return {
                bind(...params) {
                    boundParams = params;
                    return this;
                },
                async first() {
                    if (sql.includes("SELECT 1")) {
                        return { 1: 1 };
                    }
                    if (sql.includes("SELECT boot_id, last_sequence FROM device_sequence")) {
                        const deviceId = boundParams[0];
                        return sequences.get(deviceId) || null;
                    }
                    if (sql.includes("SELECT device_id, sensors_json, updated_at FROM latest_status")) {
                        const deviceId = boundParams[0];
                        return latestStatus.get(deviceId) || null;
                    }
                    return null;
                },
                async all() {
                    if (sql.includes("FROM readings")) {
                        return { results: readings };
                    }
                    return { results: [] };
                },
                async run() {
                    if (sql.includes("UPDATE device_sequence SET boot_id =")) {
                        const [bootId, seq, updated, deviceId] = boundParams;
                        sequences.set(deviceId, { boot_id: bootId, last_sequence: seq, updated_at: updated });
                        return { success: true };
                    }
                    if (sql.includes("UPDATE device_sequence SET last_sequence =")) {
                        const [seq, updated, deviceId] = boundParams;
                        const existing = sequences.get(deviceId) || {};
                        sequences.set(deviceId, { ...existing, last_sequence: seq, updated_at: updated });
                        return { success: true };
                    }
                    if (sql.includes("INSERT INTO device_sequence")) {
                        const [deviceId, bootId, seq, updated] = boundParams;
                        sequences.set(deviceId, { boot_id: bootId, last_sequence: seq, updated_at: updated });
                        return { success: true };
                    }
                    if (sql.includes("INSERT INTO latest_status")) {
                        const [deviceId, sensorsJson, updated] = boundParams;
                        latestStatus.set(deviceId, { device_id: deviceId, sensors_json: sensorsJson, updated_at: updated });
                        return { success: true };
                    }
                    return { success: true };
                }
            };
        },
        async batch(statements) {
            for (const stmt of statements) {
                await stmt.run();
            }
            return [];
        }
    };
}

const mockEnv = {
    DEVICE_TOKEN: "test_secret_token",
    DB: createMockD1(),
};

test("POST /update - 401 Unauthorized without Bearer token", async () => {
    const req = new Request("http://localhost/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: "ESP32-01", sensors: [] }),
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "unauthorized");
});

test("POST /update - 400 Bad Request with invalid payload", async () => {
    const req = new Request("http://localhost/update", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test_secret_token",
        },
        body: JSON.stringify({ invalid: true }),
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 400);
});

test("POST /update - 200 OK with valid payload, sequence and boot_id", async () => {
    const payload = {
        device_id: "ESP32-01",
        boot_id: "BOOT-SESSION-001",
        sequence_number: 1,
        sensors: [
            { sensor_id: "INA219-01", voltage_v: 5.0, current_ma: 120.0, power_mw: 600.0, is_on: true, ok: true },
            { sensor_id: "INA219-02", voltage_v: 5.0, current_ma: 0.0, power_mw: 0.0, is_on: false, ok: true },
        ],
    };

    const req = new Request("http://localhost/update", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test_secret_token",
        },
        body: JSON.stringify(payload),
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.boot_id, "BOOT-SESSION-001");
    assert.equal(body.sequence_number, 1);
});

test("POST /update - 409 Conflict when duplicate/older sequence sent in same session", async () => {
    const payload = {
        device_id: "ESP32-01",
        boot_id: "BOOT-SESSION-001",
        sequence_number: 1, // Already processed seq=1
        sensors: [
            { sensor_id: "INA219-01", voltage_v: 5.0, current_ma: 120.0, power_mw: 600.0, is_on: true, ok: true },
        ],
    };

    const req = new Request("http://localhost/update", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test_secret_token",
        },
        body: JSON.stringify(payload),
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error, "replay detected");
});

test("POST /update - 200 OK after Reboot with new boot_id resetting sequence", async () => {
    const rebootPayload = {
        device_id: "ESP32-01",
        boot_id: "BOOT-SESSION-002", // New boot session!
        sequence_number: 1,         // Reset back to 1
        sensors: [
            { sensor_id: "INA219-01", voltage_v: 5.0, current_ma: 15.0, power_mw: 75.0, is_on: false, ok: true },
        ],
    };

    const req = new Request("http://localhost/update", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test_secret_token",
        },
        body: JSON.stringify(rebootPayload),
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.boot_id, "BOOT-SESSION-002");
    assert.equal(body.sequence_number, 1);
});

test("GET /health - 200 OK and reports connected D1 status", async () => {
    const req = new Request("http://localhost/health", { method: "GET" });
    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.d1.status, "connected");
});

test("GET /health - 503 Service Unavailable when D1 is down", async () => {
    const brokenEnv = {
        DEVICE_TOKEN: "test_secret_token",
        DB: {
            prepare() {
                throw new Error("D1 connection timeout");
            }
        }
    };

    const req = new Request("http://localhost/health", { method: "GET" });
    const res = await worker.fetch(req, brokenEnv);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.status, "degraded");
    assert.equal(body.d1.status, "error");
});
