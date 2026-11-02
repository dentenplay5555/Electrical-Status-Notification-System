import type { Env, DbQuotaInfo } from "../types";
import { jsonResponse } from "../lib/cors";
import { sendLineMessage } from "../lib/line";
import { deleteOldReadings, getDbQuota, exportReadings, importReadings } from "../lib/db";


// แฮชด้วย SHA-256 ทั้งสองด้านก่อน เพื่อให้ buffer มีความยาว 32 bytes เท่ากันเสมอ
async function safeEqual(a: string, b: string): Promise<boolean> {
    const enc = new TextEncoder();
    const [ha, hb] = await Promise.all([
        crypto.subtle.digest("SHA-256", enc.encode(a)),
        crypto.subtle.digest("SHA-256", enc.encode(b)),
    ]);

    const subtleWithTiming = crypto.subtle as unknown as { timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean };
    if (typeof subtleWithTiming.timingSafeEqual === "function") {
        return subtleWithTiming.timingSafeEqual(ha, hb);
    }

    const viewA = new Uint8Array(ha);
    const viewB = new Uint8Array(hb);
    let diff = 0;
    for (let i = 0; i < viewA.length; i++) {
        diff |= viewA[i] ^ viewB[i];
    }
    return diff === 0;
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

function maskSecret(val?: string): string {
    if (!val) return '<span class="badge-missing">ไม่ได้ตั้งค่า (Missing)</span>';
    if (val.length <= 8) return '<span class="badge-configured">ตั้งค่าแล้ว (***)</span>';
    return `<span class="badge-configured">ตั้งค่าแล้ว (${escapeHtml(val.slice(0, 4))}...${escapeHtml(val.slice(-4))})</span>`;
}

function escapeHtml(str: unknown): string {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(str ?? "").replace(/[&<>"']/g, (m) => map[m] ?? m);
}

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
    // 1. ตรวจสอบ Basic Auth (Username + Password)
    const isAuthed = await checkAdminAuth(request, env);
    if (!isAuthed) {
        return new Response(
            `<!DOCTYPE html>
            <html lang="th">
            <head><meta charset="UTF-8"><title>401 Unauthorized</title></head>
            <body style="font-family:sans-serif;padding:40px;background:#0b0f19;color:#f0f4fc;text-align:center;">
                <h2 style="color:#ef4444;">🔒 เข้าถึงถูกปฏิเสธ (401 Unauthorized)</h2>
                <p>จำเป็นต้องยืนยันตัวตนด้วยชื่อผู้ใช้และรหัสผ่านของผู้ดูแลระบบ (Admin Credentials)</p>
                <p style="color:#94a3b8;font-size:0.9rem;">ตั้งค่าผ่าน ADMIN_USERNAME และ ADMIN_PASSWORD ในตัวแปรสภาพแวดล้อม Cloudflare Worker</p>
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

    // 2. จัดการ Action คำขอ POST สำหรับเครื่องมือทดสอบ/จัดการระบบ
    if (request.method === "POST") {
        try {
            const body = await request.json() as Record<string, unknown>;
            const action = body.action;

            if (action === "test_line") {
                const thaiDate = new Intl.DateTimeFormat("th-TH", {
                    timeZone: "Asia/Bangkok",
                    dateStyle: "medium",
                    timeStyle: "short",
                }).format(new Date());
                const text = `🔔 [Admin Test Notification]\n📅 เวลา: ${thaiDate}\n🤖 ทดสอบการแจ้งเตือนจากหน้า Admin Console\n⚡ ระบบ Appliance Status Notifier ทำงานปกติ`;
                const ok = await sendLineMessage(env, text);
                return jsonResponse({
                    ok,
                    message: ok ? "ส่งข้อความทดสอบเข้า LINE เรียบร้อยแล้ว!" : "ไม่สามารถส่ง LINE ได้ โปรดตรวจสอบ LINE_ACCESS_TOKEN",
                });
            }

            if (action === "run_sql") {
                const query = String(body.query || "").trim();
                const upper = query.toUpperCase();
                if (!upper.startsWith("SELECT") && !upper.startsWith("PRAGMA") && !upper.startsWith("EXPLAIN")) {
                    return jsonResponse(
                        { error: "ไม่อนุญาต: รันได้เฉพาะคำสั่งอ่านข้อมูล (SELECT / PRAGMA) เพื่อความปลอดภัยของฐานข้อมูล" },
                        { status: 400 }
                    );
                }
                const startTime = Date.now();
                const res = await env.DB.prepare(query).all();
                const durationMs = Date.now() - startTime;
                return jsonResponse({
                    ok: true,
                    duration_ms: durationMs,
                    results: res.results || [],
                    meta: res.meta || {},
                });
            }

            if (action === "prune") {
                const days = Math.max(1, Number(body.days) || 7);
                const deleted = await deleteOldReadings(env, days);
                return jsonResponse({
                    ok: true,
                    deleted,
                    message: `ลบข้อมูลโทรมาตรที่เก่าเกิน ${days} วัน เรียบร้อยแล้ว (${deleted} รายการ)`,
                });
            }

            // ===== Quota Monitoring & Alert =====
            if (action === "quota") {
                const quota = await getDbQuota(env);
                return jsonResponse({ ok: true, quota });
            }

            if (action === "alert_quota") {
                const quota = await getDbQuota(env);
                const thaiDate = new Intl.DateTimeFormat("th-TH", {
                    timeZone: "Asia/Bangkok",
                    dateStyle: "medium",
                    timeStyle: "short",
                }).format(new Date());
                const text = `🚨 [Admin Manual Trigger: D1 Quota Check]\n📅 เวลา: ${thaiDate}\n💾 การใช้งาน: ${quota.usage_percent}% (~${quota.estimated_size_mb} MB / ${quota.d1_free_tier_limit_mb} MB)\n📊 ข้อมูลคงเหลือ: ${quota.readings_count.toLocaleString()} แถว\n📅 เก่าสุด: ${quota.oldest_reading ?? "N/A"}\n📌 สถานะ: ${quota.usage_percent >= 80 ? "⚠️ ใกล้เต็ม" : "✅ ปกติ"}`;
                const ok = await sendLineMessage(env, text);
                return jsonResponse({
                    ok,
                    quota,
                    message: ok ? "ส่งข้อมูลสถานะ Quota เข้า LINE สำเร็จแล้ว!" : "ไม่สามารถส่ง LINE ได้ โปรดตรวจสอบ LINE token",
                });
            }


            // ===== Backup: Export ข้อมูลเป็น JSON =====
            if (action === "export_backup") {
                const deviceId = typeof body.device_id === "string" ? body.device_id : undefined;
                const limit = Number(body.limit) || 10000;
                const data = await exportReadings(env, deviceId, limit);
                return jsonResponse({
                    ok: true,
                    backup: data,
                    message: `ส่งออกข้อมูล ${data.readings.length} readings สำเร็จ`,
                });
            }

            // ===== Restore: Import ข้อมูลจาก JSON backup =====
            if (action === "import_restore") {
                const readings = body.readings;
                if (!Array.isArray(readings)) {
                    return jsonResponse(
                        { error: "ต้องส่ง readings เป็น array ของ reading objects" },
                        { status: 400 }
                    );
                }
                const result = await importReadings(env, readings as Parameters<typeof importReadings>[1]);
                return jsonResponse({
                    ok: true,
                    ...result,
                    message: `นำเข้าข้อมูลสำเร็จ: ${result.imported} รายการ, ข้าม: ${result.skipped} รายการ`,
                });
            }

            return jsonResponse({ error: "Unknown action" }, { status: 400 });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return jsonResponse({ error: msg }, { status: 500 });
        }
    }

    // 3. รวบรวมข้อมูล Full Request Metadata สำหรับแสดงผลการวิเคราะห์
    const url = new URL(request.url);
    const wantsJson = url.searchParams.get("format") === "json" || request.headers.get("Accept")?.includes("application/json");

    const cf = (request as unknown as { cf?: Record<string, unknown> }).cf || {};
    const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "127.0.0.1";
    const rayId = request.headers.get("cf-ray") || "-";
    const userAgent = request.headers.get("user-agent") || "-";
    const httpProtocol = String(cf.httpProtocol || "HTTP/1.1");
    const edgeColo = String(cf.colo || "LOCAL");
    const country = String(cf.country || "TH");
    const city = String(cf.city || "Bangkok");
    const asn = String(cf.asn || "-");
    const asOrg = String(cf.asOrganization || "-");
    const tlsVersion = String(cf.tlsVersion || "-");
    const tlsCipher = String(cf.tlsCipher || "-");

    // รวบรวม Headers ทั้งหมด
    const headersList: Array<{ key: string; value: string }> = [];
    request.headers.forEach((value, key) => {
        // Mask ค่า Authorization เพื่อความปลอดภัย
        if (key.toLowerCase() === "authorization") {
            headersList.push({ key, value: "Basic " + value.slice(6, 10) + "********" });
        } else {
            headersList.push({ key, value });
        }
    });

    // 4. ดึงข้อมูลสถิติจาก D1 Database
    let totalReadings = 0;
    let totalDevices = 0;
    let quotaInfo: DbQuotaInfo = {
        readings_count: 0,
        devices_count: 0,
        sensors_count: 0,
        latest_status_count: 0,
        estimated_size_mb: 0,
        d1_free_tier_limit_mb: 5120,
        usage_percent: 0,
    };
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
        const [quotaRes, statusRes, readingsRes] = await Promise.all([
            getDbQuota(env),
            env.DB.prepare("SELECT device_id, sensors_json, updated_at FROM latest_status ORDER BY updated_at DESC").all<{
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

        quotaInfo = quotaRes;
        totalReadings = quotaRes.readings_count;
        totalDevices = quotaRes.devices_count;
        latestStatusRows = statusRes.results || [];
        recentReadings = readingsRes.results || [];
    } catch (dbErr) {
        console.error("[admin] DB query error:", dbErr);
    }


    if (wantsJson) {
        return jsonResponse({
            authenticated: true,
            request_meta: {
                method: request.method,
                url: request.url,
                client_ip: clientIp,
                ray_id: rayId,
                edge_colo: edgeColo,
                country,
                city,
                asn,
                as_org: asOrg,
                protocol: httpProtocol,
                tls: { version: tlsVersion, cipher: tlsCipher },
                headers: Object.fromEntries(headersList.map((h) => [h.key, h.value])),
            },
            database: {
                total_readings: totalReadings,
                total_devices: totalDevices,
                latest_status: latestStatusRows,
                recent_readings: recentReadings,
            },
        });
    }

    // 5. แสดงผลหน้า Admin Dashboard ฉบับเต็ม (Full Request & Testing Console)
    const html = `<!DOCTYPE html>
<html lang="th" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ระบบจัดการผู้ดูแลระบบและวิเคราะห์คำขอ | Admin Console</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0b0f19;
            --surface: #131b2e;
            --surface-hover: #1c2640;
            --surface-elevated: #1e293b;
            --border: #233152;
            --border-highlight: #3b82f6;
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
            padding: 28px 18px;
            min-height: 100vh;
            line-height: 1.5;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 24px;
            flex-wrap: wrap;
            gap: 16px;
        }
        .brand h1 { font-size: 1.45rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
        .brand .sub { color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px; }
        .brand-badge {
            background: rgba(16, 185, 129, 0.15);
            color: var(--success);
            border: 1px solid var(--success);
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.78rem;
            font-weight: 600;
        }
        .nav-actions { display: flex; gap: 8px; flex-wrap: wrap; }
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
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s;
            font-family: var(--font-sans);
        }
        .btn:hover { background: var(--surface-hover); border-color: var(--accent); color: #fff; }
        .btn--primary { background: #0284c7; border-color: #0284c7; color: #fff; }
        .btn--primary:hover { background: #0369a1; }
        .btn--success { background: #059669; border-color: #059669; color: #fff; }
        .btn--success:hover { background: #047857; }
        .btn--danger { background: rgba(239, 68, 68, 0.15); border-color: var(--danger); color: #fca5a5; }
        .btn--danger:hover { background: var(--danger); color: #fff; }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 14px;
            margin-bottom: 24px;
        }
        .stat-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 18px;
        }
        .stat-title { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; }
        .stat-value { font-size: 1.8rem; font-weight: 700; color: #fff; font-family: var(--font-mono); }

        .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 22px;
            margin-bottom: 24px;
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 10px;
        }
        .card-title {
            font-size: 1.05rem;
            font-weight: 700;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .meta-tag {
            color: var(--text-secondary);
            font-size: 0.78rem;
            background: rgba(255, 255, 255, 0.04);
            padding: 3px 8px;
            border-radius: 4px;
            border: 1px solid var(--border);
        }

        /* Tabs UI */
        .tabs {
            display: flex;
            gap: 6px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 18px;
            overflow-x: auto;
        }
        .tab-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            padding: 10px 16px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
            font-family: var(--font-sans);
        }
        .tab-btn:hover { color: var(--text-primary); }
        .tab-btn.is-active {
            color: var(--accent);
            border-bottom-color: var(--accent);
            background: rgba(56, 189, 248, 0.05);
        }
        .tab-pane { display: none; }
        .tab-pane.is-active { display: block; }

        /* Request Diagnostics Grid */
        .diag-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 12px;
            margin-bottom: 18px;
        }
        .diag-item {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px 14px;
        }
        .diag-label { font-size: 0.75rem; color: var(--text-secondary); }
        .diag-val { font-size: 0.95rem; font-weight: 600; font-family: var(--font-mono); color: var(--accent); word-break: break-all; }

        /* Tables */
        .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left; }
        th {
            background: rgba(255, 255, 255, 0.03);
            color: var(--text-secondary);
            padding: 10px 14px;
            border-bottom: 1px solid var(--border);
            font-weight: 600;
        }
        td {
            padding: 10px 14px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            font-family: var(--font-mono);
        }
        tr:hover td { background: var(--surface-hover); }

        /* Code & Pre */
        pre {
            background: #070a13;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 14px;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            color: #38bdf8;
            overflow-x: auto;
            max-height: 350px;
        }
        textarea.code-editor, input.text-input {
            width: 100%;
            background: #070a13;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            color: #f0f4fc;
            margin-bottom: 12px;
            resize: vertical;
        }
        textarea.code-editor:focus, input.text-input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--accent-glow);
        }

        .pill { padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; display: inline-block; }
        .pill-on { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); }
        .pill-off { background: rgba(148, 163, 184, 0.15); color: var(--text-secondary); border: 1px solid var(--border); }
        .pill-error { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid var(--danger); }
        .badge-configured { color: var(--success); font-weight: 600; }
        .badge-missing { color: var(--danger); font-weight: 600; }
        .form-row { margin-bottom: 14px; }
        .form-label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 6px; color: var(--text-secondary); }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <header class="header">
            <div class="brand">
                <h1>⚡ Appliance Notifier · Admin & Request Diagnostics</h1>
                <p class="sub">แดชบอร์ดตรวจสอบคำขอ (Full Request Inspector) ทดสอบ GET / POST และจัดการฐานข้อมูล D1</p>
            </div>
            <div class="nav-actions">
                <span class="brand-badge">✓ Basic Auth Verified</span>
                <a href="/admin?format=json" target="_blank" class="btn">💻 Admin JSON</a>
                <a href="/dashboard.html" target="_blank" class="btn">🌐 เปิดหน้า Live Dashboard</a>
            </div>
        </header>

        <!-- Stats Grid -->
        <section class="stats-grid">
            <div class="stat-card">
                <div class="stat-title">จำนวน Readings ทั้งหมดใน D1</div>
                <div class="stat-value">${totalReadings.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">การใช้พื้นที่ D1 (Quota Free 5GB)</div>
                <div class="stat-value" style="color:${quotaInfo.usage_percent >= 80 ? 'var(--danger)' : 'var(--accent)'};font-size:1.45rem;">
                    ~${quotaInfo.estimated_size_mb} MB <span style="font-size:0.85rem;color:var(--text-secondary);">(${quotaInfo.usage_percent}%)</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-title">อุปกรณ์ที่ลงทะเบียน (Registered Devices)</div>
                <div class="stat-value">${totalDevices}</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">Cloudflare Edge Node (Colo)</div>
                <div class="stat-value" style="color:var(--accent);">${escapeHtml(edgeColo)}</div>
            </div>
        </section>

        <!-- Current Full Request Inspector -->
        <section class="card">
            <div class="card-header">
                <div class="card-title">
                    <span>📡 การตรวจสอบคำขอปัจจุบัน (Incoming Full Request Inspector)</span>
                </div>
                <span class="meta-tag">Ray ID: ${escapeHtml(rayId)}</span>
            </div>

            <div class="diag-grid">
                <div class="diag-item">
                    <div class="diag-label">HTTP Method & Path</div>
                    <div class="diag-val">${escapeHtml(request.method)} ${escapeHtml(url.pathname)}</div>
                </div>
                <div class="diag-item">
                    <div class="diag-label">Client IP (CF-Connecting-IP)</div>
                    <div class="diag-val">${escapeHtml(clientIp)}</div>
                </div>
                <div class="diag-item">
                    <div class="diag-label">Location / Country / City</div>
                    <div class="diag-val">${escapeHtml(country)} · ${escapeHtml(city)}</div>
                </div>
                <div class="diag-item">
                    <div class="diag-label">ISP Network (ASN)</div>
                    <div class="diag-val">AS${escapeHtml(asn)} (${escapeHtml(asOrg)})</div>
                </div>
                <div class="diag-item">
                    <div class="diag-label">TLS Security</div>
                    <div class="diag-val">${escapeHtml(tlsVersion)} (${escapeHtml(tlsCipher)})</div>
                </div>
                <div class="diag-item">
                    <div class="diag-label">User-Agent</div>
                    <div class="diag-val" style="font-size:0.8rem;">${escapeHtml(userAgent)}</div>
                </div>
            </div>

            <details style="margin-top:12px;cursor:pointer;">
                <summary style="color:var(--accent);font-weight:600;font-size:0.85rem;margin-bottom:8px;">
                    ▶ ดูตาราง Headers ทั้งหมดของคำขอนี้ (${headersList.length} Headers)
                </summary>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th style="width:30%;">Header Name</th>
                                <th>Header Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${headersList
                                .map(
                                    (h) => `
                            <tr>
                                <td><strong>${escapeHtml(h.key)}</strong></td>
                                <td><code>${escapeHtml(h.value)}</code></td>
                            </tr>`
                                )
                                .join("")}
                        </tbody>
                    </table>
                </div>
            </details>
        </section>

        <!-- Interactive API & Request Testing Console -->
        <section class="card">
            <div class="card-header">
                <div class="card-title">
                    <span>🧪 เครื่องมือทดสอบคำขอสด (Live API & Request Tester)</span>
                </div>
                <span class="meta-tag">Real-time HTTP Console</span>
            </div>

            <!-- Tab Navigation -->
            <div class="tabs">
                <button class="tab-btn is-active" onclick="switchTab('tab-post')">🚀 ทดสอบ POST /update (ESP32 Simulator)</button>
                <button class="tab-btn" onclick="switchTab('tab-get')">🔍 ทดสอบ GET Endpoints</button>
                <button class="tab-btn" onclick="switchTab('tab-sql')">⚡ D1 SQL Query Runner</button>
                <button class="tab-btn" onclick="switchTab('tab-actions')">⚙️ จัดการระบบ & LINE Test</button>
                <button class="tab-btn" onclick="switchTab('tab-quota')">💾 โควต้า & สำรองข้อมูล (Quota & Backup)</button>
                <button class="tab-btn" onclick="switchTab('tab-lab')">🧪 ห้องทดลอง (Latency / N/A)</button>
            </div>

            <!-- Tab 1: POST /update Simulator -->
            <div id="tab-post" class="tab-pane is-active">
                <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">
                    จำลองบอร์ด ESP32 ส่งข้อมูลวัดกระแส/แรงดันเข้าสู่ Worker ผ่าน <code>POST /update</code> พร้อมตรวจจับ Full Response
                </p>

                <div class="form-row">
                    <label class="form-label">เลือกแม่แบบตัวอย่าง (Quick Presets):</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                        <button type="button" class="btn" onclick="loadPreset('both_on')">💡 ทั้ง 2 ช่องเปิด (Both ON)</button>
                        <button type="button" class="btn" onclick="loadPreset('ch1_on')">⚡ ช่อง 1 ON, ช่อง 2 OFF</button>
                        <button type="button" class="btn" onclick="loadPreset('both_off')">💤 ทั้ง 2 ช่องปิด (Both OFF)</button>
                        <button type="button" class="btn" onclick="loadPreset('fault')">⚠️ ช่อง 2 หลุด (Fault Test)</button>
                        <button type="button" class="btn btn--danger" onclick="loadPreset('invalid')">❌ Payload ผิด (NaN Test)</button>
                    </div>
                </div>

                <div class="form-row">
                    <label class="form-label">Authorization Token (Bearer):</label>
                    <input type="text" id="post-token" class="text-input" value="TM_Opera_O-Inwza555_Brute-force.com" placeholder="Bearer Token..." />
                </div>

                <div class="form-row">
                    <label class="form-label">Request Body (JSON Payload):</label>
                    <textarea id="post-body" class="code-editor" rows="10"></textarea>
                </div>

                <button type="button" class="btn btn--primary" id="btn-send-post" onclick="sendPostUpdate()">
                    🚀 ส่ง POST /update Request
                </button>

                <div id="post-result-wrap" style="margin-top:16px;display:none;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <strong style="font-size:0.85rem;">Full HTTP Response Result:</strong>
                        <span id="post-status-badge" class="pill"></span>
                    </div>
                    <pre id="post-result-json"></pre>
                </div>
            </div>

            <!-- Tab 2: GET Tester -->
            <div id="tab-get" class="tab-pane">
                <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">
                    ทดสอบยิงคำขอ GET ไปยัง API Endpoints ต่างๆ ของระบบ เพื่อดู Raw Response และ Header ที่ตอบกลับ
                </p>

                <div class="form-row">
                    <label class="form-label">เลือก Endpoint ที่ต้องการทดสอบ:</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
                        <button type="button" class="btn" onclick="setGetUrl('/status?device_id=ESP32-01')">📡 GET /status</button>
                        <button type="button" class="btn" onclick="setGetUrl('/summary?device_id=ESP32-01')">📊 GET /summary</button>
                        <button type="button" class="btn" onclick="setGetUrl('/history?device_id=ESP32-01&limit=10')">📜 GET /history</button>
                        <button type="button" class="btn" onclick="setGetUrl('/health')">💚 GET /health</button>
                    </div>
                    <input type="text" id="get-url" class="text-input" value="/status?device_id=ESP32-01" />
                </div>

                <button type="button" class="btn btn--primary" onclick="sendGetRequest()">
                    🔍 ส่ง GET Request
                </button>

                <div id="get-result-wrap" style="margin-top:16px;display:none;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <strong style="font-size:0.85rem;">Full HTTP Response Result:</strong>
                        <span id="get-status-badge" class="pill"></span>
                    </div>
                    <pre id="get-result-json"></pre>
                </div>
            </div>

            <!-- Tab: ห้องทดลอง (Latency / N/A / CSV) -->
            <div id="tab-lab" class="tab-pane">
                <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">
                    ช่วยเก็บข้อมูลการทดลองที่ 4 (ความหน่วง) และ 5 (N/A): ยิง <code>GET /status</code> ซ้ำอัตโนมัติ วัดเวลา fetch (ms) อายุข้อมูลฝั่งเซิร์ฟเวอร์ และจับเวลาตั้งแต่กดปุ่มจนสถานะเปลี่ยน
                    ค่าที่ได้มีความละเอียดเท่ากับช่วง polling จึงควรเลือก 2 วินาทีเมื่อวัดความหน่วง
                </p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
                    <input type="text" id="lab-device" class="text-input" style="width:150px;margin-bottom:0;" value="ESP32-01" />
                    <select id="lab-interval" class="text-input" style="width:120px;margin-bottom:0;">
                        <option value="2000" selected>ทุก 2 วินาที</option>
                        <option value="5000">ทุก 5 วินาที</option>
                        <option value="10000">ทุก 10 วินาที</option>
                    </select>
                    <button type="button" class="btn btn--primary" id="lab-toggle" onclick="labToggle()">▶ เริ่ม</button>
                    <button type="button" class="btn" onclick="labClear()">🗑 ล้าง</button>
                    <button type="button" class="btn" onclick="labExportCsv()">⬇ CSV (ผล polling)</button>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
                    <div class="diag-item"><div class="diag-label">สถานะล่าสุด</div><div class="diag-val" id="lab-status">-</div></div>
                    <div class="diag-item"><div class="diag-label">เวลา fetch ล่าสุด (ms)</div><div class="diag-val" id="lab-rtt">-</div></div>
                    <div class="diag-item"><div class="diag-label">อายุข้อมูล (วินาที, ตามเซิร์ฟเวอร์)</div><div class="diag-val" id="lab-age">-</div></div>
                    <div class="diag-item"><div class="diag-label">เซนเซอร์</div><div class="diag-val" id="lab-sensors" style="font-size:0.8rem;">-</div></div>
                </div>

                <strong style="font-size:0.85rem;">สถิติเวลา fetch (ms)</strong>
                <div id="lab-rtt-stats" style="font-size:0.85rem;margin:6px 0 16px;color:var(--text-secondary);">ยังไม่มีข้อมูล</div>

                <strong style="font-size:0.85rem;">จับเวลาความหน่วง / N/A</strong>
                <p style="color:var(--text-secondary);font-size:0.8rem;margin:4px 0 8px;">
                    กดปุ่ม <u>พร้อมกับ</u> การสลับโหลดจริง (หรือถอดไฟ ESP32) จับเวลาจะหยุดเองเมื่อหน้าเว็บเห็นสถานะเปลี่ยน ต้องกด "เริ่ม" polling ก่อน
                </p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
                    <select id="lab-sensor" class="text-input" style="width:150px;margin-bottom:0;"></select>
                    <button type="button" class="btn" onclick="labWatch('on')">⏱ เปลี่ยนเป็น ON</button>
                    <button type="button" class="btn" onclick="labWatch('off')">⏱ เปลี่ยนเป็น OFF</button>
                    <button type="button" class="btn" onclick="labWatch('na')">⏱ ถอดไฟ → N/A</button>
                    <span id="lab-watch-msg" style="font-size:0.85rem;color:var(--accent);"></span>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead><tr><th>รายการ</th><th>ค่าที่วัดได้ (วินาที)</th><th>n</th><th>เฉลี่ย</th><th>SD</th><th>P50</th><th>P95</th></tr></thead>
                        <tbody id="lab-lat-body"></tbody>
                    </table>
                </div>
            </div>

            <!-- Tab 3: D1 SQL Query Runner -->
            <div id="tab-sql" class="tab-pane">
                <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">
                    รันคำสั่ง SQL <code>SELECT</code> เพื่อตรวจสอบโครงสร้างและข้อมูลใน Cloudflare D1 Database ได้แบบเรียลไทม์
                </p>

                <div class="form-row">
                    <label class="form-label">คำสั่ง SQL ด่วน (Quick Templates):</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                        <button type="button" class="btn" onclick="setSql('SELECT * FROM latest_status')">latest_status</button>
                        <button type="button" class="btn" onclick="setSql('SELECT * FROM readings ORDER BY id DESC LIMIT 10')">readings ล่าสุด 10 แถว</button>
                        <button type="button" class="btn" onclick="setSql('SELECT sensor_id, COUNT(*) as count, ROUND(AVG(power_mw),1) as avg_mw FROM readings GROUP BY sensor_id')">สถิติกำลังไฟแยกเซนเซอร์</button>
                        <button type="button" class="btn" onclick="setSql('SELECT * FROM devices')">devices</button>
                    </div>
                    <textarea id="sql-input" class="code-editor" rows="3">SELECT * FROM latest_status</textarea>
                </div>

                <button type="button" class="btn btn--primary" onclick="runSqlQuery()">
                    ⚡ รันคำสั่ง SQL บน D1
                </button>

                <div id="sql-result-wrap" style="margin-top:16px;display:none;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <strong style="font-size:0.85rem;">ผลลัพธ์คำสั่ง SQL:</strong>
                        <span id="sql-status-badge" class="pill pill-on"></span>
                    </div>
                    <div id="sql-table-container"></div>
                </div>
            </div>

            <!-- Tab 4: System Actions & Maintenance -->
            <div id="tab-actions" class="tab-pane">
                <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:16px;">
                    เครื่องมือบำรุงรักษาและทดสอบส่วนประกอบระบบภายนอก
                </p>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;">
                    <div class="diag-item">
                        <h4 style="font-size:0.95rem;margin-bottom:6px;color:#fff;">🔔 ทดสอบส่งข้อความแจ้งเตือนเข้า LINE</h4>
                        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;">
                            ทดสอบการเชื่อมต่อกับ LINE Messaging API Broadcast ทันทีโดยไม่ต้องรอรอบ Cron 16:10 น.
                        </p>
                        <button type="button" class="btn btn--success" onclick="triggerAction('test_line')">
                            📲 ส่งข้อความทดสอบเข้า LINE
                        </button>
                    </div>

                    <div class="diag-item">
                        <h4 style="font-size:0.95rem;margin-bottom:6px;color:#fff;">🧹 ล้างข้อมูลประวัติเก่า (Prune Old Readings)</h4>
                        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;">
                            ลบข้อมูลในตาราง <code>readings</code> ที่เก่าเกินกำหนดเพื่อประหยัดพื้นที่จัดเก็บบน D1
                        </p>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <input type="number" id="prune-days" class="text-input" style="width:80px;margin-bottom:0;" value="7" min="1" max="90" />
                            <span style="font-size:0.85rem;color:var(--text-secondary);">วัน</span>
                            <button type="button" class="btn btn--danger" onclick="triggerPrune()">
                                🗑️ ลบข้อมูลเก่า
                            </button>
                        </div>
                    </div>
                </div>

                <div id="action-result-box" style="margin-top:16px;display:none;padding:12px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border);"></div>
            </div>

            <!-- Tab 5: Quota & Backup/Restore -->
            <div id="tab-quota" class="tab-pane">
                <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:16px;">
                    ติดตามการใช้งานพื้นที่ Cloudflare D1 Database (โควต้าฟรี 5 GB), ส่งสัญญาณเตือนเข้า LINE, และเครื่องมือ Backup / Restore ข้อมูล
                </p>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:20px;">
                    <div class="diag-item">
                        <h4 style="font-size:0.95rem;margin-bottom:6px;color:#fff;">📊 พื้นที่จัดเก็บ D1 Database (Free Tier 5 GB)</h4>
                        <div style="font-size:1.6rem;font-weight:700;color:var(--accent);margin:8px 0;" id="quota-size-display">
                            ~${quotaInfo.estimated_size_mb} MB <span style="font-size:0.9rem;color:var(--text-secondary);font-weight:400;">/ 5,120 MB</span>
                        </div>
                        <div style="background:#070a13;border-radius:6px;height:10px;overflow:hidden;margin-bottom:8px;border:1px solid var(--border);">
                            <div id="quota-bar" style="height:100%;width:${Math.min(quotaInfo.usage_percent, 100)}%;background:${quotaInfo.usage_percent >= 80 ? 'var(--danger)' : 'var(--success)'};transition:width 0.3s;"></div>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-secondary);">
                            <span>ใช้ไป: <strong>${quotaInfo.usage_percent}%</strong></span>
                            <span>สถานะ: <strong style="color:${quotaInfo.usage_percent >= 80 ? 'var(--danger)' : 'var(--success)'};">${quotaInfo.usage_percent >= 80 ? '⚠️ ควรเคลียร์ข้อมูล' : '✅ ปกติ'}</strong></span>
                        </div>
                    </div>

                    <div class="diag-item">
                        <h4 style="font-size:0.95rem;margin-bottom:6px;color:#fff;">📅 ช่วงเวลาข้อมูลโทรมาตร</h4>
                        <div style="font-size:0.85rem;margin-top:10px;line-height:1.7;">
                            <div>📌 ข้อมูลเก่าที่สุด: <code>${escapeHtml(quotaInfo.oldest_reading ?? "ไม่มีข้อมูล")}</code></div>
                            <div>📌 ข้อมูลล่าสุด: <code>${escapeHtml(quotaInfo.newest_reading ?? "ไม่มีข้อมูล")}</code></div>
                            <div>📈 ข้อมูลทั้งหมด: <strong>${quotaInfo.readings_count.toLocaleString()} แถว</strong></div>
                        </div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
                    <div class="diag-item">
                        <h4 style="font-size:0.95rem;margin-bottom:6px;color:#fff;">🔔 ส่งแจ้งเตือน Quota เข้า LINE</h4>
                        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;">
                            ทดสอบยิงข้อความแจ้งเตือนสถานะพื้นที่ D1 เข้า LINE ทันที (จำลองการแจ้งเตือนเมื่อพื้นที่ใกล้เต็ม)
                        </p>
                        <button type="button" class="btn btn--primary" onclick="triggerAction('alert_quota')">
                            📲 ส่ง Quota Alert เข้า LINE
                        </button>
                    </div>

                    <div class="diag-item">
                        <h4 style="font-size:0.95rem;margin-bottom:6px;color:#fff;">📥 สำรองข้อมูล (JSON Backup Export)</h4>
                        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;">
                            ดาวน์โหลดข้อมูลโทรมาตรย้อนหลังจาก D1 เก็บไว้ในคอมพิวเตอร์เป็นไฟล์ JSON
                        </p>
                        <div style="display:flex;gap:8px;">
                            <input type="number" id="backup-limit" class="text-input" style="width:100px;margin-bottom:0;" value="5000" min="100" max="50000" />
                            <button type="button" class="btn btn--success" onclick="downloadBackup()">
                                💾 ดาวน์โหลด Backup
                            </button>
                        </div>
                    </div>

                    <div class="diag-item">
                        <h4 style="font-size:0.95rem;margin-bottom:6px;color:#fff;">📤 กู้คืนข้อมูล (JSON Restore Import)</h4>
                        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;">
                            นำเข้าไฟล์ Backup JSON เพื่อเติมข้อมูลกลับสู่ตาราง <code>readings</code>
                        </p>
                        <input type="file" id="restore-file" accept=".json" class="text-input" style="margin-bottom:8px;" />
                        <button type="button" class="btn btn--warning" onclick="uploadRestore()">
                            🚀 กู้คืนข้อมูลเข้า D1
                        </button>
                    </div>
                </div>

                <div id="quota-result-box" style="margin-top:16px;display:none;padding:12px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border);"></div>
            </div>
        </section>


        <!-- Environment & Secrets Audit Card -->
        <section class="card">
            <div class="card-header">
                <div class="card-title">
                    <span>🔐 ตรวจสอบตัวแปรสภาพแวดล้อมและความปลอดภัย (Environment & Secrets)</span>
                </div>
                <span class="meta-tag">Worker Bindings</span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ชื่อตัวแปร (Variable / Secret)</th>
                            <th>ประเภท</th>
                            <th>สถานะการตั้งค่า</th>
                            <th>คำอธิบาย</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><code>DEVICE_TOKEN</code></td>
                            <td>Secret</td>
                            <td>${maskSecret(env.DEVICE_TOKEN)}</td>
                            <td>รหัสผ่าน Bearer token สำหรับ ESP32 ยิงเข้า <code>POST /update</code></td>
                        </tr>
                        <tr>
                            <td><code>ADMIN_USERNAME</code></td>
                            <td>Variable</td>
                            <td><code>${escapeHtml(env.ADMIN_USERNAME || "admin")}</code></td>
                            <td>ชื่อผู้ใช้สำหรับเข้าสู่ระบบ Admin Console</td>
                        </tr>
                        <tr>
                            <td><code>ADMIN_PASSWORD</code></td>
                            <td>Secret</td>
                            <td>${maskSecret(env.ADMIN_PASSWORD)}</td>
                            <td>รหัสผ่านสำหรับยืนยันตัวตน Basic Auth หน้า <code>/admin</code></td>
                        </tr>
                        <tr>
                            <td><code>LINE_ACCESS_TOKEN</code></td>
                            <td>Secret</td>
                            <td>${maskSecret(env.LINE_ACCESS_TOKEN || env.LINE_CHANNEL_ACCESS_TOKEN)}</td>
                            <td>Token สำหรับส่งสรุปการใช้พลังงานผ่าน LINE Messaging API</td>
                        </tr>
                        <tr>
                            <td><code>DB</code></td>
                            <td>D1 Binding</td>
                            <td><span class="badge-configured">เชื่อมต่อแล้ว (appliance-db)</span></td>
                            <td>ฐานข้อมูล Cloudflare D1 เก็บสถานะล่าสุดและประวัติโทรมาตร</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Live Device Status Table -->
        <section class="card">
            <div class="card-header">
                <div class="card-title">
                    <span>📦 อุปกรณ์และสถานะล่าสุด (Latest Device Status)</span>
                </div>
                <span class="meta-tag">ตาราง latest_status</span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Device ID</th>
                            <th>อัปเดตล่าสุด (UTC)</th>
                            <th>ข้อมูลเซนเซอร์ (Sensors JSON Payload)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            latestStatusRows.length === 0
                                ? '<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);padding:24px;">ยังไม่มีข้อมูลอุปกรณ์ส่งเข้ามา</td></tr>'
                                : latestStatusRows
                                      .map(
                                          (row) => `
                        <tr>
                            <td><strong>${escapeHtml(row.device_id)}</strong></td>
                            <td>${escapeHtml(row.updated_at)}</td>
                            <td><code>${escapeHtml(row.sensors_json)}</code></td>
                        </tr>`
                                      )
                                      .join("")
                        }
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Recent Readings Table -->
        <section class="card">
            <div class="card-header">
                <div class="card-title">
                    <span>📜 บันทึกโทรมาตรล่าสุด 25 รายการ (Recent Readings Log)</span>
                </div>
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
                            <th>การเชื่อมต่อ</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            recentReadings.length === 0
                                ? '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:24px;">ยังไม่มีบันทึกข้อมูล</td></tr>'
                                : recentReadings
                                      .map(
                                          (r) => `
                        <tr>
                            <td>#${r.id}</td>
                            <td>${escapeHtml(r.created_at)}</td>
                            <td><strong>${escapeHtml(r.sensor_id)}</strong></td>
                            <td>${r.voltage_v !== null ? r.voltage_v.toFixed(2) : "-"} V</td>
                            <td>${r.current_ma !== null ? r.current_ma.toFixed(1) : "-"} mA</td>
                            <td>${r.power_mw !== null ? r.power_mw.toFixed(1) : "-"} mW</td>
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

    <!-- Interactive Client Script -->
    <script>
        function switchTab(tabId) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('is-active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('is-active'));
            event.target.classList.add('is-active');
            document.getElementById(tabId).classList.add('is-active');
        }

        const presets = {
            both_on: {
                device_id: "ESP32-01",
                sensors: [
                    { sensor_id: "INA219-01", voltage_v: 5.12, current_ma: 340.5, power_mw: 1743.3, is_on: true, ok: true },
                    { sensor_id: "INA219-02", voltage_v: 5.08, current_ma: 180.2, power_mw: 915.4, is_on: true, ok: true }
                ]
            },
            ch1_on: {
                device_id: "ESP32-01",
                sensors: [
                    { sensor_id: "INA219-01", voltage_v: 5.15, current_ma: 280.0, power_mw: 1442.0, is_on: true, ok: true },
                    { sensor_id: "INA219-02", voltage_v: 5.05, current_ma: 0.0, power_mw: 0.0, is_on: false, ok: true }
                ]
            },
            both_off: {
                device_id: "ESP32-01",
                sensors: [
                    { sensor_id: "INA219-01", voltage_v: 5.18, current_ma: 0.0, power_mw: 0.0, is_on: false, ok: true },
                    { sensor_id: "INA219-02", voltage_v: 5.18, current_ma: 0.0, power_mw: 0.0, is_on: false, ok: true }
                ]
            },
            fault: {
                device_id: "ESP32-01",
                sensors: [
                    { sensor_id: "INA219-01", voltage_v: 5.12, current_ma: 250.0, power_mw: 1280.0, is_on: true, ok: true },
                    { sensor_id: "INA219-02", voltage_v: 0.0, current_ma: 0.0, power_mw: 0.0, is_on: false, ok: false }
                ]
            },
            invalid: {
                device_id: "ESP32-01",
                sensors: [
                    { sensor_id: "INA219-01", voltage_v: null, current_ma: "NaN", is_on: "maybe" }
                ]
            }
        };

        function loadPreset(key) {
            document.getElementById('post-body').value = JSON.stringify(presets[key], null, 2);
        }
        loadPreset('both_on');

        async function sendPostUpdate() {
            const btn = document.getElementById('btn-send-post');
            const token = document.getElementById('post-token').value.trim();
            const bodyStr = document.getElementById('post-body').value.trim();
            const resultWrap = document.getElementById('post-result-wrap');
            const badge = document.getElementById('post-status-badge');
            const resultJson = document.getElementById('post-result-json');

            btn.disabled = true;
            btn.textContent = "⏳ กำลังส่งคำขอ...";
            const start = performance.now();

            try {
                const res = await fetch('/update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: bodyStr
                });
                const duration = Math.round(performance.now() - start);
                const data = await res.json();

                resultWrap.style.display = 'block';
                badge.className = 'pill ' + (res.ok ? 'pill-on' : 'pill-error');
                badge.textContent = 'HTTP ' + res.status + ' (' + duration + ' ms)';
                resultJson.textContent = JSON.stringify(data, null, 2);
            } catch (err) {
                resultWrap.style.display = 'block';
                badge.className = 'pill pill-error';
                badge.textContent = 'Network Error';
                resultJson.textContent = String(err);
            } finally {
                btn.disabled = false;
                btn.textContent = "🚀 ส่ง POST /update Request";
            }
        }

        // ===== ห้องทดลอง: วัดเวลา fetch / ความหน่วง / N/A =====
        const lab = { timer: null, log: [], rtts: [], watch: null, lat: { on: [], off: [], na: [] }, sensorIds: [], last: null };

        function labPercentile(arr, p) {
            if (!arr.length) return null;
            const a = arr.slice().sort((x, y) => x - y);
            const k = (a.length - 1) * p, f = Math.floor(k), c = Math.min(f + 1, a.length - 1);
            return a[f] + (a[c] - a[f]) * (k - f);
        }
        function labStats(arr) {
            const n = arr.length;
            if (!n) return null;
            const mean = arr.reduce((s, x) => s + x, 0) / n;
            const sd = n > 1 ? Math.sqrt(arr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1)) : 0;
            return { n: n, mean: mean, sd: sd, p50: labPercentile(arr, 0.5), p95: labPercentile(arr, 0.95), min: Math.min.apply(null, arr), max: Math.max.apply(null, arr) };
        }
        function labFmt(x, d) { return x === null || x === undefined ? '-' : x.toFixed(d); }

        function labRender() {
            const s = labStats(lab.rtts);
            document.getElementById('lab-rtt-stats').textContent = s
                ? 'n=' + s.n + '  เฉลี่ย=' + labFmt(s.mean, 0) + '  min=' + labFmt(s.min, 0) + '  max=' + labFmt(s.max, 0) + '  P50=' + labFmt(s.p50, 0) + '  P95=' + labFmt(s.p95, 0)
                : 'ยังไม่มีข้อมูล';
            const names = { on: 'เปลี่ยนเป็น ON', off: 'เปลี่ยนเป็น OFF', na: 'ถอดไฟ → N/A' };
            let html = '';
            ['on', 'off', 'na'].forEach(function (k) {
                const st = labStats(lab.lat[k]);
                html += '<tr><td>' + names[k] + '</td><td>' + (lab.lat[k].map(function (x) { return x.toFixed(1); }).join(', ') || '-') + '</td><td>' + (st ? st.n : 0) +
                    '</td><td>' + (st ? labFmt(st.mean, 2) : '-') + '</td><td>' + (st ? labFmt(st.sd, 2) : '-') + '</td><td>' + (st ? labFmt(st.p50, 2) : '-') + '</td><td>' + (st ? labFmt(st.p95, 2) : '-') + '</td></tr>';
            });
            document.getElementById('lab-lat-body').innerHTML = html;
        }

        function labWatch(kind) {
            if (!lab.timer) { alert('กด "เริ่ม" polling ก่อน'); return; }
            const sel = document.getElementById('lab-sensor').value;
            if (kind !== 'na' && lab.last) {
                const sn = (lab.last.sensors || []).find(function (x) { return x.sensor_id === sel; });
                if (sn && sn.ok && sn.is_on === (kind === 'on')) { alert('สถานะตอนนี้เป็น ' + kind.toUpperCase() + ' อยู่แล้ว ให้กดตอนที่สถานะตรงข้ามกับเป้าหมาย'); return; }
            }
            if (kind === 'na' && lab.last && (lab.last.status === 'N/A' || lab.last.is_stale)) { alert('ตอนนี้เป็น N/A อยู่แล้ว'); return; }
            lab.watch = { kind: kind, sensor: sel, start: performance.now() };
            document.getElementById('lab-watch-msg').textContent = '⏳ กำลังจับเวลา (' + kind.toUpperCase() + ')...';
        }

        function labCheckWatch(data) {
            const w = lab.watch;
            if (!w || !data) return;
            let hit = false;
            if (w.kind === 'na') {
                hit = data.status === 'N/A' || data.is_stale === true;
            } else if (data.status !== 'N/A' && !data.is_stale) {
                const sn = (data.sensors || []).find(function (x) { return x.sensor_id === w.sensor; });
                hit = !!(sn && sn.ok && sn.is_on === (w.kind === 'on'));
            }
            if (hit) {
                const sec = (performance.now() - w.start) / 1000;
                lab.lat[w.kind].push(sec);
                lab.watch = null;
                document.getElementById('lab-watch-msg').textContent = '✅ ' + w.kind.toUpperCase() + ' = ' + sec.toFixed(1) + ' วินาที';
                labRender();
            }
        }

        async function labPoll() {
            const dev = document.getElementById('lab-device').value.trim() || 'ESP32-01';
            const t0 = performance.now();
            const row = { time: new Date().toISOString(), http: '', rtt_ms: '', status: '', age_s: '', sensors: '' };
            let data = null;
            try {
                const res = await fetch('/status?device_id=' + encodeURIComponent(dev), { cache: 'no-store' });
                row.rtt_ms = Math.round(performance.now() - t0);
                row.http = res.status;
                data = await res.json();
                row.status = data.status || '';
                row.age_s = typeof data.stale_seconds === 'number' ? data.stale_seconds : '';
                const src = (data.sensors && data.sensors.length) ? data.sensors : (data.last_known_sensors || []);
                row.sensors = src.map(function (x) { return x.sensor_id + '=' + (x.ok ? (x.is_on ? 'ON' : 'OFF') : 'FAULT') + ':' + (x.current_ma !== undefined ? Number(x.current_ma).toFixed(1) : ''); }).join(' ');
                if (res.ok) lab.rtts.push(row.rtt_ms);
                lab.last = data;
                const ids = (data.sensors || []).map(function (x) { return x.sensor_id; });
                if (ids.length && ids.join() !== lab.sensorIds.join()) {
                    lab.sensorIds = ids;
                    document.getElementById('lab-sensor').innerHTML = ids.map(function (id) { return '<option value="' + id + '">' + id + '</option>'; }).join('');
                }
            } catch (err) {
                row.status = 'ERROR';
                row.http = 'ERR';
            }
            lab.log.push(row);
            document.getElementById('lab-status').textContent = row.status || '-';
            document.getElementById('lab-rtt').textContent = row.rtt_ms === '' ? '-' : row.rtt_ms;
            document.getElementById('lab-age').textContent = row.age_s === '' ? '-' : row.age_s;
            document.getElementById('lab-sensors').textContent = row.sensors || '-';
            labCheckWatch(data);
            labRender();
        }

        function labToggle() {
            const btn = document.getElementById('lab-toggle');
            if (lab.timer) {
                clearInterval(lab.timer); lab.timer = null; btn.textContent = '▶ เริ่ม';
            } else {
                labPoll();
                lab.timer = setInterval(labPoll, parseInt(document.getElementById('lab-interval').value, 10));
                btn.textContent = '⏹ หยุด';
            }
        }

        function labClear() {
            lab.log = []; lab.rtts = []; lab.lat = { on: [], off: [], na: [] }; lab.watch = null;
            document.getElementById('lab-watch-msg').textContent = '';
            labRender();
        }

        function labExportCsv() {
            if (!lab.log.length) { alert('ยังไม่มีข้อมูล'); return; }
            const cols = ['time', 'http', 'rtt_ms', 'status', 'age_s', 'sensors'];
            const lines = [cols.join(',')].concat(lab.log.map(function (r) { return cols.map(function (c) { return '"' + String(r[c]).replace(/"/g, '""') + '"'; }).join(','); }));
            const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'lab-polling-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
            a.click();
            URL.revokeObjectURL(a.href);
        }
        labRender();

        function setGetUrl(url) {
            document.getElementById('get-url').value = url;
        }

        async function sendGetRequest() {
            const path = document.getElementById('get-url').value.trim();
            const resultWrap = document.getElementById('get-result-wrap');
            const badge = document.getElementById('get-status-badge');
            const resultJson = document.getElementById('get-result-json');

            const start = performance.now();
            try {
                const res = await fetch(path);
                const duration = Math.round(performance.now() - start);
                const data = await res.json();

                resultWrap.style.display = 'block';
                badge.className = 'pill ' + (res.ok ? 'pill-on' : 'pill-error');
                badge.textContent = 'HTTP ' + res.status + ' (' + duration + ' ms)';
                resultJson.textContent = JSON.stringify(data, null, 2);
            } catch (err) {
                resultWrap.style.display = 'block';
                badge.className = 'pill pill-error';
                badge.textContent = 'Network Error';
                resultJson.textContent = String(err);
            }
        }

        function setSql(q) {
            document.getElementById('sql-input').value = q;
        }

        async function runSqlQuery() {
            const query = document.getElementById('sql-input').value.trim();
            const resultWrap = document.getElementById('sql-result-wrap');
            const badge = document.getElementById('sql-status-badge');
            const container = document.getElementById('sql-table-container');

            try {
                const res = await fetch('/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'run_sql', query: query })
                });
                const data = await res.json();

                resultWrap.style.display = 'block';
                if (!res.ok || data.error) {
                    badge.className = 'pill pill-error';
                    badge.textContent = 'Error';
                    container.innerHTML = '<div style="color:var(--danger);padding:10px;">' + (data.error || 'Error running query') + '</div>';
                    return;
                }

                badge.className = 'pill pill-on';
                badge.textContent = 'สำเร็จ (' + (data.results?.length || 0) + ' แถว, ' + data.duration_ms + ' ms)';

                if (!data.results || data.results.length === 0) {
                    container.innerHTML = '<div style="color:var(--text-secondary);padding:12px;">ไม่พบข้อมูลตามเงื่อนไข (0 rows)</div>';
                    return;
                }

                const cols = Object.keys(data.results[0]);
                let tableHtml = '<div class="table-wrap"><table><thead><tr>';
                cols.forEach(c => tableHtml += '<th>' + c + '</th>');
                tableHtml += '</tr></thead><tbody>';

                data.results.forEach(row => {
                    tableHtml += '<tr>';
                    cols.forEach(c => {
                        const val = typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c];
                        tableHtml += '<td>' + (val ?? '<span style="color:var(--text-secondary)">NULL</span>') + '</td>';
                    });
                    tableHtml += '</tr>';
                });
                tableHtml += '</tbody></table></div>';
                container.innerHTML = tableHtml;
            } catch (err) {
                resultWrap.style.display = 'block';
                badge.className = 'pill pill-error';
                badge.textContent = 'Error';
                container.innerHTML = '<div style="color:var(--danger);padding:10px;">' + String(err) + '</div>';
            }
        }

        async function triggerAction(actionName) {
            const box = document.getElementById('action-result-box');
            const qbox = document.getElementById('quota-result-box');
            const targetBox = (actionName === 'alert_quota') ? (qbox || box) : box;
            if (targetBox) {
                targetBox.style.display = 'block';
                targetBox.innerHTML = '<span style="color:var(--accent);">⏳ กำลังดำเนินการ...</span>';
            }

            try {
                const res = await fetch('/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: actionName })
                });
                const data = await res.json();
                if (targetBox) {
                    if (res.ok && data.ok) {
                        targetBox.innerHTML = '<span style="color:var(--success);font-weight:600;">✓ ' + data.message + '</span>';
                    } else {
                        targetBox.innerHTML = '<span style="color:var(--danger);font-weight:600;">✕ ' + (data.error || data.message || 'เกิดข้อผิดพลาด') + '</span>';
                    }
                }
            } catch (err) {
                if (targetBox) {
                    targetBox.innerHTML = '<span style="color:var(--danger);">✕ ' + String(err) + '</span>';
                }
            }
        }

        async function downloadBackup() {
            const limit = parseInt(document.getElementById('backup-limit').value, 10) || 5000;
            const qbox = document.getElementById('quota-result-box');
            qbox.style.display = 'block';
            qbox.innerHTML = '<span style="color:var(--accent);">⏳ กำลังเตรียมไฟล์สำรองข้อมูล (Exporting ' + limit + ' rows)...</span>';

            try {
                const res = await fetch('/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'export_backup', limit: limit })
                });
                const data = await res.json();
                if (res.ok && data.ok) {
                    const jsonStr = JSON.stringify(data.backup, null, 2);
                    const blob = new Blob([jsonStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'd1_backup_' + new Date().toISOString().slice(0, 10) + '.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    qbox.innerHTML = '<span style="color:var(--success);font-weight:600;">✓ ดาวน์โหลดไฟล์ Backup สำเร็จ (' + data.backup.readings.length + ' readings)!</span>';
                } else {
                    qbox.innerHTML = '<span style="color:var(--danger);font-weight:600;">✕ ' + (data.error || 'เกิดข้อผิดพลาดในการ Export') + '</span>';
                }
            } catch (err) {
                qbox.innerHTML = '<span style="color:var(--danger);">✕ ' + String(err) + '</span>';
            }
        }

        async function uploadRestore() {
            const fileInput = document.getElementById('restore-file');
            const qbox = document.getElementById('quota-result-box');
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('โปรดเลือกไฟล์ JSON backup ก่อน');
                return;
            }

            const file = fileInput.files[0];
            if (!confirm('ยืนยันที่จะนำเข้าข้อมูลจากไฟล์ ' + file.name + ' หรือไม่?')) return;

            qbox.style.display = 'block';
            qbox.innerHTML = '<span style="color:var(--accent);">⏳ กำลังอ่านและประมวลผลไฟล์...</span>';

            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const parsed = JSON.parse(e.target.result);
                    const readings = Array.isArray(parsed) ? parsed : (parsed.readings || []);
                    if (!readings || readings.length === 0) {
                        qbox.innerHTML = '<span style="color:var(--danger);">✕ ไม่พบข้อมูล readings ในไฟล์ JSON นี้</span>';
                        return;
                    }

                    qbox.innerHTML = '<span style="color:var(--accent);">⏳ กำลังนำเข้าข้อมูล ' + readings.length + ' รายการเข้า D1...</span>';

                    const res = await fetch('/admin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'import_restore', readings: readings })
                    });
                    const data = await res.json();
                    if (res.ok && data.ok) {
                        qbox.innerHTML = '<span style="color:var(--success);font-weight:600;">✓ ' + data.message + '</span>';
                    } else {
                        qbox.innerHTML = '<span style="color:var(--danger);font-weight:600;">✕ ' + (data.error || 'การนำเข้าล้มเหลว') + '</span>';
                    }
                } catch (parseErr) {
                    qbox.innerHTML = '<span style="color:var(--danger);">✕ รูปแบบไฟล์ JSON ไม่ถูกต้อง: ' + String(parseErr) + '</span>';
                }
            };
            reader.readAsText(file);
        }

        async function triggerPrune() {
            const days = parseInt(document.getElementById('prune-days').value, 10) || 7;
            if (!confirm('ยืนยันที่จะลบข้อมูล readings ที่เก่าเกิน ' + days + ' วัน หรือไม่?')) return;

            const box = document.getElementById('action-result-box');
            box.style.display = 'block';
            box.innerHTML = '<span style="color:var(--accent);">⏳ กำลังล้างข้อมูลเก่า...</span>';

            try {
                const res = await fetch('/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'prune', days: days })
                });
                const data = await res.json();
                if (res.ok && data.ok) {
                    box.innerHTML = '<span style="color:var(--success);font-weight:600;">✓ ' + data.message + '</span>';
                } else {
                    box.innerHTML = '<span style="color:var(--danger);font-weight:600;">✕ ' + (data.error || 'เกิดข้อผิดพลาด') + '</span>';
                }
            } catch (err) {
                box.innerHTML = '<span style="color:var(--danger);">✕ ' + String(err) + '</span>';
            }
        }

    </script>
</body>
</html>`;

    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
        },
    });
}
