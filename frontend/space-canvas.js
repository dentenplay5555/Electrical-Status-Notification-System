/**
 * Cosmic Interactive Starfield & Celestial Physics
 * ระบบอวกาศและดาวแบบโต้ตอบได้ (Stars, Constellations, Gravity, Black Hole & Big Bang)
 */

(function () {
    const canvas = document.createElement("canvas");
    canvas.id = "space-canvas";
    canvas.className = "space-canvas";
    document.body.prepend(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Config & Modes
    const config = {
        starCount: Math.min(160, Math.floor((width * height) / 8000)),
        maxConnectDist: 110,
        mouseGravityRadius: 180,
        mouseGravityStrength: 0.15,
        nebulaCount: 4,
        showConstellations: true,
        warpSpeed: 1,
    };

    // State
    const mouse = {
        x: -9999,
        y: -9999,
        isDown: false,
        draggedStar: null,
        rightDown: false,
    };

    let blackHole = null; // { x, y, radius: 24, mass: 800, angle: 0, active: false }
    let shockwaves = [];
    let explosionParticles = [];
    let nebulae = [];
    let isBigBanging = false;

    // Web Audio API Synthesizer for Space FX (Zero external file dependencies)
    let audioCtx = null;
    function getAudio() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) audioCtx = new AudioContextClass();
        }
        if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playSound(type) {
        try {
            const actx = getAudio();
            if (!actx) return;

            if (type === "spawn") {
                const osc = actx.createOscillator();
                const gain = actx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(440 + Math.random() * 300, actx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(880 + Math.random() * 200, actx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.04, actx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.2);
                osc.connect(gain);
                gain.connect(actx.destination);
                osc.start();
                osc.stop(actx.currentTime + 0.2);
            } else if (type === "bigbang") {
                // Rumble + explosion whoosh
                const osc = actx.createOscillator();
                const gain = actx.createGain();
                osc.type = "triangle";
                osc.frequency.setValueAtTime(160, actx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(35, actx.currentTime + 1.2);
                gain.gain.setValueAtTime(0.3, actx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 1.5);
                osc.connect(gain);
                gain.connect(actx.destination);
                osc.start();
                osc.stop(actx.currentTime + 1.5);
            } else if (type === "blackhole") {
                const osc = actx.createOscillator();
                const gain = actx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(80, actx.currentTime);
                osc.frequency.linearRampToValueAtTime(140, actx.currentTime + 0.8);
                gain.gain.setValueAtTime(0.08, actx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.9);
                osc.connect(gain);
                gain.connect(actx.destination);
                osc.start();
                osc.stop(actx.currentTime + 0.9);
            }
        } catch {
            // Audio not allowed or blocked
        }
    }

    // Colors
    const STAR_PALETTE = [
        { r: 0, g: 240, b: 255 },   // Cyan
        { r: 168, g: 85, b: 247 },  // Purple / Nebula
        { r: 251, g: 191, b: 36 },  // Golden Starlight
        { r: 255, g: 255, b: 255 }, // Brilliant White
        { r: 56, g: 189, b: 248 },  // Electric Sky Blue
        { r: 244, g: 63, b: 94 },   // Supernova Crimson
    ];

    class Star {
        constructor(x, y, vx, vy, radius, color) {
            this.x = x !== undefined ? x : Math.random() * width;
            this.y = y !== undefined ? y : Math.random() * height;
            this.vx = vx !== undefined ? vx : (Math.random() - 0.5) * 0.7;
            this.vy = vy !== undefined ? vy : (Math.random() - 0.5) * 0.7;
            this.baseRadius = radius !== undefined ? radius : Math.random() * 2.2 + 0.8;
            this.radius = this.baseRadius;
            this.color = color || STAR_PALETTE[Math.floor(Math.random() * STAR_PALETTE.length)];
            this.twinkleSpeed = Math.random() * 0.04 + 0.01;
            this.twinklePhase = Math.random() * Math.PI * 2;
            this.mass = this.baseRadius * 1.5;
            this.trail = [];
            this.isAlive = true;
        }

        update() {
            this.twinklePhase += this.twinkleSpeed;
            const twinkle = Math.sin(this.twinklePhase) * 0.35 + 0.85;

            // Follow drag
            if (mouse.draggedStar === this) {
                const dx = mouse.x - this.x;
                const dy = mouse.y - this.y;
                this.vx = dx * 0.15;
                this.vy = dy * 0.15;
            } else {
                // Interactive mouse gravitational pull / push
                const dx = mouse.x - this.x;
                const dy = mouse.y - this.y;
                const dist = Math.hypot(dx, dy);

                if (dist > 5 && dist < config.mouseGravityRadius) {
                    const force = (1 - dist / config.mouseGravityRadius) * config.mouseGravityStrength;
                    if (mouse.isDown) {
                        // Mouse down: strong attraction to cursor
                        this.vx += (dx / dist) * force * 1.8;
                        this.vy += (dy / dist) * force * 1.8;
                    } else {
                        // Hover: gentle cosmic orbit swirl
                        this.vx += (dx / dist) * force * 0.35 + (-dy / dist) * force * 0.25;
                        this.vy += (dy / dist) * force * 0.35 + (dx / dist) * force * 0.25;
                    }
                }

                // Black Hole Gravitational Pull
                if (blackHole && blackHole.active) {
                    const bhDx = blackHole.x - this.x;
                    const bhDy = blackHole.y - this.y;
                    const bhDist = Math.hypot(bhDx, bhDy);

                    if (bhDist < blackHole.radius * 0.65) {
                        // Swallowed into the singularity!
                        this.isAlive = false;
                        spawnAccretionJet(this.x, this.y, this.color);
                    } else if (bhDist < 380) {
                        // Strong gravitational warping + vortex spiral
                        const gravity = (blackHole.mass / (bhDist * bhDist)) * 0.45;
                        const spiralStrength = gravity * 0.85;
                        this.vx += (bhDx / bhDist) * gravity + (-bhDy / bhDist) * spiralStrength;
                        this.vy += (bhDy / bhDist) * gravity + (bhDx / bhDist) * spiralStrength;
                    }
                }
            }

            // Damping & Position Update
            this.vx *= 0.985;
            this.vy *= 0.985;
            this.x += this.vx * config.warpSpeed;
            this.y += this.vy * config.warpSpeed;

            // Screen boundary wrapping
            if (this.x < -20) this.x = width + 20;
            if (this.x > width + 20) this.x = -20;
            if (this.y < -20) this.y = height + 20;
            if (this.y > height + 20) this.y = -20;

            this.currentRadius = this.baseRadius * twinkle;
        }

        draw(ctx) {
            const { r, g, b } = this.color;
            ctx.save();

            // Glow aura
            const grad = ctx.createRadialGradient(
                this.x,
                this.y,
                0,
                this.x,
                this.y,
                this.currentRadius * 3.8
            );
            grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.9)`);
            grad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.3)`);
            grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.currentRadius * 3.8, 0, Math.PI * 2);
            ctx.fill();

            // Star Core
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    }

    let stars = [];

    function initStars() {
        stars = [];
        for (let i = 0; i < config.starCount; i++) {
            stars.push(new Star());
        }

        // Init Cosmic Nebulae
        nebulae = [];
        const nebulaColors = [
            { r: 88, g: 28, b: 135, a: 0.12 },  // Deep Indigo
            { r: 14, g: 116, b: 144, a: 0.14 }, // Cosmic Cyan
            { r: 190, g: 24, b: 93, a: 0.08 },  // Magenta Dust
            { r: 30, g: 58, b: 138, a: 0.15 },  // Royal Void
        ];
        for (let i = 0; i < config.nebulaCount; i++) {
            nebulae.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: Math.random() * 300 + 200,
                color: nebulaColors[i % nebulaColors.length],
                vx: (Math.random() - 0.5) * 0.15,
                vy: (Math.random() - 0.5) * 0.15,
            });
        }
    }

    // Spawn jet particles when matter enters black hole
    function spawnAccretionJet(x, y, color) {
        for (let i = 0; i < 5; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 4 + 2;
            explosionParticles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: Math.random() * 2 + 1,
                color,
                life: 1.0,
                decay: Math.random() * 0.04 + 0.02,
            });
        }
    }

    // Big Bang Shockwave and Supernova
    function triggerBigBang() {
        if (isBigBanging) return;
        isBigBanging = true;
        playSound("bigbang");

        const cx = width / 2;
        const cy = height / 2;

        // Step 1: Rapid gravitational collapse inwards
        stars.forEach((s) => {
            const dx = cx - s.x;
            const dy = cy - s.y;
            s.vx = dx * 0.12;
            s.vy = dy * 0.12;
        });

        // Step 2: Explosion after 350ms
        setTimeout(() => {
            shockwaves.push({
                x: cx,
                y: cy,
                radius: 10,
                maxRadius: Math.max(width, height) * 0.95,
                speed: 18,
                alpha: 1.0,
                color: "rgba(0, 240, 255, 0.8)",
            });
            shockwaves.push({
                x: cx,
                y: cy,
                radius: 10,
                maxRadius: Math.max(width, height) * 0.75,
                speed: 12,
                alpha: 1.0,
                color: "rgba(168, 85, 247, 0.7)",
            });

            // Re-spawn full galaxy of stars blasting outward
            stars = [];
            for (let i = 0; i < config.starCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 12 + 3;
                const dist = Math.random() * 30;
                const s = new Star(
                    cx + Math.cos(angle) * dist,
                    cy + Math.sin(angle) * dist,
                    Math.cos(angle) * speed,
                    Math.sin(angle) * speed,
                    Math.random() * 2.8 + 1
                );
                stars.push(s);
            }

            // High-energy ember debris
            for (let i = 0; i < 90; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 16 + 2;
                explosionParticles.push({
                    x: cx,
                    y: cy,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    radius: Math.random() * 3 + 1,
                    color: STAR_PALETTE[Math.floor(Math.random() * STAR_PALETTE.length)],
                    life: 1.0,
                    decay: Math.random() * 0.02 + 0.01,
                });
            }

            isBigBanging = false;
        }, 320);
    }

    // Toggle or place Black Hole
    function toggleBlackHole(customX, customY) {
        if (blackHole && blackHole.active && customX === undefined) {
            blackHole.active = false;
            blackHole = null;
            return false;
        }

        const x = customX !== undefined ? customX : width * 0.5;
        const y = customY !== undefined ? customY : height * 0.35;

        blackHole = {
            x,
            y,
            radius: 32,
            mass: 900,
            angle: 0,
            active: true,
        };
        playSound("blackhole");
        return true;
    }

    // Spawn cluster of stars at location
    function spawnStarCluster(x, y, count = 5) {
        playSound("spawn");
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3 + 1;
            const s = new Star(
                x,
                y,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                Math.random() * 2.5 + 1.2
            );
            stars.push(s);
        }
        // Cap stars to avoid frame drops
        if (stars.length > 220) {
            stars.splice(0, stars.length - 220);
        }
    }

    /* ==========================================================================
       Rendering Loop
       ========================================================================== */

    function renderNebulae() {
        nebulae.forEach((n) => {
            n.x += n.vx;
            n.y += n.vy;
            if (n.x < -100) n.x = width + 100;
            if (n.x > width + 100) n.x = -100;
            if (n.y < -100) n.y = height + 100;
            if (n.y > height + 100) n.y = -100;

            const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.radius);
            grad.addColorStop(0, `rgba(${n.color.r}, ${n.color.g}, ${n.color.b}, ${n.color.a})`);
            grad.addColorStop(1, "rgba(0, 0, 0, 0)");

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    function renderConstellations() {
        if (!config.showConstellations) return;

        ctx.lineWidth = 0.8;
        const maxD = config.maxConnectDist;

        for (let i = 0; i < stars.length; i++) {
            const s1 = stars[i];

            // Connect to mouse if near
            if (mouse.x > 0 && mouse.y > 0) {
                const mouseD = Math.hypot(mouse.x - s1.x, mouse.y - s1.y);
                if (mouseD < maxD * 1.3) {
                    const alpha = (1 - mouseD / (maxD * 1.3)) * 0.45;
                    ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
                    ctx.beginPath();
                    ctx.moveTo(s1.x, s1.y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.stroke();
                }
            }

            // Connect nearby stars
            for (let j = i + 1; j < stars.length; j++) {
                const s2 = stars[j];
                const dx = s1.x - s2.x;
                const dy = s1.y - s2.y;
                const dist = Math.hypot(dx, dy);

                if (dist < maxD) {
                    const alpha = (1 - dist / maxD) * 0.22;
                    ctx.strokeStyle = `rgba(160, 200, 255, ${alpha})`;
                    ctx.beginPath();
                    ctx.moveTo(s1.x, s1.y);
                    ctx.lineTo(s2.x, s2.y);
                    ctx.stroke();
                }
            }
        }
    }

    function renderBlackHole() {
        if (!blackHole || !blackHole.active) return;

        blackHole.angle += 0.05;
        const { x, y, radius, angle } = blackHole;

        ctx.save();
        ctx.translate(x, y);

        // 1. Accretion Disk (Swirling Plasma Rings)
        for (let i = 0; i < 3; i++) {
            ctx.save();
            ctx.rotate(angle * (i % 2 === 0 ? 1 : -1) + i);
            const diskGrad = ctx.createRadialGradient(0, 0, radius * 0.8, 0, 0, radius * 2.8);
            diskGrad.addColorStop(0, "rgba(255, 110, 0, 0.85)");
            diskGrad.addColorStop(0.35, "rgba(236, 72, 153, 0.6)");
            diskGrad.addColorStop(0.7, "rgba(0, 229, 255, 0.3)");
            diskGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

            ctx.fillStyle = diskGrad;
            ctx.beginPath();
            ctx.ellipse(0, 0, radius * 2.8, radius * 1.2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 2. Gravitational Lensing Halo (Photon Sphere)
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.15, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
        ctx.lineWidth = 2.5;
        ctx.shadowColor = "#00f0ff";
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 3. Event Horizon (Absolute Singularity)
        ctx.fillStyle = "#030408";
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function renderShockwaves() {
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const sw = shockwaves[i];
            sw.radius += sw.speed;
            sw.alpha *= 0.96;

            ctx.save();
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
            ctx.strokeStyle = sw.color.replace(/[\d\.]+\)$/, `${sw.alpha})`);
            ctx.lineWidth = 4 * sw.alpha;
            ctx.stroke();
            ctx.restore();

            if (sw.alpha < 0.02 || sw.radius > sw.maxRadius) {
                shockwaves.splice(i, 1);
            }
        }
    }

    function renderParticles() {
        for (let i = explosionParticles.length - 1; i >= 0; i--) {
            const p = explosionParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.96;
            p.vy *= 0.96;
            p.life -= p.decay;

            if (p.life <= 0) {
                explosionParticles.splice(i, 1);
                continue;
            }

            const { r, g, b } = p.color;
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.life})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function loop() {
        // Clear with slight trailing persistence for cosmic depth
        ctx.clearRect(0, 0, width, height);

        renderNebulae();
        renderConstellations();

        // Update & Render Stars
        for (let i = stars.length - 1; i >= 0; i--) {
            const s = stars[i];
            s.update();
            if (!s.isAlive) {
                stars.splice(i, 1);
                // replenish star occasionally
                if (stars.length < config.starCount) {
                    stars.push(new Star(Math.random() * width, Math.random() * height));
                }
                continue;
            }
            s.draw(ctx);
        }

        renderBlackHole();
        renderShockwaves();
        renderParticles();

        requestAnimationFrame(loop);
    }

    /* ==========================================================================
       Interactions & Event Handlers
       ========================================================================== */

    function getClosestStar(x, y, maxDistance = 35) {
        let closest = null;
        let closestDist = maxDistance;
        for (const s of stars) {
            const d = Math.hypot(s.x - x, s.y - y);
            if (d < closestDist) {
                closest = s;
                closestDist = d;
            }
        }
        return closest;
    }

    window.addEventListener("resize", () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        initStars();
    });

    window.addEventListener("mousemove", (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });

    window.addEventListener("mouseleave", () => {
        mouse.x = -9999;
        mouse.y = -9999;
        mouse.draggedStar = null;
        mouse.isDown = false;
    });

    window.addEventListener("mousedown", (e) => {
        // If clicking on UI inputs/buttons, ignore canvas interaction
        if (e.target.closest("button, input, select, dialog, .modal, .device-banner, .sensor-card, .metric-card")) {
            return;
        }

        if (e.button === 0) {
            // Left click: grab star or spawn new stars
            mouse.isDown = true;
            const clickedStar = getClosestStar(e.clientX, e.clientY);
            if (clickedStar) {
                mouse.draggedStar = clickedStar;
            } else {
                spawnStarCluster(e.clientX, e.clientY, 4);
            }
        } else if (e.button === 2) {
            // Right click: summon/move Black Hole
            e.preventDefault();
            toggleBlackHole(e.clientX, e.clientY);
            updateCosmicHud();
        }
    });

    window.addEventListener("mouseup", (e) => {
        if (e.button === 0) {
            mouse.isDown = false;
            mouse.draggedStar = null;
        }
    });

    window.addEventListener("contextmenu", (e) => {
        // Prevent default context menu on background to allow black hole summoning
        if (!e.target.closest("input, select, textarea")) {
            e.preventDefault();
        }
    });

    // Touch support for mobile / tablet
    window.addEventListener(
        "touchstart",
        (e) => {
            if (e.touches.length > 0) {
                const t = e.touches[0];
                mouse.x = t.clientX;
                mouse.y = t.clientY;
                if (!e.target.closest("button, input, .modal, .sensor-card, .metric-card")) {
                    spawnStarCluster(t.clientX, t.clientY, 3);
                }
            }
        },
        { passive: true }
    );

    window.addEventListener(
        "touchmove",
        (e) => {
            if (e.touches.length > 0) {
                const t = e.touches[0];
                mouse.x = t.clientX;
                mouse.y = t.clientY;
            }
        },
        { passive: true }
    );

    /* ==========================================================================
       Cosmic Floating HUD Controls
       ========================================================================== */

    function createCosmicHud() {
        const hud = document.createElement("aside");
        hud.className = "cosmic-hud";
        hud.setAttribute("aria-label", "Cosmic Sandbox Controls");
        hud.innerHTML = `
            <div class="cosmic-hud__badge">
                <span class="cosmic-pulse"></span>
                <span>Cosmic Canvas</span>
            </div>
            <div class="cosmic-hud__buttons">
                <button id="cosmic-bigbang-btn" class="cosmic-btn cosmic-btn--bang" title="ระเบิด Big Bang กำเนิดดวงดาวใหม่ทั้งหมด">
                    💥 Big Bang
                </button>
                <button id="cosmic-blackhole-btn" class="cosmic-btn cosmic-btn--hole" title="เปิด/ปิด หลุมดำดูดดวงดาว">
                    🌀 หลุมดำ
                </button>
                <button id="cosmic-constellation-btn" class="cosmic-btn" title="เปิด/ปิด เส้นเชื่อมกลุ่มดาว">
                    ✨ เส้นกลุ่มดาว
                </button>
                <button id="cosmic-spawn-btn" class="cosmic-btn" title="สร้างดาวใหม่">
                    ➕ สร้างดาว
                </button>
            </div>
            <div class="cosmic-hud__tip">
                คลิก/ลากดาว • คลิกขวาเพื่อย้ายหลุมดำ
            </div>
        `;
        document.body.appendChild(hud);

        document.getElementById("cosmic-bigbang-btn").addEventListener("click", () => triggerBigBang());
        document.getElementById("cosmic-blackhole-btn").addEventListener("click", () => {
            toggleBlackHole();
            updateCosmicHud();
        });
        document.getElementById("cosmic-constellation-btn").addEventListener("click", (e) => {
            config.showConstellations = !config.showConstellations;
            e.currentTarget.classList.toggle("is-active", config.showConstellations);
        });
        document.getElementById("cosmic-spawn-btn").addEventListener("click", () => {
            spawnStarCluster(width / 2 + (Math.random() - 0.5) * 200, height / 2 + (Math.random() - 0.5) * 200, 6);
        });
    }

    function updateCosmicHud() {
        const holeBtn = document.getElementById("cosmic-blackhole-btn");
        if (holeBtn) {
            holeBtn.classList.toggle("is-active", Boolean(blackHole && blackHole.active));
        }
    }

    // Expose API globally
    window.CosmicSpace = {
        triggerBigBang,
        toggleBlackHole,
        spawnStarCluster,
    };

    // Boot
    initStars();
    createCosmicHud();
    loop();
})();
