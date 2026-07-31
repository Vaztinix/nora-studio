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
/**
 * Generates a rank card image buffer with custom image backgrounds and shape presets.
 * Member uploaded changes ALWAYS overwrite server settings.
 */
async function generateRankCard({ 
    username, 
    level, 
    currentXp, 
    nextLevelXp, 
    rank, 
    avatarUrl, 
    showPfp = true, 
    bgColor = '#111217', 
    accentColor = '#7c3aed', 
    borderColor = '#23252e',
    // Member image & shape (takes priority)
    userCustomBg = null,
    userShape = null,
    // Server fallbacks
    serverCustomBg = null,
    serverShape = 'rounded-rect'
}) {
    // Member changes ALWAYS overwrite server changes
    const finalBgImage = userCustomBg || serverCustomBg || null;
    const rawShape = (userShape && userShape !== 'default') ? userShape : (serverShape || 'rounded-rect');
    const shape = ['rounded-rect', 'capsule', 'hexagon', 'diamond', 'classic'].includes(rawShape) ? rawShape : 'rounded-rect';

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

    let customBgBase64 = '';
    let isAnimatedGif = false;
    let animatedBgBuffer = null;

    if (finalBgImage) {
        try {
            let rawBuffer;
            if (finalBgImage.startsWith('data:image')) {
                const base64Data = finalBgImage.split(',')[1];
                rawBuffer = Buffer.from(base64Data, 'base64');
                if (finalBgImage.startsWith('data:image/gif')) isAnimatedGif = true;
            } else {
                const response = await axios.get(finalBgImage, { responseType: 'arraybuffer', timeout: 7000 });
                rawBuffer = Buffer.from(response.data);
                if (finalBgImage.toLowerCase().includes('.gif') || finalBgImage.includes('tenor') || finalBgImage.includes('giphy')) {
                    isAnimatedGif = true;
                }
            }

            if (isAnimatedGif) {
                try {
                    animatedBgBuffer = await sharp(rawBuffer, { animated: true })
                        .resize(800, 220, { fit: 'cover' })
                        .toBuffer();
                } catch(gifErr) {
                    isAnimatedGif = false;
                    const pngBuffer = await sharp(rawBuffer)
                        .resize(800, 220, { fit: 'cover' })
                        .png()
                        .toBuffer();
                    customBgBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                }
            } else {
                const pngBuffer = await sharp(rawBuffer)
                    .resize(800, 220, { fit: 'cover' })
                    .png()
                    .toBuffer();
                customBgBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            }
        } catch (e) {
            console.error('Error processing custom rank card background:', e.message);
        }
    }

    const progressPercent = Math.min(100, Math.max(0, (currentXp / nextLevelXp) * 100));
    const barWidth = Math.round((progressPercent / 100) * 440);

    // Dynamic Shape Clips
    let rx = 16;
    let cardClipSvg = '<rect width="800" height="220" rx="16" fill="url(#bgPattern)" />';
    let borderSvg = '<rect x="0.75" y="0.75" width="798.5" height="218.5" rx="15.25" fill="none" stroke="' + borderColor + '" stroke-width="1.5" />';

    if (shape === 'capsule') {
        rx = 40;
        cardClipSvg = '<rect width="800" height="220" rx="40" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="0.75" y="0.75" width="798.5" height="218.5" rx="39.25" fill="none" stroke="' + borderColor + '" stroke-width="1.5" />';
    } else if (shape === 'hexagon') {
        cardClipSvg = '<polygon points="40,0 760,0 800,110 760,220 40,220 0,110" fill="url(#bgPattern)" />';
        borderSvg = '<polygon points="40,0 760,0 800,110 760,220 40,220 0,110" fill="none" stroke="' + borderColor + '" stroke-width="1.5" />';
    } else if (shape === 'classic') {
        rx = 4;
        cardClipSvg = '<rect width="800" height="220" rx="4" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="0.75" y="0.75" width="798.5" height="218.5" rx="3.25" fill="none" stroke="' + borderColor + '" stroke-width="1.5" />';
    } else if (shape === 'diamond') {
        rx = 24;
        cardClipSvg = '<rect width="800" height="220" rx="24" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="0.75" y="0.75" width="798.5" height="218.5" rx="23.25" fill="none" stroke="' + borderColor + '" stroke-width="2" />';
    }

    const svgString = `
    <svg width="800" height="220" viewBox="0 0 800 220" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="${accentColor}" />
                <stop offset="100%" stop-color="${accentColor}88" />
            </linearGradient>
            
            <clipPath id="avatarClip">
                <circle cx="100" cy="110" r="60" />
            </clipPath>

            <pattern id="bgPattern" width="800" height="220" patternUnits="userSpaceOnUse">
                <rect width="800" height="220" fill="${bgColor}" />
                ${customBgBase64 ? `<image href="${customBgBase64}" x="0" y="0" width="800" height="220" preserveAspectRatio="xMidYMid slice" />` : ''}
                <rect width="800" height="220" fill="rgba(10, 11, 16, 0.45)" />
            </pattern>
        </defs>

        <!-- Base Shape Fill with Background Pattern -->
        ${cardClipSvg}
        
        <!-- Shape Outline -->
        ${borderSvg}

        <!-- Avatar border & image -->
        <circle cx="100" cy="110" r="64" fill="none" stroke="${borderColor}" stroke-width="2" />
        ${avatarBase64 ? `
        <image href="${avatarBase64}" x="40" y="50" width="120" height="120" clip-path="url(#avatarClip)" />
        ` : `
        <circle cx="100" cy="110" r="60" fill="${bgColor}" />
        <text x="100" y="122" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="bold" fill="${accentColor}" text-anchor="middle">@</text>
        `}

        <!-- Rank Badge -->
        <rect x="640" y="35" width="120" height="36" rx="18" fill="rgba(10, 11, 16, 0.75)" stroke="${borderColor}" stroke-width="1.5" />
        <text x="700" y="59" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#e4e4e7" text-anchor="middle">RANK #${rank}</text>

        <!-- Username -->
        <text x="190" y="75" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="900" fill="#ffffff" letter-spacing="-0.5">@${username}</text>

        <!-- Level indicator -->
        <text x="190" y="125" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="bold" fill="${accentColor}">LEVEL ${level}</text>

        <!-- XP info -->
        <text x="630" y="125" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="bold" fill="#a1a1aa" text-anchor="end">${currentXp.toLocaleString()} <tspan fill="#71717a">/ ${nextLevelXp.toLocaleString()} XP</tspan></text>

        <!-- Progress Bar container -->
        <rect x="190" y="145" width="440" height="24" rx="12" fill="rgba(10, 11, 16, 0.65)" stroke="${borderColor}" stroke-width="1" />
        <!-- Progress fill -->
        ${barWidth > 0 ? `<rect x="190" y="145" width="${barWidth}" height="24" rx="12" fill="url(#progressGrad)" />` : ''}
    </svg>
    `.trim();

    if (isAnimatedGif && animatedBgBuffer) {
        try {
            const overlaySvg = svgString.replace('fill="url(#bgPattern)"', 'fill="none"');
            const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer();

            return await sharp(animatedBgBuffer, { animated: true })
                .composite([{ input: overlayPng, tile: false }])
                .gif({ loop: 0 })
                .toBuffer();
        } catch(compErr) {
            console.error('Error compositing animated GIF rank card:', compErr.message);
        }
    }

    return await sharp(Buffer.from(svgString))
        .png()
        .toBuffer();
}

module.exports = {
    generateRankCard
};
