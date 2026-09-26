/**
 * Nora Studio - Real-Time Sentinel & Connectivity Monitor
 * Displays a spectral wave blur overlay when Nora backend goes offline,
 * and morphs into a glowing green checkmark before gracefully dismissing on reconnect.
 */
(function() {
    // Remove duplicate style or overlay if reloaded
    const existingStyle = document.getElementById('nora-sentinel-styles');
    if (existingStyle) existingStyle.remove();
    const existingOverlay = document.getElementById('nora-sentinel-overlay');
    if (existingOverlay) existingOverlay.remove();

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

        /* Backdrop with Dynamic Glass Blur */
        .sentinel-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(8, 10, 16, 0.88);
            backdrop-filter: blur(18px) saturate(160%);
            -webkit-backdrop-filter: blur(18px) saturate(160%);
            transition: background 0.8s ease;
        }

        /* Spectral Waves Falling from the Top */
        .sentinel-spectral-canvas {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
            opacity: 0.85;
            transition: opacity 0.8s ease;
        }

        .sentinel-glow-orb {
            position: absolute;
            top: -120px;
            left: 50%;
            transform: translateX(-50%);
            width: 600px;
            height: 400px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(239, 68, 68, 0.45) 0%, rgba(220, 38, 38, 0.15) 50%, transparent 75%);
            filter: blur(50px);
            z-index: 2;
            transition: background 0.8s ease, transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
            animation: sentinelOrbPulse 4s ease-in-out infinite alternate;
        }

        #nora-sentinel-overlay.online-mode .sentinel-glow-orb {
            background: radial-gradient(circle, rgba(34, 197, 94, 0.45) 0%, rgba(16, 185, 129, 0.15) 50%, transparent 75%);
        }

        @keyframes sentinelOrbPulse {
            0% { transform: translateX(-50%) scale(0.95); opacity: 0.7; }
            100% { transform: translateX(-50%) scale(1.15); opacity: 1; }
        }

        /* Modal Dialog Card */
        .sentinel-card {
            position: relative;
            z-index: 10;
            max-width: 520px;
            width: 100%;
            background: linear-gradient(145deg, rgba(17, 20, 32, 0.92) 0%, rgba(11, 14, 24, 0.96) 100%);
            border: 1px solid rgba(239, 68, 68, 0.35);
            border-radius: 24px;
            padding: 36px 30px;
            text-align: center;
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75), 0 0 35px rgba(239, 68, 68, 0.2);
            transform: translateY(30px) scale(0.95);
            transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.8s ease, box-shadow 0.8s ease;
            box-sizing: border-box;
        }

        #nora-sentinel-overlay.active .sentinel-card {
            transform: translateY(0) scale(1);
        }

        #nora-sentinel-overlay.online-mode .sentinel-card {
            border-color: rgba(34, 197, 94, 0.45);
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75), 0 0 45px rgba(34, 197, 94, 0.25);
        }

        /* Icon Container & Signal Animation */
        .sentinel-icon-wrapper {
            position: relative;
            width: 88px;
            height: 88px;
            margin: 0 auto 20px auto;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .sentinel-icon-ring {
            position: absolute;
            inset: -8px;
            border-radius: 50%;
            border: 2px dashed rgba(239, 68, 68, 0.4);
            animation: sentinelRingRotate 12s linear infinite;
            transition: border-color 0.8s ease;
        }

        #nora-sentinel-overlay.online-mode .sentinel-icon-ring {
            border-color: rgba(34, 197, 94, 0.5);
            animation: sentinelRingRotate 4s linear infinite;
        }

        @keyframes sentinelRingRotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .sentinel-icon-pulse {
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.15);
            animation: sentinelPulse 2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
            transition: background 0.8s ease;
        }

        #nora-sentinel-overlay.online-mode .sentinel-icon-pulse {
            background: rgba(34, 197, 94, 0.2);
            animation: sentinelSuccessRipple 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes sentinelPulse {
            0% { transform: scale(0.9); opacity: 0.8; }
            50% { transform: scale(1.3); opacity: 0; }
            100% { transform: scale(0.9); opacity: 0; }
        }

        @keyframes sentinelSuccessRipple {
            0% { transform: scale(0.8); opacity: 1; }
            100% { transform: scale(2.2); opacity: 0; }
        }

        .sentinel-icon-badge {
            position: relative;
            z-index: 2;
            width: 72px;
            height: 72px;
            border-radius: 22px;
            background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-size: 2rem;
            box-shadow: 0 10px 25px rgba(239, 68, 68, 0.4);
            transition: all 0.7s cubic-bezier(0.16, 1, 0.3, 1);
        }

        #nora-sentinel-overlay.online-mode .sentinel-icon-badge {
            background: linear-gradient(135deg, #22c55e 0%, #15803d 100%);
            box-shadow: 0 10px 30px rgba(34, 197, 94, 0.5);
            transform: scale(1.1) rotate(360deg);
        }

        .sentinel-icon-badge i {
            transition: transform 0.4s ease, opacity 0.3s ease;
        }

        /* Typography & Badges */
        .sentinel-status-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 5px 14px;
            border-radius: 9999px;
            background: rgba(239, 68, 68, 0.12);
            border: 1px solid rgba(239, 68, 68, 0.35);
            color: #fca5a5;
            font-size: 0.75rem;
            font-weight: 700;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            margin-bottom: 14px;
            transition: all 0.6s ease;
        }

        #nora-sentinel-overlay.online-mode .sentinel-status-pill {
            background: rgba(34, 197, 94, 0.12);
            border-color: rgba(34, 197, 94, 0.35);
            color: #86efac;
        }

        .sentinel-pill-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #ef4444;
            box-shadow: 0 0 10px #ef4444;
            animation: sentinelDotBlink 1.4s infinite;
            transition: background 0.6s ease, box-shadow 0.6s ease;
        }

        #nora-sentinel-overlay.online-mode .sentinel-pill-dot {
            background: #22c55e;
            box-shadow: 0 0 10px #22c55e;
            animation: none;
        }

        @keyframes sentinelDotBlink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }

        .sentinel-title {
            font-size: 1.65rem;
            font-weight: 800;
            color: #ffffff;
            margin: 0 0 10px 0;
            letter-spacing: -0.02em;
            line-height: 1.25;
            transition: color 0.5s ease;
        }

        .sentinel-description {
            color: rgba(255, 255, 255, 0.7);
            font-size: 0.92rem;
            line-height: 1.55;
            margin: 0 0 24px 0;
        }

        /* Feature list of safe guarantees */
        .sentinel-guarantee-box {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 14px;
            padding: 14px 16px;
            margin-bottom: 24px;
            text-align: left;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .sentinel-guarantee-item {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 0.82rem;
            color: rgba(255, 255, 255, 0.85);
            font-weight: 500;
        }

        .sentinel-guarantee-item i {
            color: #38bdf8;
            font-size: 0.9rem;
            flex-shrink: 0;
        }

        /* Action Buttons & Timer */
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
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            border: 1px solid rgba(239, 68, 68, 0.5);
            color: #ffffff;
            font-size: 0.88rem;
            font-weight: 700;
            padding: 11px 22px;
            border-radius: 9999px;
            cursor: pointer;
            box-shadow: 0 4px 18px rgba(239, 68, 68, 0.35);
            transition: all 0.2s ease;
        }

        .sentinel-retry-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 24px rgba(239, 68, 68, 0.5);
        }

        .sentinel-retry-btn:active {
            transform: translateY(0);
        }

        .sentinel-retry-btn i.spinning {
            animation: sentinelSpin 1s linear infinite;
        }

        @keyframes sentinelSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .sentinel-status-link {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.8);
            text-decoration: none;
            font-size: 0.85rem;
            font-weight: 600;
            padding: 11px 18px;
            border-radius: 9999px;
            transition: all 0.2s ease;
        }

        .sentinel-status-link:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
        }
    `;
    document.head.appendChild(style);

    // Build DOM Elements
    const overlay = document.createElement('div');
    overlay.id = 'nora-sentinel-overlay';
    overlay.innerHTML = `
        <div class="sentinel-backdrop"></div>
        <canvas id="sentinel-canvas" class="sentinel-spectral-canvas"></canvas>
        <div class="sentinel-glow-orb" id="sentinel-glow-orb"></div>
        
        <div class="sentinel-card" id="sentinel-card">
            <div class="sentinel-icon-wrapper">
                <div class="sentinel-icon-ring"></div>
                <div class="sentinel-icon-pulse"></div>
                <div class="sentinel-icon-badge" id="sentinel-badge">
                    <i class="fas fa-exclamation-triangle" id="sentinel-icon"></i>
                </div>
            </div>

            <div class="sentinel-status-pill" id="sentinel-status-pill">
                <span class="sentinel-pill-dot" id="sentinel-pill-dot"></span>
                <span id="sentinel-pill-text">Nora Offline</span>
            </div>

            <h2 class="sentinel-title" id="sentinel-title">Backend Connection Lost</h2>
            <p class="sentinel-description" id="sentinel-description">
                Nora Assistant is currently unreachable or undergoing maintenance. We're actively waiting for the signal to return.
            </p>

            <div class="sentinel-guarantee-box">
                <div class="sentinel-guarantee-item">
                    <i class="fas fa-shield-alt"></i>
                    <span>Your edits and session inputs remain safe and cached locally.</span>
                </div>
                <div class="sentinel-guarantee-item">
                    <i class="fas fa-sync-alt"></i>
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

    // Canvas Spectral Waves Animation Controller
    const canvas = document.getElementById('sentinel-canvas');
    const ctx = canvas.getContext('2d');
    let animationFrameId = null;
    let waveOffset = 0;
    let isWaveGreen = false;

    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
        canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
        ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function drawSpectralWaves() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);

        waveOffset += 0.015;

        // Wave 1 - Large primary falling spectral wave
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 140 + Math.sin(waveOffset) * 40);

        for (let x = 0; x <= w; x += 15) {
            const y = 140 + Math.sin(x * 0.005 + waveOffset) * 50 + Math.cos(x * 0.003 - waveOffset * 0.8) * 30;
            ctx.lineTo(x, y);
        }

        ctx.lineTo(w, 0);
        ctx.closePath();

        const grad1 = ctx.createLinearGradient(0, 0, 0, 260);
        if (isWaveGreen) {
            grad1.addColorStop(0, 'rgba(34, 197, 94, 0.45)');
            grad1.addColorStop(0.6, 'rgba(16, 185, 129, 0.2)');
            grad1.addColorStop(1, 'rgba(34, 197, 94, 0)');
        } else {
            grad1.addColorStop(0, 'rgba(239, 68, 68, 0.5)');
            grad1.addColorStop(0.6, 'rgba(185, 28, 28, 0.22)');
            grad1.addColorStop(1, 'rgba(239, 68, 68, 0)');
        }
        ctx.fillStyle = grad1;
        ctx.fill();
        ctx.restore();

        // Wave 2 - Secondary ambient ripple
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 90 + Math.cos(waveOffset * 1.2) * 30);

        for (let x = 0; x <= w; x += 20) {
            const y = 90 + Math.cos(x * 0.007 - waveOffset * 1.1) * 45 + Math.sin(x * 0.002 + waveOffset * 0.5) * 20;
            ctx.lineTo(x, y);
        }

        ctx.lineTo(w, 0);
        ctx.closePath();

        const grad2 = ctx.createLinearGradient(0, 0, 0, 180);
        if (isWaveGreen) {
            grad2.addColorStop(0, 'rgba(52, 211, 153, 0.35)');
            grad2.addColorStop(1, 'rgba(16, 185, 129, 0)');
        } else {
            grad2.addColorStop(0, 'rgba(248, 113, 113, 0.35)');
            grad2.addColorStop(1, 'rgba(220, 38, 38, 0)');
        }
        ctx.fillStyle = grad2;
        ctx.fill();
        ctx.restore();

        if (overlay.classList.contains('active')) {
            animationFrameId = requestAnimationFrame(drawSpectralWaves);
        }
    }

    // State Management
    let isCurrentlyOffline = false;
    let retryTimerInterval = null;
    let retrySecondsRemaining = 4;
    let dismissalTimeout = null;

    function showOfflineOverlay() {
        if (isCurrentlyOffline) return;
        isCurrentlyOffline = true;
        isWaveGreen = false;

        if (dismissalTimeout) {
            clearTimeout(dismissalTimeout);
            dismissalTimeout = null;
        }

        overlay.classList.remove('online-mode');
        overlay.classList.add('active');

        // Reset text and icons
        document.getElementById('sentinel-icon').className = 'fas fa-exclamation-triangle';
        document.getElementById('sentinel-pill-text').textContent = 'Nora Offline';
        document.getElementById('sentinel-title').textContent = 'Backend Connection Lost';
        document.getElementById('sentinel-description').textContent = "Nora Assistant is currently unreachable or undergoing maintenance. We're actively monitoring for connectivity.";
        document.getElementById('sentinel-actions').style.display = 'flex';

        resizeCanvas();
        cancelAnimationFrame(animationFrameId);
        drawSpectralWaves();

        startRetryCountdown();
    }

    function showOnlineRecovery() {
        if (!isCurrentlyOffline) return;
        isCurrentlyOffline = false;
        isWaveGreen = true;

        clearInterval(retryTimerInterval);

        // Morph to Online state
        overlay.classList.add('online-mode');

        const iconEl = document.getElementById('sentinel-icon');
        iconEl.style.opacity = '0';
        setTimeout(() => {
            iconEl.className = 'fas fa-check';
            iconEl.style.opacity = '1';
        }, 200);

        document.getElementById('sentinel-pill-text').textContent = 'Online & Connected';
        document.getElementById('sentinel-title').textContent = 'Connection Restored!';
        document.getElementById('sentinel-description').textContent = 'Nora is back online and all systems are nominal. Resuming your workspace...';
        document.getElementById('sentinel-actions').style.display = 'none';

        // Auto-dismiss after 1.8 seconds of green checkmark celebration
        dismissalTimeout = setTimeout(() => {
            overlay.classList.remove('active');
            setTimeout(() => {
                overlay.classList.remove('online-mode');
                cancelAnimationFrame(animationFrameId);
            }, 600);
        }, 1800);
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
                await checkNoraHealth();
                if (isCurrentlyOffline) {
                    startRetryCountdown();
                }
            }
        }, 1000);
    }

    async function checkNoraHealth() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const res = await fetch('/api/status/public', { cache: 'no-store', signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data.systemStatus === 'offline' || data.systemStatus === 'outage') {
                    showOfflineOverlay();
                } else {
                    if (isCurrentlyOffline) {
                        showOnlineRecovery();
                    }
                }
            } else {
                showOfflineOverlay();
            }
        } catch (e) {
            showOfflineOverlay();
        }
    }

    window.noraSentinelRetryManual = async function() {
        const retryIcon = document.getElementById('sentinel-retry-icon');
        if (retryIcon) retryIcon.classList.add('spinning');
        await checkNoraHealth();
        setTimeout(() => {
            if (retryIcon) retryIcon.classList.remove('spinning');
        }, 600);
    };

    // Public API for testing and external events
    window.triggerNoraOffline = showOfflineOverlay;
    window.triggerNoraOnline = showOnlineRecovery;

    window.testSentinel = function(durationSeconds = 4) {
        showOfflineOverlay();
        setTimeout(() => {
            showOnlineRecovery();
        }, durationSeconds * 1000);
    };

    // Hotkey: Ctrl + Shift + O (or Cmd + Shift + O) to preview animation
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
            e.preventDefault();
            window.testSentinel(4);
        }
    });

    // Network & API Interceptor for immediate detection
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        try {
            const response = await originalFetch.apply(this, args);
            const urlStr = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            if ((urlStr.includes('/api/') || urlStr.includes('api.vaztinix.dev')) && (response.status === 502 || response.status === 503 || response.status === 504)) {
                showOfflineOverlay();
            }
            return response;
        } catch (err) {
            const urlStr = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            if (urlStr.includes('/api/') || urlStr.includes('api.vaztinix.dev') || urlStr.startsWith('/')) {
                showOfflineOverlay();
            }
            throw err;
        }
    };

    // Listen to native browser connection events
    window.addEventListener('offline', () => showOfflineOverlay());
    window.addEventListener('online', () => checkNoraHealth());

    // Continuous Heartbeat Polling (every 8 seconds in background)
    setInterval(() => {
        if (!isCurrentlyOffline) {
            checkNoraHealth();
        }
    }, 8000);
})();
