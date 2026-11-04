/**
 * Nora Studio - Real-Time Sentinel & Connectivity Monitor (Liquid Glass Edition)
 * Displays a sleek crystal liquid glass modal with organic aurora refractions
 * and holographic radar animations when Nora backend is unreachable,
 * then morphs with a celebratory green checkmark on reconnect.
 */
(function() {
    // State Variables
    let isCurrentlyOffline = false;
    let isWaveGreen = false;
    let retryTimerInterval = null;
    let retrySecondsRemaining = 4;
    let dismissalTimeout = null;
    let animationFrameId = null;
    let waveOffset = 0;
    let overlay = null;
    let canvas = null;
    let ctx = null;

    // 1. Initialize DOM Elements safely
    function ensureSentinelDOM() {
        if (overlay && document.body && document.body.contains(overlay)) {
            return true;
        }
        if (!document.body) {
            return false;
        }

        // Remove duplicates if any exist
        const oldStyle = document.getElementById('nora-sentinel-styles');
        if (oldStyle) oldStyle.remove();
        const oldOverlay = document.getElementById('nora-sentinel-overlay');
        if (oldOverlay) oldOverlay.remove();

        // Inject Styles
        const style = document.createElement('style');
        style.id = 'nora-sentinel-styles';
        style.textContent = `
            #nora-sentinel-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                z-index: 99999999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.5s ease;
                font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                overflow: hidden;
            }

            #nora-sentinel-overlay.active {
                opacity: 1;
                visibility: visible;
                pointer-events: auto;
            }

            .sentinel-backdrop {
                position: absolute;
                inset: 0;
                background: radial-gradient(circle at 50% 35%, rgba(18, 22, 36, 0.72) 0%, rgba(6, 8, 14, 0.92) 100%);
                backdrop-filter: blur(28px) saturate(180%);
                -webkit-backdrop-filter: blur(28px) saturate(180%);
                transition: background 0.8s ease;
            }

            .sentinel-spectral-canvas {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 1;
                opacity: 0.75;
                transition: opacity 0.8s ease;
            }

            .sentinel-ambient-blob {
                position: absolute;
                border-radius: 50%;
                filter: blur(80px);
                pointer-events: none;
                z-index: 2;
                transition: background 0.8s ease, transform 0.8s ease;
            }

            .sentinel-ambient-blob.blob-1 {
                top: 15%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 480px;
                height: 320px;
                background: radial-gradient(circle, rgba(244, 63, 94, 0.22) 0%, rgba(239, 68, 68, 0.08) 60%, transparent 80%);
                animation: sentinelOrbPulse 6s ease-in-out infinite alternate;
            }

            .sentinel-ambient-blob.blob-2 {
                bottom: 10%;
                left: 45%;
                width: 360px;
                height: 260px;
                background: radial-gradient(circle, rgba(251, 146, 60, 0.12) 0%, rgba(244, 63, 94, 0.05) 60%, transparent 80%);
                animation: sentinelOrbPulse 7s ease-in-out infinite alternate-reverse;
            }

            #nora-sentinel-overlay.online-mode .sentinel-ambient-blob.blob-1 {
                background: radial-gradient(circle, rgba(34, 197, 94, 0.3) 0%, rgba(16, 185, 129, 0.1) 60%, transparent 80%);
            }

            #nora-sentinel-overlay.online-mode .sentinel-ambient-blob.blob-2 {
                background: radial-gradient(circle, rgba(56, 189, 248, 0.18) 0%, rgba(34, 197, 94, 0.05) 60%, transparent 80%);
            }

            @keyframes sentinelOrbPulse {
                0% { transform: translate(-50%, -50%) scale(0.9); opacity: 0.6; }
                50% { transform: translate(-48%, -52%) scale(1.12); opacity: 0.95; }
                100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0.6; }
            }

            /* Liquid Glass Box Architecture */
            .sentinel-card {
                position: relative;
                z-index: 10;
                max-width: 500px;
                width: 100%;
                background: linear-gradient(145deg, rgba(255, 255, 255, 0.065) 0%, rgba(255, 255, 255, 0.015) 100%), rgba(14, 18, 28, 0.68);
                backdrop-filter: blur(36px) saturate(190%);
                -webkit-backdrop-filter: blur(36px) saturate(190%);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-top: 1px solid rgba(255, 255, 255, 0.28);
                border-radius: 28px;
                padding: 38px 32px;
                text-align: center;
                box-shadow: 0 30px 80px -15px rgba(0, 0, 0, 0.8), inset 0 1px 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.35), 0 0 50px -15px rgba(244, 63, 94, 0.25);
                transform: translateY(24px) scale(0.96);
                transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.8s ease, box-shadow 0.8s ease;
                box-sizing: border-box;
                overflow: hidden;
            }

            #nora-sentinel-overlay.active .sentinel-card {
                transform: translateY(0) scale(1);
                animation: sentinelCardFloat 6s ease-in-out infinite alternate;
            }

            #nora-sentinel-overlay.online-mode .sentinel-card {
                border-color: rgba(34, 197, 94, 0.4);
                border-top-color: rgba(34, 197, 94, 0.7);
                box-shadow: 0 30px 80px -15px rgba(0, 0, 0, 0.8), inset 0 1px 1px 0 rgba(255, 255, 255, 0.3), 0 0 60px -10px rgba(34, 197, 94, 0.35);
            }

            @keyframes sentinelCardFloat {
                0% { transform: translateY(0) scale(1); }
                50% { transform: translateY(-5px) scale(1.002); }
                100% { transform: translateY(0) scale(1); }
            }

            /* Specular Liquid Shimmer Sweep */
            .sentinel-shimmer-sweep {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.04) 50%, transparent 100%);
                pointer-events: none;
                animation: liquidShimmer 8s infinite ease-in-out;
            }

            @keyframes liquidShimmer {
                0% { transform: translateX(-150%) skewX(-20deg); }
                100% { transform: translateX(250%) skewX(-20deg); }
            }

            /* Liquid Aura Halo behind Card */
            .sentinel-liquid-halo {
                position: absolute;
                inset: -15px;
                border-radius: 38px;
                background: radial-gradient(circle at 50% 30%, rgba(244, 63, 94, 0.2) 0%, rgba(239, 68, 68, 0.06) 50%, transparent 75%);
                filter: blur(28px);
                z-index: -1;
                pointer-events: none;
                transition: background 0.8s ease;
                animation: sentinelLiquidPulse 5s ease-in-out infinite alternate;
            }

            #nora-sentinel-overlay.online-mode .sentinel-liquid-halo {
                background: radial-gradient(circle at 50% 30%, rgba(34, 197, 94, 0.3) 0%, rgba(16, 185, 129, 0.1) 50%, transparent 75%);
            }

            @keyframes sentinelLiquidPulse {
                0% { opacity: 0.55; transform: scale(0.96); }
                100% { opacity: 0.95; transform: scale(1.04); }
            }

            /* Holographic Radar Pulse Animation */
            .sentinel-icon-wrapper {
                position: relative;
                width: 92px;
                height: 92px;
                margin: 0 auto 20px auto;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .sentinel-radar-ring {
                position: absolute;
                inset: 0;
                border-radius: 50%;
                border: 2px solid rgba(244, 63, 94, 0.45);
                animation: sentinelRadarWave 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
                pointer-events: none;
            }

            .sentinel-radar-ring.ring-2 {
                animation-delay: 0.8s;
                border-color: rgba(244, 63, 94, 0.28);
            }

            .sentinel-signal-sweep {
                position: absolute;
                inset: -6px;
                border-radius: 50%;
                border: 2px dashed rgba(251, 191, 36, 0.45);
                animation: sentinelSignalSweep 10s linear infinite;
                pointer-events: none;
            }

            #nora-sentinel-overlay.online-mode .sentinel-radar-ring {
                border-color: rgba(34, 197, 94, 0.5);
            }

            #nora-sentinel-overlay.online-mode .sentinel-signal-sweep {
                border-color: rgba(52, 211, 153, 0.45);
                animation-duration: 4s;
            }

            @keyframes sentinelRadarWave {
                0% { transform: scale(0.65); opacity: 0.85; }
                50% { transform: scale(1.35); opacity: 0.35; }
                100% { transform: scale(2.05); opacity: 0; }
            }

            @keyframes sentinelSignalSweep {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            .sentinel-icon-badge {
                position: relative;
                z-index: 2;
                width: 72px;
                height: 72px;
                border-radius: 22px;
                background: linear-gradient(135deg, rgba(244, 63, 94, 0.9) 0%, rgba(225, 29, 72, 0.95) 100%);
                border: 1px solid rgba(255, 255, 255, 0.25);
                border-top: 1px solid rgba(255, 255, 255, 0.45);
                display: flex;
                align-items: center;
                justify-content: center;
                color: #ffffff;
                font-size: 1.85rem;
                box-shadow: 0 12px 30px rgba(244, 63, 94, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.35);
                backdrop-filter: blur(12px);
                transition: all 0.7s cubic-bezier(0.16, 1, 0.3, 1);
            }

            #nora-sentinel-overlay.online-mode .sentinel-icon-badge {
                background: linear-gradient(135deg, rgba(34, 197, 94, 0.92) 0%, rgba(16, 185, 129, 0.96) 100%);
                border-color: rgba(255, 255, 255, 0.35);
                box-shadow: 0 12px 35px rgba(34, 197, 94, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.5);
                transform: scale(1.08) rotate(360deg);
            }

            .sentinel-status-pill {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 5px 14px;
                border-radius: 9999px;
                background: rgba(244, 63, 94, 0.12);
                border: 1px solid rgba(244, 63, 94, 0.32);
                border-top: 1px solid rgba(244, 63, 94, 0.5);
                backdrop-filter: blur(12px);
                color: #fda4af;
                font-size: 0.75rem;
                font-weight: 800;
                letter-spacing: 0.8px;
                text-transform: uppercase;
                margin-bottom: 14px;
                transition: all 0.6s ease;
            }

            #nora-sentinel-overlay.online-mode .sentinel-status-pill {
                background: rgba(34, 197, 94, 0.12);
                border-color: rgba(34, 197, 94, 0.35);
                border-top-color: rgba(34, 197, 94, 0.55);
                color: #86efac;
            }

            .sentinel-pill-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #f43f5e;
                box-shadow: 0 0 10px #f43f5e;
                animation: sentinelDotBlink 1.4s infinite;
                transition: background 0.6s ease, box-shadow 0.6s ease;
            }

            #nora-sentinel-overlay.online-mode .sentinel-pill-dot {
                background: #22c55e;
                box-shadow: 0 0 10px #22c55e;
                animation: none;
            }

            @keyframes sentinelDotBlink {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.35; transform: scale(0.85); }
            }

            .sentinel-title {
                font-size: 1.65rem;
                font-weight: 800;
                color: #ffffff;
                margin: 0 0 10px 0;
                letter-spacing: -0.025em;
                line-height: 1.25;
                transition: color 0.5s ease;
            }

            .sentinel-description {
                color: rgba(255, 255, 255, 0.72);
                font-size: 0.92rem;
                line-height: 1.55;
                margin: 0 0 22px 0;
            }

            /* Nested Liquid Glass Guarantee Box */
            .sentinel-guarantee-box {
                background: rgba(255, 255, 255, 0.035);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-top: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 16px;
                padding: 14px 18px;
                margin-bottom: 24px;
                text-align: left;
                display: flex;
                flex-direction: column;
                gap: 12px;
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 4px 20px rgba(0, 0, 0, 0.25);
            }

            .sentinel-guarantee-item {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 0.83rem;
                color: rgba(255, 255, 255, 0.88);
                font-weight: 500;
            }

            .sentinel-item-icon {
                width: 28px;
                height: 28px;
                border-radius: 8px;
                background: rgba(56, 189, 248, 0.14);
                border: 1px solid rgba(56, 189, 248, 0.25);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                color: #38bdf8;
                font-size: 0.85rem;
            }

            .sentinel-actions {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                flex-wrap: wrap;
            }

            .sentinel-retry-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background: linear-gradient(135deg, rgba(239, 68, 68, 0.9) 0%, rgba(220, 38, 38, 0.95) 100%);
                border: 1px solid rgba(255, 255, 255, 0.25);
                border-top: 1px solid rgba(255, 255, 255, 0.45);
                color: #ffffff;
                font-size: 0.88rem;
                font-weight: 700;
                padding: 12px 24px;
                border-radius: 9999px;
                cursor: pointer;
                backdrop-filter: blur(12px);
                box-shadow: 0 6px 22px rgba(239, 68, 68, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.35);
                transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .sentinel-retry-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 30px rgba(239, 68, 68, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.5);
            }

            .sentinel-status-link {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-top: 1px solid rgba(255, 255, 255, 0.22);
                color: rgba(255, 255, 255, 0.85);
                text-decoration: none;
                font-size: 0.85rem;
                font-weight: 600;
                padding: 12px 20px;
                border-radius: 9999px;
                backdrop-filter: blur(14px);
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
                transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .sentinel-status-link:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.25);
                color: #ffffff;
                transform: translateY(-2px);
            }

            .spinning {
                animation: sentinelSpin 0.75s linear infinite;
            }

            @keyframes sentinelSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);

        // Build DOM Elements
        overlay = document.createElement('div');
        overlay.id = 'nora-sentinel-overlay';
        overlay.innerHTML = `
            <div class="sentinel-backdrop"></div>
            <canvas id="sentinel-canvas" class="sentinel-spectral-canvas"></canvas>
            <div class="sentinel-ambient-blob blob-1"></div>
            <div class="sentinel-ambient-blob blob-2"></div>
            
            <div class="sentinel-card" id="sentinel-card">
                <div class="sentinel-liquid-halo"></div>
                <div class="sentinel-shimmer-sweep"></div>

                <div class="sentinel-icon-wrapper">
                    <div class="sentinel-radar-ring ring-1"></div>
                    <div class="sentinel-radar-ring ring-2"></div>
                    <div class="sentinel-signal-sweep"></div>
                    <div class="sentinel-icon-badge" id="sentinel-badge">
                        <i class="fas fa-satellite-dish" id="sentinel-icon"></i>
                    </div>
                </div>

                <div class="sentinel-status-pill" id="sentinel-status-pill">
                    <span class="sentinel-pill-dot" id="sentinel-pill-dot"></span>
                    <span id="sentinel-pill-text">Nora Offline</span>
                </div>

                <h2 class="sentinel-title" id="sentinel-title">Backend Connection Lost</h2>
                <p class="sentinel-description" id="sentinel-description">
                    Nora Assistant is currently unreachable or undergoing maintenance. We're actively monitoring for connectivity.
                </p>

                <div class="sentinel-guarantee-box">
                    <div class="sentinel-guarantee-item">
                        <div class="sentinel-item-icon"><i class="fas fa-shield-alt"></i></div>
                        <span>Your edits and session inputs remain safe and cached locally.</span>
                    </div>
                    <div class="sentinel-guarantee-item">
                        <div class="sentinel-item-icon"><i class="fas fa-sync-alt fa-spin"></i></div>
                        <span>Auto-reconnecting in <strong id="sentinel-countdown-timer" style="color: #fff; margin-left: 4px;">4s</strong>...</span>
                    </div>
                </div>

                <div class="sentinel-actions" id="sentinel-actions">
                    <button type="button" class="sentinel-retry-btn" id="sentinel-retry-btn" onclick="window.noraSentinelRetryManual()">
                        <i class="fas fa-redo-alt" id="sentinel-retry-icon"></i>
                        <span>Retry Connection</span>
                    </button>
                    <a href="/status.html" class="sentinel-status-link" target="_blank">
                        <i class="fas fa-signal"></i>
                        <span>View System Status</span>
                    </a>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        canvas = document.getElementById('sentinel-canvas');
        if (canvas) {
            ctx = canvas.getContext('2d');
            resizeCanvas();
        }
        return true;
    }

    function resizeCanvas() {
        if (!canvas || !ctx) return;
        canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
        canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
        ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
    window.addEventListener('resize', resizeCanvas);

    // Initial DOM setup once ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureSentinelDOM);
    } else {
        ensureSentinelDOM();
    }

    // 2. Multi-Harmonic Liquid Aurora Ribbon Animation
    function drawSpectralWaves() {
        if (!canvas || !ctx) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);

        waveOffset += 0.012;

        // Wave 1 - Ambient upper harmonic ribbon
        ctx.save();
        ctx.beginPath();
        const yBase1 = h * 0.22;
        ctx.moveTo(0, yBase1);
        for (let x = 0; x <= w; x += 20) {
            const y = yBase1 + Math.sin(x * 0.003 + waveOffset) * 45 + Math.cos(x * 0.002 - waveOffset * 0.7) * 30;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, 0);
        ctx.lineTo(0, 0);
        ctx.closePath();

        const grad1 = ctx.createLinearGradient(0, 0, 0, yBase1 + 90);
        if (isWaveGreen) {
            grad1.addColorStop(0, 'rgba(34, 197, 94, 0.18)');
            grad1.addColorStop(0.6, 'rgba(16, 185, 129, 0.07)');
            grad1.addColorStop(1, 'rgba(34, 197, 94, 0)');
        } else {
            grad1.addColorStop(0, 'rgba(244, 63, 94, 0.16)');
            grad1.addColorStop(0.6, 'rgba(239, 68, 68, 0.06)');
            grad1.addColorStop(1, 'rgba(244, 63, 94, 0)');
        }
        ctx.fillStyle = grad1;
        ctx.fill();
        ctx.restore();

        // Wave 2 - Lower fluid liquid refraction ribbon
        ctx.save();
        ctx.beginPath();
        const yBase2 = h * 0.78;
        ctx.moveTo(0, yBase2);
        for (let x = 0; x <= w; x += 25) {
            const y = yBase2 + Math.cos(x * 0.0035 - waveOffset * 0.9) * 40 + Math.sin(x * 0.0018 + waveOffset * 0.6) * 25;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();

        const grad2 = ctx.createLinearGradient(0, yBase2 - 80, 0, h);
        if (isWaveGreen) {
            grad2.addColorStop(0, 'rgba(52, 211, 153, 0)');
            grad2.addColorStop(0.5, 'rgba(16, 185, 129, 0.06)');
            grad2.addColorStop(1, 'rgba(34, 197, 94, 0.14)');
        } else {
            grad2.addColorStop(0, 'rgba(251, 146, 60, 0)');
            grad2.addColorStop(0.5, 'rgba(244, 63, 94, 0.06)');
            grad2.addColorStop(1, 'rgba(239, 68, 68, 0.15)');
        }
        ctx.fillStyle = grad2;
        ctx.fill();
        ctx.restore();

        if (overlay && overlay.classList.contains('active')) {
            animationFrameId = requestAnimationFrame(drawSpectralWaves);
        }
    }

    // 3. Trigger Offline
    function showOfflineOverlay() {
        ensureSentinelDOM();
        if (isCurrentlyOffline) return;
        isCurrentlyOffline = true;
        isWaveGreen = false;

        if (dismissalTimeout) {
            clearTimeout(dismissalTimeout);
            dismissalTimeout = null;
        }

        if (overlay) {
            overlay.classList.remove('online-mode');
            overlay.classList.add('active');
        }

        const iconEl = document.getElementById('sentinel-icon');
        if (iconEl) iconEl.className = 'fas fa-satellite-dish';
        const pillText = document.getElementById('sentinel-pill-text');
        if (pillText) pillText.textContent = 'Nora Offline';
        const titleEl = document.getElementById('sentinel-title');
        if (titleEl) titleEl.textContent = 'Backend Connection Lost';
        const descEl = document.getElementById('sentinel-description');
        if (descEl) descEl.textContent = "Nora Assistant is currently unreachable or undergoing maintenance. We're actively monitoring for connectivity.";
        const actionsEl = document.getElementById('sentinel-actions');
        if (actionsEl) actionsEl.style.display = 'flex';

        resizeCanvas();
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        drawSpectralWaves();

        startRetryCountdown();
    }

    // 4. Trigger Online Recovery
    function showOnlineRecovery() {
        ensureSentinelDOM();
        if (!isCurrentlyOffline) return;
        isCurrentlyOffline = false;
        isWaveGreen = true;

        clearInterval(retryTimerInterval);

        if (overlay) {
            overlay.classList.add('online-mode');
        }

        const iconEl = document.getElementById('sentinel-icon');
        if (iconEl) {
            iconEl.style.opacity = '0';
            setTimeout(() => {
                iconEl.className = 'fas fa-check';
                iconEl.style.opacity = '1';
            }, 200);
        }

        const pillText = document.getElementById('sentinel-pill-text');
        if (pillText) pillText.textContent = 'Online & Connected';
        const titleEl = document.getElementById('sentinel-title');
        if (titleEl) titleEl.textContent = 'Connection Restored!';
        const descEl = document.getElementById('sentinel-description');
        if (descEl) descEl.textContent = 'Nora is back online and all systems are nominal. Resuming your workspace...';
        const actionsEl = document.getElementById('sentinel-actions');
        if (actionsEl) actionsEl.style.display = 'none';

        // Auto-dismiss after 1.8 seconds of green celebration
        dismissalTimeout = setTimeout(() => {
            if (overlay) overlay.classList.remove('active');
            setTimeout(() => {
                if (overlay) overlay.classList.remove('online-mode');
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
            }, 600);
        }, 1800);
    }

    let consecutiveFailures = 0;
    const MAX_FAILURES_BEFORE_OFFLINE = 2; // Requires 2 consecutive failures to prevent false alarms

    function getResolvedApiBase() {
        if (window.__NORA_API_BASE_URL__) return window.__NORA_API_BASE_URL__;
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '3000') {
            return '';
        }
        return 'https://api.vaztinix.dev';
    }

    async function checkNoraHealth(isImmediate = false) {
        try {
            const apiBase = getResolvedApiBase();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second generous timeout for real network latency
            const res = await originalFetch(`${apiBase}/api/status/public`, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data.systemStatus === 'offline' || data.systemStatus === 'outage') {
                    consecutiveFailures++;
                    if (consecutiveFailures >= (isImmediate ? 1 : MAX_FAILURES_BEFORE_OFFLINE)) {
                        showOfflineOverlay();
                    }
                } else {
                    consecutiveFailures = 0;
                    if (isCurrentlyOffline) {
                        showOnlineRecovery();
                    }
                }
            } else if (res.status === 502 || res.status === 503 || res.status === 504) {
                consecutiveFailures++;
                if (consecutiveFailures >= (isImmediate ? 1 : MAX_FAILURES_BEFORE_OFFLINE)) {
                    showOfflineOverlay();
                }
            }
        } catch (e) {
            // Ignore intentional aborts or browser unload
            if (e && (e.name === 'AbortError' || e.message?.includes('aborted'))) return;
            
            consecutiveFailures++;
            if (consecutiveFailures >= (isImmediate ? 1 : MAX_FAILURES_BEFORE_OFFLINE)) {
                showOfflineOverlay();
            }
        }
    }

    function startRetryCountdown() {
        clearInterval(retryTimerInterval);
        retrySecondsRemaining = 4;
        const timerEl = document.getElementById('sentinel-countdown-timer');
        if (timerEl) timerEl.textContent = `${retrySecondsRemaining}s`;

        retryTimerInterval = setInterval(async () => {
            retrySecondsRemaining--;
            if (timerEl) timerEl.textContent = `${retrySecondsRemaining}s`;

            if (retrySecondsRemaining <= 0) {
                clearInterval(retryTimerInterval);
                await checkNoraHealth(true);
                if (isCurrentlyOffline) {
                    startRetryCountdown();
                }
            }
        }, 1000);
    }

    window.noraSentinelRetryManual = async function() {
        const retryIcon = document.getElementById('sentinel-retry-icon');
        if (retryIcon) retryIcon.classList.add('spinning');
        await checkNoraHealth(true);
        setTimeout(() => {
            if (retryIcon) retryIcon.classList.remove('spinning');
        }, 600);
    };

    // Public API functions unconditionally bound to window immediately
    window.triggerNoraOffline = showOfflineOverlay;
    window.triggerNoraOnline = showOnlineRecovery;

    window.testSentinel = function(durationSeconds = 4) {
        showOfflineOverlay();
        setTimeout(() => {
            showOnlineRecovery();
        }, (durationSeconds || 4) * 1000);
    };

    // Hotkey: Ctrl + Shift + O (or Cmd + Shift + O) to preview animation
    window.addEventListener('keydown', (e) => {
        if (!e) return;
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
            e.preventDefault();
            window.testSentinel(4);
        }
    });

    // Network & API Interceptor for immediate detection (only triggers on actual fatal backend errors)
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        try {
            const response = await originalFetch.apply(this, args);
            const urlStr = (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url)) || '';
            // Only trigger if a core backend API returns 502/503/504 Bad Gateway
            if ((urlStr.includes('/api/status') || urlStr.includes('/api/guilds')) && (response.status === 502 || response.status === 503 || response.status === 504)) {
                checkNoraHealth(true);
            }
            return response;
        } catch (err) {
            // Ignore cancelled/aborted fetches, image loads, or optional third-party requests
            if (err && (err.name === 'AbortError' || err.message?.includes('aborted'))) {
                throw err;
            }
            const urlStr = (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url)) || '';
            if (urlStr.includes('/api/status') || urlStr.includes('/api/guilds')) {
                checkNoraHealth(true);
            }
            throw err;
        }
    };

    // Listen to native browser connection events
    window.addEventListener('offline', () => checkNoraHealth(true));
    window.addEventListener('online', () => checkNoraHealth(true));

    // Heartbeat Polling: Sleeps when tab is minimized/backgrounded to save 100% CPU & bandwidth
    setInterval(() => {
        if (!isCurrentlyOffline && !document.hidden) {
            checkNoraHealth(false);
        }
    }, 45000);

    // Instant wake-up check upon restoring the tab
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !isCurrentlyOffline) {
            checkNoraHealth(false);
        }
    });
})();
