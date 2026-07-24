const axios = require('axios');
const sharp = require('sharp');

/**
 * Generates a Level-Up card image buffer with custom image background & shape presets.
 * Member uploaded changes ALWAYS overwrite server settings.
 */
async function generateLevelUpCard({ 
    oldLevel, 
    newLevel, 
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
                .resize(80, 80)
                .png()
                .toBuffer();
            avatarBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        } catch (e) {
            console.error('Error fetching/processing avatar for level up card:', e.message);
        }
    }

    let customBgBase64 = '';
    if (finalBgImage) {
        try {
            if (finalBgImage.startsWith('data:image')) {
                customBgBase64 = finalBgImage;
            } else {
                const response = await axios.get(finalBgImage, { responseType: 'arraybuffer', timeout: 7000 });
                const pngBuffer = await sharp(response.data)
                    .resize(400, 140, { fit: 'cover' })
                    .png()
                    .toBuffer();
                customBgBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            }
        } catch (e) {
            console.error('Error processing custom level-up card background:', e.message);
        }
    }

    // Dynamic Shape Clips
    let rx = 16;
    let cardClipSvg = '<rect width="400" height="140" rx="16" fill="url(#bgPattern)" />';
    let borderSvg = '<rect x="0.75" y="0.75" width="398.5" height="138.5" rx="15.25" fill="none" stroke="' + borderColor + '" stroke-width="1.5" />';

    if (shape === 'capsule') {
        rx = 30;
        cardClipSvg = '<rect width="400" height="140" rx="30" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="0.75" y="0.75" width="398.5" height="138.5" rx="29.25" fill="none" stroke="' + borderColor + '" stroke-width="1.5" />';
    } else if (shape === 'hexagon') {
        cardClipSvg = '<polygon points="25,0 375,0 400,70 375,140 25,140 0,70" fill="url(#bgPattern)" />';
        borderSvg = '<polygon points="25,0 375,0 400,70 375,140 25,140 0,70" fill="none" stroke="' + borderColor + '" stroke-width="1.5" />';
    } else if (shape === 'classic') {
        rx = 4;
        cardClipSvg = '<rect width="400" height="140" rx="4" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="0.75" y="0.75" width="398.5" height="138.5" rx="3.25" fill="none" stroke="' + borderColor + '" stroke-width="1.5" />';
    } else if (shape === 'diamond') {
        rx = 20;
        cardClipSvg = '<rect width="400" height="140" rx="20" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="0.75" y="0.75" width="398.5" height="138.5" rx="19.25" fill="none" stroke="' + borderColor + '" stroke-width="2" />';
    }

    const svgString = `
    <svg width="400" height="140" viewBox="0 0 400 140" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <clipPath id="avatarClip">
                <circle cx="60" cy="70" r="36" />
            </clipPath>

            <pattern id="bgPattern" width="400" height="140" patternUnits="userSpaceOnUse">
                <rect width="400" height="140" fill="${bgColor}" />
                ${customBgBase64 ? `<image href="${customBgBase64}" x="0" y="0" width="400" height="140" preserveAspectRatio="xMidYMid slice" />` : ''}
                <rect width="400" height="140" fill="rgba(10, 11, 16, 0.45)" />
            </pattern>
        </defs>

        <!-- Base Shape Fill with Background Pattern -->
        ${cardClipSvg}
        
        <!-- Shape Outline -->
        ${borderSvg}

        <!-- Avatar border & image -->
        <circle cx="60" cy="70" r="40" fill="none" stroke="${borderColor}" stroke-width="2" />
        ${avatarBase64 ? `
        <image href="${avatarBase64}" x="24" y="34" width="72" height="72" clip-path="url(#avatarClip)" />
        ` : `
        <circle cx="60" cy="70" r="36" fill="${bgColor}" />
        <text x="60" y="76" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="bold" fill="${accentColor}" text-anchor="middle">@</text>
        `}

        <!-- Level-up Text details -->
        <text x="130" y="62" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="900" fill="#ffffff" letter-spacing="-0.5">Level-up!</text>
        
        <text x="130" y="98" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="bold" fill="${accentColor}">
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
