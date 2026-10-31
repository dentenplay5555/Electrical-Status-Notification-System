import type { Env } from "../types";

// แฮชด้วย SHA-256 ทั้งสองด้านก่อน เพื่อให้ buffer มีความยาว 32 bytes เท่ากันเสมอ
// ป้องกัน crypto.subtle.timingSafeEqual โยน error เมื่อ string มีความยาวไม่เท่ากัน
async function safeEqual(a: string, b: string): Promise<boolean> {
    const enc = new TextEncoder();
    const [ha, hb] = await Promise.all([
        crypto.subtle.digest("SHA-256", enc.encode(a)),
        crypto.subtle.digest("SHA-256", enc.encode(b)),
    ]);
    return crypto.subtle.timingSafeEqual(ha, hb);
}

function parseBasicAuth(header: string): { user: string; pass: string } | null {
    if (!header.startsWith("Basic ")) return null;
    try {
        const base64 = header.slice(6).trim();
        const decoded = atob(base64);
        const idx = decoded.indexOf(":");
        if (idx === -1) return null;
        return {
            user: decoded.slice(0, idx),
            pass: decoded.slice(idx + 1),
        };
    } catch {
        return null;
    }
}

async function checkAdminAuth(request: Request, env: Env): Promise<boolean> {
    const expectedUser = env.ADMIN_USERNAME || "admin";
    const expectedPass = env.ADMIN_PASSWORD;

    if (!expectedPass) {
        console.error(
            "[admin] ADMIN_PASSWORD is not configured on Cloudflare Worker (fail-closed). " +
            "Please add ADMIN_PASSWORD to .dev.vars for local dev or use 'wrangler secret put ADMIN_PASSWORD'."
        );
        return false;
    }

    const authHeader = request.headers.get("Authorization") ?? "";
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return false;

    const [userOk, passOk] = await Promise.all([
        safeEqual(parsed.user, expectedUser),
        safeEqual(parsed.pass, expectedPass),
    ]);

    return userOk && passOk;
}

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
    // 1. ตรวจสอบ Basic Auth (Username + Password)
    const isAuthed = await checkAdminAuth(request, env);
    if (!isAuthed) {
        return new Response(
            `<!DOCTYPE html>
            <html lang="th">
            <head><meta charset="UTF-8"><title>401 Unauthorized</title></head>
            <body style="font-family:sans-serif;padding:40px;background:#0d1117;color:#c9d1d9;">
                <h2>🔒 เข้าถึงปฏิเสธ (401 Unauthorized)</h2>
                <p>จำเป็นต้องเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านของผู้ดูแลระบบ (Admin Credentials)</p>
                <p style="color:#8b949e;font-size:0.9rem;">กำหนดค่าผ่าน ADMIN_USERNAME และ ADMIN_PASSWORD ในตัวแปรสภาพแวดล้อม Cloudflare Worker</p>
            </body>
            </html>`,
            {
                status: 401,
                headers: {
                    "WWW-Authenticate": 'Basic realm="Appliance Notifier Admin Console", charset="UTF-8"',
                    "Content-Type": "text/html; charset=utf-8",
                },
            }
        );
    }

    // 2. ดึงข้อมูลสถิติจาก D1 Database สำหรับแสดงผล
    const url = new URL(request.url);
    const wantsJson = url.searchParams.get("format") === "json" || request.headers.get("Accept")?.includes("application/json");

    let totalReadings = 0;
    let latestStatusRows: Array<{ device_id: string; sensors_json: string; updated_at: string }> = [];
    let recentReadings: Array<{
        id: number;
        device_id: string;
        sensor_id: string;
        voltage_v: number;
        current_ma: number;
        power_mw: number;
        is_on: number;
        ok: number;
        created_at: string;
    }> = [];

    try {
        const [countRes, statusRes, readingsRes] = await Promise.all([
            env.DB.prepare("SELECT COUNT(*) as count FROM readings").first<{ count: number }>(),
            env.DB.prepare("SELECT device_id, sensors_json, updated_at FROM latest_status").all<{
                device_id: string;
                sensors_json: string;
                updated_at: string;
            }>(),
            env.DB.prepare(
                "SELECT id, device_id, sensor_id, voltage_v, current_ma, power_mw, is_on, ok, created_at FROM readings ORDER BY id DESC LIMIT 25"
            ).all<{
                id: number;
                device_id: string;
                sensor_id: string;
                voltage_v: number;
                current_ma: number;
                power_mw: number;
                is_on: number;
                ok: number;
                created_at: string;
            }>(),
        ]);

        totalReadings = countRes?.count ?? 0;
        latestStatusRows = statusRes.results || [];
        recentReadings = readingsRes.results || [];
    } catch (dbErr) {
        console.error("[admin] DB query error:", dbErr);
    }

    if (wantsJson) {
        return new Response(
            JSON.stringify({
                authenticated: true,
                total_readings: totalReadings,
                latest_status: latestStatusRows,
                recent_readings: recentReadings,
            }),
            {
                headers: { "Content-Type": "application/json" },
            }
        );
    }

    // 3. แสดงผลหน้า Admin Dashboard สวยงาม ทันสมัย รองรับ Dark Mode
    const html = `<!DOCTYPE html>
<html lang="th" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ระบบจัดการผู้ดูแลระบบ | Admin Console</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0b0f19;
            --surface: #131b2e;
            --surface-hover: #1c2640;
            --border: #233152;
            --text-primary: #f0f4fc;
            --text-secondary: #94a3b8;
            --accent: #38bdf8;
            --accent-glow: rgba(56, 189, 248, 0.15);
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --font-sans: 'Plus Jakarta Sans', 'Prompt', sans-serif;
            --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: var(--bg);
            color: var(--text-primary);
            font-family: var(--font-sans);
            padding: 32px 20px;
            min-height: 100vh;
        }
        .container { max-width: 1100px; margin: 0 auto; }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 24px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 28px;
            flex-wrap: wrap;
            gap: 16px;
        }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-badge {
            background: var(--accent-glow);
            color: var(--accent);
            border: 1px solid var(--accent);
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: 600;
        }
        h1 { font-size: 1.4rem; font-weight: 700; color: #fff; }
        .sub { color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px; }
        .btn-group { display: flex; gap: 10px; }
        .btn {
            background: var(--surface);
            color: var(--text-primary);
            border: 1px solid var(--border);
            padding: 8px 14px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 0.85rem;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .btn:hover { background: var(--surface-hover); border-color: var(--accent); }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 16px;
            margin-bottom: 28px;
        }
        .stat-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
        }
        .stat-title { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px; }
        .stat-value { font-size: 1.8rem; font-weight: 700; color: #fff; font-family: var(--font-mono); }
        .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 28px;
        }
        .card-title {
            font-size: 1.05rem;
            font-weight: 600;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .table-wrap { overflow-x: auto; }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
            text-align: left;
        }
        th {
            background: rgba(255, 255, 255, 0.03);
            color: var(--text-secondary);
            padding: 12px;
            border-bottom: 1px solid var(--border);
            font-weight: 600;
        }
        td {
            padding: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            font-family: var(--font-mono);
        }
        tr:hover td { background: var(--surface-hover); }
        .pill {
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            display: inline-block;
        }
        .pill-on { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); }
        .pill-off { background: rgba(148, 163, 184, 0.15); color: var(--text-secondary); border: 1px solid var(--border); }
        .pill-error { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid var(--danger); }
        .meta-tag { color: var(--text-secondary); font-size: 0.8rem; }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="brand">
                <div>
                    <h1>⚡ Appliance Notifier · Admin Console</h1>
                    <p class="sub">แดชบอร์ดจัดการระบบและความปลอดภัยระดับผู้ดูแลระบบ (Protected Endpoint)</p>
                </div>
                <span class="brand-badge">Admin Authenticated</span>
            </div>
            <div class="btn-group">
                <a href="/status" target="_blank" class="btn">📡 ดู /status</a>
                <a href="/summary" target="_blank" class="btn">📊 ดู /summary</a>
                <a href="/admin?format=json" target="_blank" class="btn">💻 Raw JSON</a>
            </div>
        </header>

        <section class="stats-grid">
            <div class="stat-card">
                <div class="stat-title">จำนวนข้อมูลที่บันทึก (Total Readings)</div>
                <div class="stat-value">${totalReadings.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">อุปกรณ์ที่เชื่อมต่อ (Active Devices)</div>
                <div class="stat-value">${latestStatusRows.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">ระบบยืนยันตัวตน (Auth Mode)</div>
                <div class="stat-value" style="color:var(--success);font-size:1.3rem;">Basic Auth (Active)</div>
            </div>
        </section>

        <section class="card">
            <div class="card-title">
                <span>อุปกรณ์และสถานะล่าสุด (Latest Device Status)</span>
                <span class="meta-tag">ตาราง latest_status</span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Device ID</th>
                            <th>อัปเดตล่าสุด (UTC)</th>
                            <th>ข้อมูลเซนเซอร์ (Sensors Payload)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            latestStatusRows.length === 0
                                ? '<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);">ยังไม่มีข้อมูลอุปกรณ์ส่งเข้ามา</td></tr>'
                                : latestStatusRows
                                      .map(
                                          (row) => `
                        <tr>
                            <td><strong>${row.device_id}</strong></td>
                            <td>${row.updated_at}</td>
                            <td><code>${row.sensors_json}</code></td>
                        </tr>`
                                      )
                                      .join("")
                        }
                    </tbody>
                </table>
            </div>
        </section>

        <section class="card">
            <div class="card-title">
                <span>บันทึกโทรมาตรล่าสุด 25 รายการ (Recent Telemetry Readings)</span>
                <span class="meta-tag">ตาราง readings</span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>เวลา (UTC)</th>
                            <th>เซนเซอร์</th>
                            <th>แรงดัน (V)</th>
                            <th>กระแส (mA)</th>
                            <th>กำลังไฟ (mW)</th>
                            <th>สถานะโหลด</th>
                            <th>เซนเซอร์ OK</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            recentReadings.length === 0
                                ? '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);">ยังไม่มีบันทึกข้อมูล</td></tr>'
                                : recentReadings
                                      .map(
                                          (r) => `
                        <tr>
                            <td>#${r.id}</td>
                            <td>${r.created_at}</td>
                            <td><strong>${r.sensor_id}</strong></td>
                            <td>${r.voltage_v.toFixed(2)} V</td>
                            <td>${r.current_ma.toFixed(1)} mA</td>
                            <td>${r.power_mw.toFixed(1)} mW</td>
                            <td>${
                                r.is_on === 1
                                    ? '<span class="pill pill-on">ON (เปิด)</span>'
                                    : '<span class="pill pill-off">OFF (ปิด)</span>'
                            }</td>
                            <td>${
                                r.ok === 1
                                    ? '<span class="pill pill-on">ปกติ</span>'
                                    : '<span class="pill pill-error">FAULT</span>'
                            }</td>
                        </tr>`
                                      )
                                      .join("")
                        }
                    </tbody>
                </table>
            </div>
        </section>
    </div>
</body>
</html>`;

    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
        },
    });
}
