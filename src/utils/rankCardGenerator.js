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
                .resize(120, 120)
                .png()
                .toBuffer();
            avatarBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        } catch (e) {
            console.error('Error fetching/processing avatar for rank card:', e.message);
        }
    }

    const progressPercent = Math.min(100, Math.max(0, (currentXp / nextLevelXp) * 100));
    const barWidth = Math.round((progressPercent / 100) * 440);

    const svgString = `
    <svg width="800" height="220" viewBox="0 0 800 220" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <!-- Premium Dark Indigo Gradient for Progress Bar -->
            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#7c3aed" />
                <stop offset="100%" stop-color="#4f46e5" />
            </linearGradient>
            
            <!-- Circular Avatar Clip -->
            <clipPath id="avatarClip">
                <circle cx="100" cy="110" r="60" />
            </clipPath>
        </defs>

        <!-- Background base (Solid rich obsidian/slate) -->
        <rect width="800" height="220" rx="16" fill="#111217" />
        
        <!-- Subtle clean card border -->
        <rect x="0.75" y="0.75" width="798.5" height="218.5" rx="15.25" fill="none" stroke="#23252e" stroke-width="1.5" />

        <!-- Avatar border & image -->
        <circle cx="100" cy="110" r="64" fill="none" stroke="#2d3039" stroke-width="2" />
        ${avatarBase64 ? `
        <image href="${avatarBase64}" x="40" y="50" width="120" height="120" clip-path="url(#avatarClip)" />
        ` : `
        <circle cx="100" cy="110" r="60" fill="#18191e" />
        <text x="100" y="122" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="bold" fill="#7c3aed" text-anchor="middle">@</text>
        `}

        <!-- Rank Badge (top right pill) -->
        <rect x="640" y="35" width="120" height="36" rx="18" fill="#18191e" stroke="#2d3039" stroke-width="1.5" />
        <text x="700" y="59" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#e4e4e7" text-anchor="middle">RANK #${rank}</text>

        <!-- Username -->
        <text x="190" y="75" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="900" fill="#ffffff" letter-spacing="-0.5">@${username}</text>

        <!-- Level indicator -->
        <text x="190" y="125" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="bold" fill="#a78bfa">LEVEL ${level}</text>

        <!-- XP info -->
        <text x="630" y="125" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="bold" fill="#a1a1aa" text-anchor="end">${currentXp.toLocaleString()} <tspan fill="#52525b">/ ${nextLevelXp.toLocaleString()} XP</tspan></text>

        <!-- Progress Bar container -->
        <rect x="190" y="145" width="440" height="24" rx="12" fill="#18191e" stroke="#23252e" stroke-width="1" />
        <!-- Progress fill -->
        ${barWidth > 0 ? `<rect x="190" y="145" width="${barWidth}" height="24" rx="12" fill="url(#progressGrad)" />` : ''}
    </svg>
    `.trim();

    return await sharp(Buffer.from(svgString))
        .png()
        .toBuffer();
}

module.exports = {
    generateRankCard
};
