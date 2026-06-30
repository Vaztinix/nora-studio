const axios = require('axios');
const sharp = require('sharp');

/**
 * Generates a beautiful rank card image buffer using a custom premium layout.
 * @param {Object} options
 * @param {string} options.username
 * @param {number} options.level
 * @param {number} options.currentXp
 * @param {number} options.nextLevelXp
 * @param {number} options.rank
 * @param {string} options.avatarUrl
 * @param {boolean} [options.showPfp=true]
 * @returns {Promise<Buffer>} PNG Image buffer
 */
async function generateRankCard({ username, level, currentXp, nextLevelXp, rank, avatarUrl, showPfp = true }) {
    let avatarBase64 = '';
    if (showPfp && avatarUrl) {
        try {
            const response = await axios.get(avatarUrl, { responseType: 'arraybuffer', timeout: 5000 });
            const pngBuffer = await sharp(response.data)
                .resize(130, 130)
                .png()
                .toBuffer();
            avatarBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        } catch (e) {
            console.error('Error fetching/processing avatar for rank card:', e.message);
        }
    }

    const progressPercent = Math.min(100, Math.max(0, (currentXp / nextLevelXp) * 100));
    const barWidthPercent = Math.round((progressPercent / 100) * 565);

    const svgString = `
    <svg width="800" height="220" viewBox="0 0 800 220" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <clipPath id="avatarClip">
                <rect x="40" y="45" width="130" height="130" rx="20" />
            </clipPath>
            <linearGradient id="minimalGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#ffffff" />
                <stop offset="100%" stop-color="#a1a1aa" />
            </linearGradient>
        </defs>

        <!-- Dark base card -->
        <rect width="800" height="220" rx="24" fill="#09090b" />
        <rect x="1" y="1" width="798" height="218" rx="23" fill="none" stroke="#27272a" stroke-width="2" />

        <!-- Avatar -->
        ${avatarBase64 ? `
        <image href="${avatarBase64}" x="40" y="45" width="130" height="130" clip-path="url(#avatarClip)" />
        ` : `
        <rect x="40" y="45" width="130" height="130" rx="20" fill="#18181b" />
        <text x="105" y="125" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="48" font-weight="600" fill="#a1a1aa" text-anchor="middle">@</text>
        `}
        <rect x="40" y="45" width="130" height="130" rx="20" fill="none" stroke="#27272a" stroke-width="1.5" />

        <!-- Metadata Info -->
        <text x="195" y="80" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="34" font-weight="800" fill="#ffffff" letter-spacing="-0.03em">@${username}</text>
        <text x="195" y="120" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="#a1a1aa" letter-spacing="0.05em">LEVEL ${level}   •   RANK #${rank}</text>
        <text x="760" y="120" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff" text-anchor="end">${currentXp.toLocaleString()} <tspan fill="#71717a">/ ${nextLevelXp.toLocaleString()} XP</tspan></text>

        <!-- Ultra-sleek minimalist Progress Bar -->
        <rect x="195" y="145" width="565" height="8" rx="4" fill="#18181b" />
        ${barWidthPercent > 0 ? `<rect x="195" y="145" width="${barWidthPercent}" height="8" rx="4" fill="url(#minimalGrad)" />` : ''}
    </svg>
    `.trim();

    return await sharp(Buffer.from(svgString))
        .png()
        .toBuffer();
}

module.exports = {
    generateRankCard
};
