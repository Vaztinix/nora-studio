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
async function resolveDirectMediaUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('data:image')) return url;

    const lower = url.toLowerCase();
    // If direct image extension, return as is
    if (lower.match(/\.(gif|jpg|jpeg|png|webp)($|\?)/i)) {
        return url;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
        try {
            const htmlRes = await axios.get(url, { 
                timeout: 5000, 
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
                } 
            });

            const contentType = htmlRes.headers['content-type'] || '';
            if (contentType.includes('image/')) {
                return url;
            }

            const html = String(htmlRes.data);
            
            const patterns = [
                /<meta\s+property=["']og:image:secure_url["']\s+content=["']([^"']+)["']/i,
                /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
                /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
                /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
                /<meta\s+property=["']og:video["']\s+content=["']([^"']+)["']/i,
                /<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i,
                /"contentUrl"\s*:\s*["']([^"']+)["']/i,
                /"gif"\s*:\s*["']([^"']+)["']/i,
                /(https?:\/\/[^"'\s\)]+\.(?:gif|webp|mp4|png))/i
            ];

            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match) {
                    let mediaUrl = match[1] || match[0];
                    if (mediaUrl) {
                        mediaUrl = mediaUrl.replace(/&amp;/g, '&');
                        if (mediaUrl.startsWith('//')) mediaUrl = 'https:' + mediaUrl;
                        return mediaUrl;
                    }
                }
            }
        } catch (e) {
            console.error('Error resolving webpage GIF link:', e.message);
        }
    }
    return url;
}

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

    let avatarPngBuffer = null;
    if (showPfp && avatarUrl) {
        try {
            const avatarRes = await axios.get(avatarUrl, {
                responseType: 'arraybuffer',
                timeout: 2500,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }).catch(() => null);

            if (avatarRes && avatarRes.data) {
                // Circle clip for avatar
                const circleSvg = `<svg width="120" height="120"><circle cx="60" cy="60" r="60" fill="#fff"/></svg>`;
                const circleMask = Buffer.from(circleSvg);

                const resizedAvatar = await sharp(avatarRes.data)
                    .resize(120, 120)
                    .png()
                    .toBuffer();

                avatarPngBuffer = await sharp(resizedAvatar)
                    .composite([{ input: circleMask, blend: 'dest-in' }])
                    .png()
                    .toBuffer();
            }
        } catch (e) {
            console.warn('[Rank Generator] Avatar fetch/processing error:', e.message);
        }
    }

    let customBgBase64 = '';
    let isAnimatedGif = false;
    let animatedBgBuffer = null;

    if (finalBgImage) {
        try {
            const resolvedUrl = await Promise.race([
                resolveDirectMediaUrl(finalBgImage),
                new Promise((_, r) => setTimeout(() => r(new Error('URL resolution timeout')), 2000))
            ]);

            let rawBuffer;
            if (resolvedUrl.startsWith('data:image')) {
                const base64Data = resolvedUrl.split(',')[1];
                rawBuffer = Buffer.from(base64Data, 'base64');
                if (resolvedUrl.startsWith('data:image/gif')) isAnimatedGif = true;
            } else {
                const bgRes = await axios.get(resolvedUrl, { 
                    responseType: 'arraybuffer', 
                    timeout: 2000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                }).catch(() => null);
                if (bgRes && bgRes.data) {
                    rawBuffer = Buffer.from(bgRes.data);
                    const isGifHeader = rawBuffer.slice(0, 3).toString() === 'GIF';
                    if (isGifHeader || resolvedUrl.toLowerCase().includes('.gif') || resolvedUrl.includes('klipy') || resolvedUrl.includes('tenor') || resolvedUrl.includes('giphy')) {
                        isAnimatedGif = true;
                    }
                }
            }

            if (rawBuffer) {
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
            }
        } catch (e) {
            console.warn('[Rank Generator] Custom background processing fallback used:', e.message);
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

    const svgBgFill = isAnimatedGif ? 'none' : bgColor;
    const svgOverlayFill = isAnimatedGif ? 'rgba(10, 11, 16, 0.55)' : 'rgba(10, 11, 16, 0.45)';

    const svgString = `
    <svg width="800" height="220" viewBox="0 0 800 220" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="${accentColor}" />
                <stop offset="100%" stop-color="${accentColor}88" />
            </linearGradient>

            <pattern id="bgPattern" width="800" height="220" patternUnits="userSpaceOnUse">
                <rect width="800" height="220" fill="${svgBgFill}" />
                ${(!isAnimatedGif && customBgBase64) ? `<image href="${customBgBase64}" x="0" y="0" width="800" height="220" preserveAspectRatio="xMidYMid slice" />` : ''}
                <rect width="800" height="220" fill="${svgOverlayFill}" />
            </pattern>
        </defs>

        <!-- Base Shape Fill with Background Pattern -->
        ${cardClipSvg}
        
        <!-- Shape Outline -->
        ${borderSvg}

        <!-- Avatar border placeholder -->
        <circle cx="100" cy="110" r="64" fill="none" stroke="${accentColor}" stroke-width="3" />
        ${!avatarPngBuffer ? `<circle cx="100" cy="110" r="60" fill="${bgColor}" /><text x="100" y="122" font-family="Segoe UI, Arial, sans-serif" font-size="36" font-weight="bold" fill="${accentColor}" text-anchor="middle">@</text>` : ''}

        <!-- Rank Badge -->
        <rect x="640" y="35" width="120" height="36" rx="18" fill="rgba(10, 11, 16, 0.75)" stroke="${accentColor}" stroke-width="1.5" />
        <text x="700" y="59" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="bold" fill="#e4e4e7" text-anchor="middle">RANK #${rank}</text>

        <!-- Username -->
        <text x="190" y="75" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="900" fill="#ffffff" letter-spacing="-0.5">@${username}</text>

        <!-- Level indicator -->
        <text x="190" y="125" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="bold" fill="${accentColor}">LEVEL ${level}</text>

        <!-- XP info -->
        <text x="630" y="125" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="bold" fill="#a1a1aa" text-anchor="end">${currentXp.toLocaleString()} <tspan fill="#71717a">/ ${nextLevelXp.toLocaleString()} XP</tspan></text>

        <!-- Progress Bar container -->
        <rect x="190" y="145" width="440" height="24" rx="12" fill="rgba(10, 11, 16, 0.65)" stroke="${borderColor}" stroke-width="1" />
        <!-- Progress fill -->
        ${barWidth > 0 ? `<rect x="190" y="145" width="${barWidth}" height="24" rx="12" fill="url(#progressGrad)" />` : ''}
    </svg>
    `.trim();

    const basePngBuffer = await sharp(Buffer.from(svgString))
        .png({ compressionLevel: 8, quality: 85 })
        .toBuffer();

    const composited = avatarPngBuffer 
        ? await sharp(basePngBuffer).composite([{ input: avatarPngBuffer, left: 40, top: 50 }]).png().toBuffer()
        : basePngBuffer;

    if (isAnimatedGif && animatedBgBuffer) {
        try {
            return await sharp(animatedBgBuffer, { animated: true })
                .composite([{ input: composited, tile: false }])
                .gif({ loop: 0 })
                .toBuffer();
        } catch(compErr) {
            console.error('Error compositing animated GIF rank card:', compErr.message);
        }
    }

    return composited;

    return basePngBuffer;
}

module.exports = {
    generateRankCard
};
