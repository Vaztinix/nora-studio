/**
 * Nora Studio - Privacy-First Monetization & Sponsor Engine
 * Supports EthicalAds, Carbon Ads, and Curated Zero-Tracking Partner Cards.
 * Automatically disables all ads for Nora Studio Plus & Lifetime Entitlement subscribers.
 */
(function() {
    // Curated high-converting, privacy-friendly sponsor pool
    const SPONSOR_POOL = [
        {
            id: 'bisect-hosting',
            name: 'BisectHosting',
            tagline: 'High-Performance Bot & Game Server Hosting',
            description: 'Ultra-low latency server hosting for Discord bots, Node.js clusters & Minecraft communities. 24/7 support & instant setup.',
            cta: 'Get 25% Off with code NORA',
            url: 'https://www.bisecthosting.com/?utm_source=nora_studio&utm_medium=partner&utm_campaign=nora_bot',
            badge: 'Server Partner',
            icon: 'fa-server',
            accent: '#38bdf8'
        },
        {
            id: 'railway-cloud',
            name: 'Railway Cloud',
            tagline: 'Instant DevOps & Cloud Bot Deployments',
            description: 'Deploy Discord bots, PostgreSQL & Redis clusters with zero configuration. Scale effortlessly from free sandbox to production.',
            cta: 'Deploy in 30 Seconds',
            url: 'https://railway.com/?utm_source=nora_studio&utm_medium=partner',
            badge: 'Cloud Partner',
            icon: 'fa-cloud',
            accent: '#a855f7'
        },
        {
            id: 'proton-privacy',
            name: 'Proton Privacy Suite',
            tagline: 'Zero-Access Encryption for Mail & VPN',
            description: 'Swiss-based encrypted email, VPN, and cloud storage engineered for complete zero-access data sovereignty.',
            cta: 'Protect Your Identity',
            url: 'https://proton.me/?utm_source=nora_studio&utm_medium=privacy_partner',
            badge: 'Privacy Partner',
            icon: 'fa-user-shield',
            accent: '#10b981'
        }
    ];

    function isUserAdFree() {
        if (window.currentUser && (window.currentUser.isPlus || window.currentUser.isLifetime || window.currentUser.isDeveloper)) {
            return true;
        }
        if (window.userHasAnyPremium) {
            return true;
        }
        const userStr = localStorage.getItem('nora_current_user');
        if (userStr) {
            try {
                const u = JSON.parse(userStr);
                if (u && (u.isPlus || u.isLifetime || u.isDeveloper)) return true;
            } catch (_) {}
        }
        return false;
    }

    function getRandomSponsor() {
        const idx = Math.floor(Math.random() * SPONSOR_POOL.length);
        return SPONSOR_POOL[idx];
    }

    function renderPartnerCard(container, layout = 'compact') {
        if (!container || isUserAdFree()) {
            if (container) container.style.display = 'none';
            return;
        }

        const sponsor = getRandomSponsor();
        const isCompact = layout === 'compact';

        container.style.display = 'block';
        container.innerHTML = `
            <div class="nora-ad-box ${isCompact ? 'compact' : 'wide'}" data-sponsor-id="${sponsor.id}">
                <div class="nora-ad-header">
                    <span class="nora-ad-badge" style="color: ${sponsor.accent}; border-color: ${sponsor.accent}33; background: ${sponsor.accent}14;">
                        <i class="fas ${sponsor.icon}"></i> ${sponsor.badge}
                    </span>
                    <a href="https://discord.com/application-directory/1375943730951098549/store/1490857354609168534" target="_blank" class="nora-ad-remove-link" title="Upgrade to Nora Studio Plus for 100% ad-free experience">
                        <i class="fas fa-crown"></i> Hide with Plus
                    </a>
                </div>
                <div class="nora-ad-body">
                    <h5 class="nora-ad-title">${sponsor.name}</h5>
                    <p class="nora-ad-tagline">${sponsor.tagline}</p>
                    ${!isCompact ? `<p class="nora-ad-desc">${sponsor.description}</p>` : ''}
                </div>
                <div class="nora-ad-footer">
                    <a href="${sponsor.url}" target="_blank" rel="noopener noreferrer sponsored" class="nora-ad-cta-btn" style="background: ${sponsor.accent}1f; border-color: ${sponsor.accent}4d; color: ${sponsor.accent};">
                        <span>${sponsor.cta}</span>
                        <i class="fas fa-arrow-right" style="font-size: 0.75rem;"></i>
                    </a>
                </div>
            </div>
        `;
    }

    function injectStyles() {
        if (document.getElementById('nora-ad-styles')) return;
        const style = document.createElement('style');
        style.id = 'nora-ad-styles';
        style.textContent = `
            .nora-ad-box {
                background: linear-gradient(145deg, rgba(255, 255, 255, 0.045) 0%, rgba(255, 255, 255, 0.015) 100%), rgba(14, 18, 28, 0.65);
                border: 1px solid rgba(255, 255, 255, 0.09);
                border-top: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 16px;
                padding: 12px 14px;
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08);
                transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
                position: relative;
                overflow: hidden;
            }
            .nora-ad-box:hover {
                transform: translateY(-2px);
                border-color: rgba(255, 255, 255, 0.18);
            }
            .nora-ad-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
            }
            .nora-ad-badge {
                font-size: 0.68rem;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.6px;
                padding: 2px 7px;
                border-radius: 999px;
                border: 1px solid;
                display: inline-flex;
                align-items: center;
                gap: 5px;
            }
            .nora-ad-remove-link {
                font-size: 0.68rem;
                color: #94a3b8;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-weight: 600;
                transition: color 0.2s ease;
            }
            .nora-ad-remove-link:hover {
                color: #fbbf24;
            }
            .nora-ad-title {
                font-size: 0.88rem;
                font-weight: 800;
                color: #ffffff;
                margin: 0 0 2px 0;
            }
            .nora-ad-tagline {
                font-size: 0.74rem;
                color: #cbd5e1;
                margin: 0;
                line-height: 1.35;
            }
            .nora-ad-desc {
                font-size: 0.72rem;
                color: #94a3b8;
                margin: 6px 0 0 0;
                line-height: 1.4;
            }
            .nora-ad-footer {
                margin-top: 10px;
            }
            .nora-ad-cta-btn {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
                padding: 7px 12px;
                border-radius: 10px;
                border: 1px solid;
                font-size: 0.75rem;
                font-weight: 700;
                text-decoration: none;
                transition: all 0.2s ease;
                box-sizing: border-box;
            }
            .nora-ad-cta-btn:hover {
                filter: brightness(1.15);
                transform: translateX(1px);
            }
        `;
        document.head.appendChild(style);
    }

    function initAds() {
        injectStyles();
        
        // Slot 1: Dashboard Left Sidebar
        const sidebarSlot = document.getElementById('nora-ad-sidebar-slot');
        if (sidebarSlot) renderPartnerCard(sidebarSlot, 'compact');

        // Slot 2: Verification Portal
        const verifySlot = document.getElementById('nora-ad-verify-slot');
        if (verifySlot) renderPartnerCard(verifySlot, 'wide');
    }

    window.refreshNoraAds = function() {
        initAds();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAds);
    } else {
        initAds();
    }
})();
