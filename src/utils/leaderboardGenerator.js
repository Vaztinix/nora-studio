const axios = require('axios');
const sharp = require('sharp');
const { getTotalXPForLevel } = require('./noraLeveling');

/**
 * Fast non-blocking image buffer fetcher using native fetch and AbortController.
 */
async function fetchImageBuffer(url, timeoutMs = 1500) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('data:image')) {
        try {
            const base64Data = url.split(',')[1];
            return Buffer.from(base64Data, 'base64');
        } catch (e) {
            return null;
        }
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
    } catch (e) {
        return null;
    }
}

/**
 * Generates a beautiful leaderboard card image buffer with modern Obsidian Glass aesthetics.
 * @param {Object} options
 * @param {string} options.guildName
 * @param {number} options.page
 * @param {number} options.totalPages
 * @param {Array<Object>} options.users List of resolved user objects
 * @returns {Promise<Buffer>} PNG Image buffer
 */
async function generateLeaderboard({ guildName, page, totalPages, users, bgColor = '#090a10', accentColor = '#6366f1', borderColor = '#232538' }) {
    // Fetch and process all avatars in parallel
    const avatarPromises = users.map(async (u) => {
        if (u.avatarUrl) {
            try {
                const rawAvatar = await fetchImageBuffer(u.avatarUrl, 1500);
                if (rawAvatar) {
                    const circleSvg = `<svg width="52" height="52"><circle cx="26" cy="26" r="26" fill="#fff"/></svg>`;
                    const circleMask = Buffer.from(circleSvg);

                    const resized = await sharp(rawAvatar)
                        .resize(52, 52)
                        .png()
                        .toBuffer();

                    const avatarPng = await sharp(resized)
                        .composite([{ input: circleMask, blend: 'dest-in' }])
                        .png()
                        .toBuffer();

                    return { userId: u.userId, base64: `data:image/png;base64,${avatarPng.toString('base64')}` };
                }
            } catch (e) {
                // Silently fallback
            }
        }
        return { userId: u.userId, base64: '' };
    });

    const resolvedAvatars = await Promise.all(avatarPromises);
    const avatarMap = new Map(resolvedAvatars.map(a => [a.userId, a.base64]));

    const headerHeight = 110;
    const rowHeight = 76;
    const footerHeight = 44;
    const totalHeight = headerHeight + (users.length * rowHeight) + footerHeight;

    let svgRows = '';
    users.forEach((u, index) => {
        const yOffset = headerHeight + (index * rowHeight);
        const avatarBase64 = avatarMap.get(u.userId);
        
        // Progress bar calculations
        const currentLevel = u.level || 0;
        const totalXpRaw = u.totalXp || 0;
        const xpFloor = getTotalXPForLevel(currentLevel);
        const xpGoal = getTotalXPForLevel(currentLevel + 1);
        const xpProgress = Math.max(0, totalXpRaw - xpFloor);
        const xpStep = Math.max(1, xpGoal - xpFloor);
        const progressPercent = Math.min(100, Math.max(0, (xpProgress / xpStep) * 100));
        const barWidth = Math.round((progressPercent / 100) * 580);

        // Rank colors & styling
        let rankColor = '#94a3b8';
        let rankBadgeFill = 'rgba(255, 255, 255, 0.04)';
        let rankBadgeStroke = 'rgba(255, 255, 255, 0.08)';

        if (u.rank === 1) {
            rankColor = '#fbbf24'; // Gold
            rankBadgeFill = 'rgba(251, 191, 36, 0.15)';
            rankBadgeStroke = '#fbbf24';
        } else if (u.rank === 2) {
            rankColor = '#cbd5e1'; // Silver
            rankBadgeFill = 'rgba(203, 213, 225, 0.15)';
            rankBadgeStroke = '#cbd5e1';
        } else if (u.rank === 3) {
            rankColor = '#f59e0b'; // Bronze
            rankBadgeFill = 'rgba(245, 158, 11, 0.15)';
            rankBadgeStroke = '#f59e0b';
        }

        const safeUsername = String(u.username || 'User').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        svgRows += `
        <!-- Floating Row Container -->
        <g transform="translate(36, ${yOffset})">
            <rect width="768" height="66" rx="14" fill="rgba(255, 255, 255, 0.025)" stroke="rgba(255, 255, 255, 0.06)" stroke-width="1"/>
            
            <!-- Rank Badge -->
            <rect x="14" y="15" width="48" height="36" rx="10" fill="${rankBadgeFill}" stroke="${rankBadgeStroke}" stroke-width="1.2"/>
            <text x="38" y="38" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="14" font-weight="900" fill="${rankColor}" text-anchor="middle">#${u.rank}</text>

            <!-- Avatar -->
            ${avatarBase64 ? `
            <image href="${avatarBase64}" x="74" y="7" width="52" height="52" />
            ` : `
            <circle cx="100" cy="33" r="26" fill="#181a28" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
            <text x="100" y="40" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="900" fill="${accentColor}" text-anchor="middle">@</text>
            `}
            <circle cx="100" cy="33" r="26" fill="none" stroke="${rankBadgeStroke}" stroke-width="1.5" />

            <!-- Username -->
            <text x="142" y="32" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="16" font-weight="800" fill="#ffffff">@${safeUsername}</text>
            
            <!-- Level Chip -->
            <rect x="142" y="40" width="64" height="18" rx="9" fill="rgba(99, 102, 241, 0.15)" stroke="${accentColor}" stroke-opacity="0.4" stroke-width="1"/>
            <text x="174" y="53" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="10" font-weight="900" fill="#818cf8" text-anchor="middle">LVL ${u.level}</text>

            <!-- XP Stats Right -->
            <text x="750" y="32" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="15" font-weight="800" fill="#ffffff" text-anchor="end">
                ${u.totalXp.toLocaleString()} <tspan fill="#64748b" font-weight="600" font-size="12">XP</tspan>
            </text>

            <!-- Progress Bar Track -->
            <rect x="216" y="47" width="534" height="6" rx="3" fill="rgba(0, 0, 0, 0.5)" stroke="rgba(255,255,255,0.05)" stroke-width="0.5" />
            <!-- Progress Bar Fill -->
            ${barWidth > 0 ? `<rect x="216" y="47" width="${Math.min(534, Math.round((progressPercent / 100) * 534))}" height="6" rx="3" fill="url(#progressGrad)" />` : ''}
        </g>
        `;
    });

    const safeGuildHeader = String(guildName || 'Leaderboard').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const svgString = `
    <svg width="840" height="${totalHeight}" viewBox="0 0 840 ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="obsidianBg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#090a10" />
                <stop offset="50%" stop-color="#11131f" />
                <stop offset="100%" stop-color="#07080d" />
            </linearGradient>

            <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#6366f1" />
                <stop offset="100%" stop-color="#38bdf8" />
            </linearGradient>

            <!-- Progress Bar Gradient -->
            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="${accentColor}" />
                <stop offset="100%" stop-color="#38bdf8" />
            </linearGradient>

            <radialGradient id="lbGlow1" cx="15%" cy="10%" r="50%">
                <stop offset="0%" stop-color="rgba(99, 102, 241, 0.20)" />
                <stop offset="100%" stop-color="transparent" />
            </radialGradient>

            <radialGradient id="lbGlow2" cx="85%" cy="90%" r="50%">
                <stop offset="0%" stop-color="rgba(56, 189, 248, 0.12)" />
                <stop offset="100%" stop-color="transparent" />
            </radialGradient>
        </defs>

        <!-- Base Canvas Fill -->
        <rect width="840" height="${totalHeight}" rx="24" fill="url(#obsidianBg)" />
        <rect width="840" height="${totalHeight}" rx="24" fill="url(#lbGlow1)" />
        <rect width="840" height="${totalHeight}" rx="24" fill="url(#lbGlow2)" />
        
        <!-- Subtle Tech Mesh -->
        <path d="M 0 55 L 840 55 M 0 110 L 840 110" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>
        <path d="M 210 0 L 210 ${totalHeight} M 420 0 L 420 ${totalHeight} M 630 0 L 630 ${totalHeight}" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>

        <!-- Outer Glass Border -->
        <rect x="1.5" y="1.5" width="837" height="${totalHeight - 3}" rx="22.5" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" />

        <!-- Header -->
        <rect x="36" y="32" width="6" height="46" rx="3" fill="url(#brandGrad)" />
        <text x="54" y="56" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" font-weight="900" fill="#ffffff" letter-spacing="-0.5">SERVER XP LEADERBOARD</text>
        <text x="54" y="76" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="800" fill="${accentColor}" letter-spacing="0.5">${safeGuildHeader.toUpperCase()}</text>
        
        <!-- Page Pill Badge -->
        <rect x="676" y="38" width="128" height="34" rx="17" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        <text x="740" y="59" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="800" fill="#94a3b8" text-anchor="middle" letter-spacing="0.5">PAGE ${page} OF ${totalPages}</text>

        <!-- Divider below header -->
        <line x1="36" y1="96" x2="804" y2="96" stroke="rgba(255,255,255,0.06)" stroke-width="1" />

        <!-- User Rows -->
        ${svgRows}

        <!-- Footer -->
        <text x="420" y="${totalHeight - 16}" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="700" fill="#64748b" text-anchor="middle" letter-spacing="1">NORA LEADERBOARD MATRIX • VAZTINIX.DEV</text>
    </svg>
    `.trim();

    return await sharp(Buffer.from(svgString))
        .png({ compressionLevel: 8, quality: 85 })
        .toBuffer();
}

module.exports = {
    generateLeaderboard
};

