const axios = require('axios');
const sharp = require('sharp');
const { getTotalXPForLevel } = require('./noraLeveling');

/**
 * Generates a beautiful leaderboard card image buffer.
 * @param {Object} options
 * @param {string} options.guildName
 * @param {number} options.page
 * @param {number} options.totalPages
 * @param {Array<Object>} options.users List of resolved user objects
 * @returns {Promise<Buffer>} PNG Image buffer
 */
async function generateLeaderboard({ guildName, page, totalPages, users }) {
    // Fetch and process all avatars in parallel
    const avatarPromises = users.map(async (u) => {
        if (u.avatarUrl) {
            try {
                const response = await axios.get(u.avatarUrl, { responseType: 'arraybuffer', timeout: 3000 });
                const pngBuffer = await sharp(response.data)
                    .resize(48, 48)
                    .png()
                    .toBuffer();
                return { userId: u.userId, base64: `data:image/png;base64,${pngBuffer.toString('base64')}` };
            } catch (e) {
                // Silently ignore avatar fetch error and fallback
            }
        }
        return { userId: u.userId, base64: '' };
    });

    const resolvedAvatars = await Promise.all(avatarPromises);
    const avatarMap = new Map(resolvedAvatars.map(a => [a.userId, a.base64]));

    const headerHeight = 95;
    const rowHeight = 80;
    const footerHeight = 20;
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
        const xpProgress = totalXpRaw - xpFloor;
        const xpStep = xpGoal - xpFloor;
        const progressPercent = Math.min(100, Math.max(0, (xpProgress / xpStep) * 100));
        const barWidth = Math.round((progressPercent / 100) * 570);

        // Rank colors
        let rankColor = '#a1a1aa';
        if (u.rank === 1) rankColor = '#fbbf24'; // Gold
        else if (u.rank === 2) rankColor = '#9ca3af'; // Silver
        else if (u.rank === 3) rankColor = '#d97706'; // Bronze

        svgRows += `
        <!-- Row Divider -->
        ${index > 0 ? `<line x1="40" y1="${yOffset}" x2="760" y2="${yOffset}" stroke="#23252e" stroke-width="1" />` : ''}

        <!-- Avatar clip path for this row -->
        <clipPath id="clip-${u.userId}">
            <circle cx="80" cy="${yOffset + 40}" r="24" />
        </clipPath>

        <!-- Avatar -->
        ${avatarBase64 ? `
        <image href="${avatarBase64}" x="56" y="${yOffset + 16}" width="48" height="48" clip-path="url(#clip-${u.userId})" />
        ` : `
        <circle cx="80" cy="${yOffset + 40}" r="24" fill="#18191e" />
        <text x="80" y="${yOffset + 47}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="bold" fill="#7c3aed" text-anchor="middle">@</text>
        `}
        <circle cx="80" cy="${yOffset + 40}" r="25" fill="none" stroke="#2d3039" stroke-width="1.5" />

        <!-- Rank & Username -->
        <text x="130" y="${yOffset + 42}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="bold" fill="${rankColor}">#${u.rank}</text>
        <text x="190" y="${yOffset + 42}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="bold" fill="#ffffff">@${u.username}</text>

        <!-- Level & XP -->
        <text x="760" y="${yOffset + 42}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="bold" fill="#a1a1aa" text-anchor="end">
            <tspan fill="#7c3aed">LVL</tspan> ${u.level}  <tspan fill="#52525b">•</tspan>  ${u.totalXp.toLocaleString()} <tspan fill="#52525b">XP</tspan>
        </text>

        <!-- Row Progress Bar track -->
        <rect x="190" y="${yOffset + 54}" width="570" height="4" rx="2" fill="#18191e" />
        <!-- Row Progress Bar fill -->
        ${barWidth > 0 ? `<rect x="190" y="${yOffset + 54}" width="${barWidth}" height="4" rx="2" fill="url(#progressGrad)" />` : ''}
        `;
    });

    const svgString = `
    <svg width="800" height="${totalHeight}" viewBox="0 0 800 ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <!-- Progress Bar Gradient -->
            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#7c3aed" />
                <stop offset="100%" stop-color="#4f46e5" />
            </linearGradient>
        </defs>

        <!-- Background base -->
        <rect width="800" height="${totalHeight}" rx="16" fill="#111217" />
        
        <!-- Subtle clean card border -->
        <rect x="0.75" y="0.75" width="798.5" height="${totalHeight - 1.5}" rx="15.25" fill="none" stroke="#23252e" stroke-width="1.5" />

        <!-- Header -->
        <text x="40" y="38" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#ffffff" letter-spacing="-0.5">LEADERBOARD</text>
        <text x="40" y="58" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#7c3aed">${guildName.toUpperCase()}</text>
        
        <text x="760" y="48" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#52525b" text-anchor="end">PAGE ${page} OF ${totalPages}</text>

        <!-- Divider below header -->
        <line x1="40" y1="78" x2="760" y2="78" stroke="#2d3039" stroke-width="2" />

        <!-- User Rows -->
        ${svgRows}
    </svg>
    `.trim();

    return await sharp(Buffer.from(svgString))
        .png()
        .toBuffer();
}

module.exports = {
    generateLeaderboard
};
