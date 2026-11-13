/**
 * Nora Studio - Temporary Site Lockout & Official Hiatus Notice
 * Founder: Damien Adams (Demi)
 * Relaunch: January 5, 2027
 */
(function initNoraLockout() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    function applyLockout() {
        try {
            localStorage.removeItem('nora_lockout_target_time');
        } catch(e) {}

        const existing = document.getElementById('nora-lockout-overlay');
        if (existing) existing.remove();
        const existingStyles = document.getElementById('nora-lockout-styles');
        if (existingStyles) existingStyles.remove();

        // Lock body and html scrolling
        try {
            document.documentElement.style.overflow = 'hidden';
            if (document.body) {
                document.body.style.overflow = 'hidden';
            }
        } catch (e) {}

        const style = document.createElement('style');
        style.id = 'nora-lockout-styles';
        style.textContent = `
            #nora-lockout-overlay {
                position: fixed !important;
                inset: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 2147483647 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 24px !important;
                box-sizing: border-box !important;
                background: rgba(3, 4, 8, 0.94) !important;
                backdrop-filter: blur(24px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(24px) saturate(180%) !important;
                font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                color: #f3f4f6 !important;
                user-select: none !important;
                -webkit-user-select: none !important;
                pointer-events: all !important;
                animation: noraLockFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
                overflow-y: auto !important;
            }

            @keyframes noraLockFadeIn {
                from { opacity: 0; transform: scale(0.98); }
                to { opacity: 1; transform: scale(1); }
            }

            .nora-lockout-card {
                position: relative !important;
                width: 100% !important;
                max-width: 640px !important;
                background: linear-gradient(180deg, #111424 0%, #0a0c16 100%) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                border-top: 2px solid #ef4444 !important;
                border-radius: 20px !important;
                box-shadow: 0 30px 90px rgba(0, 0, 0, 0.85), 0 0 50px rgba(239, 68, 68, 0.16) !important;
                padding: 36px 32px !important;
                text-align: center !important;
                box-sizing: border-box !important;
                margin: auto !important;
            }

            .nora-lockout-pill {
                display: inline-flex !important;
                align-items: center !important;
                gap: 8px !important;
                padding: 6px 16px !important;
                border-radius: 9999px !important;
                background: rgba(239, 68, 68, 0.12) !important;
                border: 1px solid rgba(239, 68, 68, 0.35) !important;
                color: #fca5a5 !important;
                font-size: 0.76rem !important;
                font-weight: 700 !important;
                letter-spacing: 0.05em !important;
                text-transform: uppercase !important;
                margin-bottom: 18px !important;
            }

            .nora-lockout-dot {
                width: 8px !important;
                height: 8px !important;
                border-radius: 50% !important;
                background: #ef4444 !important;
                box-shadow: 0 0 10px #ef4444 !important;
                animation: noraLockPulse 1.6s infinite !important;
            }

            @keyframes noraLockPulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.35; transform: scale(0.85); }
            }

            .nora-lockout-icon {
                width: 64px !important;
                height: 64px !important;
                margin: 0 auto 16px auto !important;
                border-radius: 18px !important;
                background: rgba(239, 68, 68, 0.12) !important;
                border: 1px solid rgba(239, 68, 68, 0.32) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                color: #ef4444 !important;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 8px 24px rgba(239, 68, 68, 0.22) !important;
            }

            .nora-lockout-icon svg {
                width: 32px !important;
                height: 32px !important;
                fill: currentColor !important;
            }

            .nora-lockout-title {
                font-size: 1.75rem !important;
                font-weight: 800 !important;
                letter-spacing: -0.03em !important;
                color: #ffffff !important;
                margin: 0 0 8px 0 !important;
                line-height: 1.2 !important;
            }

            .nora-lockout-desc {
                font-size: 1.02rem !important;
                color: #e5e7eb !important;
                line-height: 1.5 !important;
                margin: 0 0 20px 0 !important;
            }

            .nora-lockout-desc strong {
                color: #f87171 !important;
            }

            .nora-lockout-callout {
                background: rgba(239, 68, 68, 0.08) !important;
                border: 1px solid rgba(239, 68, 68, 0.28) !important;
                border-radius: 14px !important;
                padding: 16px 20px !important;
                margin-bottom: 20px !important;
                text-align: left !important;
            }

            .nora-lockout-callout-header {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                font-size: 0.94rem !important;
                font-weight: 700 !important;
                color: #fca5a5 !important;
                margin-bottom: 8px !important;
                text-transform: uppercase !important;
                letter-spacing: 0.04em !important;
            }

            .nora-lockout-callout-header svg {
                width: 18px !important;
                height: 18px !important;
                fill: #ef4444 !important;
                flex-shrink: 0 !important;
            }

            .nora-lockout-callout-text {
                font-size: 0.9rem !important;
                color: #d1d5db !important;
                line-height: 1.65 !important;
                margin: 0 0 12px 0 !important;
            }

            .nora-lockout-founder-sign {
                font-size: 0.88rem !important;
                font-weight: 700 !important;
                color: #ffffff !important;
                border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
                padding-top: 10px !important;
                margin-top: 10px !important;
                font-style: italic !important;
            }

            .nora-lockout-return-box {
                background: linear-gradient(135deg, rgba(88, 101, 242, 0.12) 0%, rgba(139, 92, 246, 0.12) 100%) !important;
                border: 1px solid rgba(99, 102, 241, 0.35) !important;
                border-radius: 14px !important;
                padding: 16px 20px !important;
                margin-bottom: 20px !important;
                text-align: left !important;
            }

            .nora-lockout-return-title {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                font-size: 0.94rem !important;
                font-weight: 700 !important;
                color: #c7d2fe !important;
                margin-bottom: 6px !important;
                text-transform: uppercase !important;
                letter-spacing: 0.04em !important;
            }

            .nora-lockout-return-title svg {
                width: 18px !important;
                height: 18px !important;
                fill: #818cf8 !important;
                flex-shrink: 0 !important;
            }

            .nora-lockout-return-text {
                font-size: 0.88rem !important;
                color: #e0e7ff !important;
                line-height: 1.55 !important;
                margin: 0 !important;
            }

            .nora-lockout-return-text strong {
                color: #ffffff !important;
            }

            .nora-lockout-grid {
                display: grid !important;
                grid-template-columns: repeat(3, 1fr) !important;
                gap: 8px !important;
                margin-bottom: 20px !important;
            }

            .nora-lockout-grid-item {
                background: rgba(255, 255, 255, 0.03) !important;
                border: 1px solid rgba(255, 255, 255, 0.06) !important;
                border-radius: 10px !important;
                padding: 10px 8px !important;
                text-align: center !important;
            }

            .nora-lockout-grid-label {
                font-size: 0.72rem !important;
                color: #6b7280 !important;
                text-transform: uppercase !important;
                letter-spacing: 0.03em !important;
                margin-bottom: 4px !important;
                display: block !important;
            }

            .nora-lockout-grid-val {
                font-size: 0.82rem !important;
                font-weight: 700 !important;
                color: #f87171 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 5px !important;
            }

            .nora-lockout-footer {
                font-size: 0.76rem !important;
                color: #4b5563 !important;
                margin: 0 !important;
                letter-spacing: 0.02em !important;
            }
        `;
        document.head.appendChild(style);

        const overlay = document.createElement('div');
        overlay.id = 'nora-lockout-overlay';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'nora-lockout-title');

        overlay.innerHTML = `
            <div class="nora-lockout-card">
                <div class="nora-lockout-pill">
                    <span class="nora-lockout-dot"></span>
                    <span>Official Hiatus &bull; Relaunching January 5, 2027</span>
                </div>

                <div class="nora-lockout-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                    </svg>
                </div>

                <h1 class="nora-lockout-title" id="nora-lockout-title">Nora is Currently Unavailable</h1>
                <p class="nora-lockout-desc">The application and API is currently <strong>offline</strong>.</p>

                <div class="nora-lockout-callout">
                    <div class="nora-lockout-callout-header">
                        <svg viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                        </svg>
                        <span>This is not a mistake.</span>
                    </div>
                    <p class="nora-lockout-callout-text">
                        Nora is going on Hiatus and during the mean time we are going to fix core stability issues, relaunch with V3 rewrites of all code and release Nora Studio Dashboard 5.0.0 with our relaunch introducing our own new UI System which we will be calling Flux UI which will rely on Discord's API heavily to make server stats update more often without hitting those limits we all hate but know are there for a reason. We will launch with 2 new shards automatically seperating our servers early on with brand new hardware to power Nora. Not every leave is bad that is why we are taking the time to bring Nora into the spotlight. So don't get too upset because by the time you know it we will be back on our feet stronger than ever possibly even surpassing the bots we call mainstream.
                    </p>
                    <div class="nora-lockout-founder-sign">
                        "Never give up on your dreams" &mdash; Damien Adams (Demi) | Founder of Nora and Nora Studio's. Lets all build a better future together.
                    </div>
                </div>

                <div class="nora-lockout-return-box">
                    <div class="nora-lockout-return-title">
                        <svg viewBox="0 0 24 24">
                            <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/>
                        </svg>
                        <span>Official Return &bull; January 5, 2027</span>
                    </div>
                    <p class="nora-lockout-return-text">
                        We are returning on <strong>January 5, 2027</strong> with a brand new <strong>YouTube Channel</strong>, <strong>X</strong>, and our own <strong>support domain</strong>. This is where the future of Nora begins.
                    </p>
                </div>

                <div class="nora-lockout-grid">
                    <div class="nora-lockout-grid-item">
                        <span class="nora-lockout-grid-label">Application</span>
                        <span class="nora-lockout-grid-val"><span class="nora-lockout-dot" style="width:6px;height:6px;"></span> Offline</span>
                    </div>
                    <div class="nora-lockout-grid-item">
                        <span class="nora-lockout-grid-label">API Gateway</span>
                        <span class="nora-lockout-grid-val"><span class="nora-lockout-dot" style="width:6px;height:6px;"></span> Offline</span>
                    </div>
                    <div class="nora-lockout-grid-item">
                        <span class="nora-lockout-grid-label">Discord Bot</span>
                        <span class="nora-lockout-grid-val"><span class="nora-lockout-dot" style="width:6px;height:6px;"></span> Offline</span>
                    </div>
                </div>

                <p class="nora-lockout-footer">Nora Studio Security Shield &bull; Zero-Access Architecture</p>
            </div>
        `;

        if (document.body) {
            document.body.appendChild(overlay);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                document.body.appendChild(overlay);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyLockout);
    } else {
        applyLockout();
    }
})();
