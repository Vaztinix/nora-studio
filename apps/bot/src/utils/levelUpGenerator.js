const axios = require('axios');
const sharp = require('sharp');

/**
 * Generates a beautiful Level-Up card image buffer.
 * @param {Object} options
 * @param {number} options.oldLevel
 * @param {number} options.newLevel
 * @param {string} options.avatarUrl
 * @param {boolean} [options.showPfp=true]
 * @returns {Promise<Buffer>} PNG Image buffer
 */
async function generateLevelUpCard({ oldLevel, newLevel, avatarUrl, showPfp = true }) {
    let avatarBase64 = '';
    if (showPfp && avatarUrl) {
        try {
            const response = await axios.get(avatarUrl, { responseType: 'arraybuffer', timeout: 5000 });
            const pngBuffer = await sharp(response.data)
                .resize(80, 80)
                .png()
                .toBuffer();
            avatarBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        } catch (e) {
            console.error('Error fetching/processing avatar for level up card:', e.message);
        }
    }

    const svgString = `
    <svg width="400" height="140" viewBox="0 0 400 140" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <!-- Circular Avatar Clip -->
            <clipPath id="avatarClip">
                <circle cx="60" cy="70" r="36" />
            </clipPath>
        </defs>

        <!-- Background base -->
        <rect width="400" height="140" rx="16" fill="#111217" />
        
        <!-- Subtle clean card border -->
        <rect x="0.75" y="0.75" width="398.5" height="138.5" rx="15.25" fill="none" stroke="#23252e" stroke-width="1.5" />

        <!-- Avatar border & image -->
        <circle cx="60" cy="70" r="40" fill="none" stroke="#2d3039" stroke-width="2" />
        ${avatarBase64 ? `
        <image href="${avatarBase64}" x="24" y="34" width="72" height="72" clip-path="url(#avatarClip)" />
        ` : `
        <circle cx="60" cy="70" r="36" fill="#18191e" />
        <text x="60" y="76" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="bold" fill="#7c3aed" text-anchor="middle">@</text>
        `}

        <!-- Level-up Text details -->
        <text x="130" y="62" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="900" fill="#ffffff" letter-spacing="-0.5">Level-up!</text>
        
        <text x="130" y="98" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="bold" fill="#7c3aed">
            ${oldLevel} <tspan fill="#a1a1aa" font-weight="normal">•</tspan> ${newLevel}
        </text>
    </svg>
    `.trim();

    return await sharp(Buffer.from(svgString))
        .png()
        .toBuffer();
}

module.exports = {
    generateLevelUpCard
};
