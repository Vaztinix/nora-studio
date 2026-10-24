const sharp = require('sharp');

/**
 * Escapes characters for safe inclusion in SVG text and attributes.
 */
function escapeXml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Fast, non-blocking image buffer fetcher using native fetch with timeout.
 */
async function fetchImageBuffer(url, timeoutMs = 2500) {
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
 * Resolves media links (Klipy, Tenor, OpenGraph, direct images) to direct URL.
 */
async function resolveDirectMediaUrl(url, timeoutMs = 2500) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('data:image')) return url;

    let isKlipy = false;
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'klipy.com' || parsed.hostname.endsWith('.klipy.com')) {
            isKlipy = true;
        }
    } catch (e) {}

    if (isKlipy) {
        const slugMatch = url.match(/klipy\.com\/(?:gifs|watch|clips|stickers|media)\/([a-zA-Z0-9_-]+)/i);
        if (slugMatch && slugMatch[1]) {
            const slug = slugMatch[1];
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                const klipyRes = await fetch(`https://api.klipy.com/api/v1/gifs/${slug}`, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                clearTimeout(timeoutId);
                if (klipyRes.ok) {
                    const kData = await klipyRes.json();
                    const directUrl = kData?.data?.file?.hd?.gif?.url || kData?.data?.file?.md?.gif?.url || kData?.data?.file?.hd?.webp?.url || kData?.data?.file?.md?.webp?.url || kData?.data?.file?.sm?.gif?.url;
                    if (directUrl) return directUrl;
                }
            } catch (e) {}
        }
    }

    const lower = url.toLowerCase();
    if (lower.match(/\.(gif|jpg|jpeg|png|webp)($|\?)/i)) {
        return url;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            clearTimeout(timeoutId);
            if (!res.ok) return url;
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('image/')) return url;

            const html = await res.text();
            const patterns = [
                /<meta\s+property=["']og:image:secure_url["']\s+content=["']([^"']+)["']/i,
                /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
                /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
                /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
                /(https?:\/\/[^"'\s\)]+\.(?:gif|webp|mp4|png|jpg|jpeg))/i
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
        } catch (e) {}
    }
    return url;
}

/**
 * Generates a high-performance Welcome or Departure card based on Nora's Rank Card Engine.
 * Only manageable by servers (server background, server shape, server accent, server template).
 * Features a circular centered PFP with user's name centered and more info below.
 *
 * @param {Object} options
 * @param {import('discord.js').GuildMember|Object} options.member - Discord GuildMember or user object
 * @param {import('discord.js').Guild|Object} options.guild - Discord Guild object
 * @param {boolean} [options.isExit=false] - Whether this is a departure / exit card
 * @param {string|null} [options.customMessage=null] - Subtext / formatted message
 * @param {string|null} [options.customAccent=null] - Server custom accent color (hex)
 * @param {string|null} [options.customBgUrl=null] - Server custom background image URL
 * @param {string|null} [options.serverShape='rounded-rect'] - Server card shape preset
 * @param {string|null} [options.shape=null] - Alias for serverShape
 * @param {string|null} [options.bgColor='#090a10'] - Base background color
 * @param {number|null} [options.memberCount=null] - Guild member count override
 * @returns {Promise<Buffer>} PNG or GIF buffer
 */
async function generateWelcomeCard({
    member,
    guild,
    isExit = false,
    customMessage = null,
    customAccent = null,
    customBgUrl = null,
    serverShape = null,
    shape = null,
    bgColor = '#090a10',
    memberCount = null
}) {
    const width = 860;
    const height = 360;
    const centerX = 430;

    const user = member?.user || member;
    const username = user?.username || 'Member';
    const displayName = user?.displayName || user?.globalName || user?.global_name || username;
    const guildName = guild?.name || 'Community Server';
    const totalMembers = memberCount ?? (guild?.memberCount || 1);

    // 1. Server shape preset (strict server control, defaults to 'rounded-rect')
    const rawShape = serverShape || shape || 'rounded-rect';
    const activeShape = ['rounded-rect', 'capsule', 'hexagon', 'diamond', 'classic'].includes(rawShape)
        ? rawShape
        : 'rounded-rect';

    // 2. Server accent color
    let accentColor = isExit ? '#F43F5E' : '#5865F2';
    if (customAccent && typeof customAccent === 'string' && customAccent.startsWith('#')) {
        accentColor = customAccent;
    } else if (user?.accentColor && !isExit) {
        accentColor = '#' + user.accentColor.toString(16).padStart(6, '0');
    }

    // 3. Avatar Processing (114x114 circle centered at x=430, y=116)
    const avatarSize = 114;
    const avatarRadius = avatarSize / 2;
    const avatarLeft = Math.round(centerX - avatarRadius); // 373
    const avatarTop = 59; // center at y=116

    let avatarPngBuffer = null;
    const avatarUrl = user?.displayAvatarURL
        ? (typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ extension: 'png', size: 256 }) : user.displayAvatarURL)
        : (user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : null);

    if (avatarUrl) {
        try {
            const rawAvatar = await fetchImageBuffer(avatarUrl, 2500);
            if (rawAvatar) {
                const circleSvg = `<svg width="${avatarSize}" height="${avatarSize}"><circle cx="${avatarRadius}" cy="${avatarRadius}" r="${avatarRadius}" fill="#fff"/></svg>`;
                const circleMask = Buffer.from(circleSvg);
                const resized = await sharp(rawAvatar).resize(avatarSize, avatarSize).png().toBuffer();
                avatarPngBuffer = await sharp(resized)
                    .composite([{ input: circleMask, blend: 'dest-in' }])
                    .png()
                    .toBuffer();
            }
        } catch (avatarErr) {
            console.warn('[Welcome Card] Avatar processing fallback used:', avatarErr.message);
        }
    }

    // 4. Server Background Image (Static or Animated GIF)
    const finalBgImage = customBgUrl || null;
    let customBgBase64 = '';
    let isAnimatedGif = false;
    let animatedBgBuffer = null;

    if (finalBgImage) {
        try {
            const resolvedUrl = await Promise.race([
                resolveDirectMediaUrl(finalBgImage, 1500),
                new Promise((r) => setTimeout(() => r(finalBgImage), 1500))
            ]);

            const rawBuffer = await fetchImageBuffer(resolvedUrl, 3000);
            if (rawBuffer) {
                let meta = null;
                try {
                    meta = await sharp(rawBuffer, { animated: true }).metadata();
                } catch (e) {}

                const totalPages = meta?.pages || 1;
                const isGifHeader = rawBuffer.slice(0, 3).toString() === 'GIF';
                isAnimatedGif = totalPages > 1 || isGifHeader || (typeof resolvedUrl === 'string' && (resolvedUrl.toLowerCase().includes('.gif') || resolvedUrl.includes('klipy') || resolvedUrl.includes('tenor') || resolvedUrl.includes('giphy')));

                if (isAnimatedGif && totalPages > 1) {
                    try {
                        const safePages = Math.min(totalPages, 12);
                        animatedBgBuffer = await sharp(rawBuffer, { animated: true, page: 0, pages: safePages })
                            .resize(width, height, { fit: 'cover', position: 'center' })
                            .toBuffer();
                    } catch (gifErr) {
                        console.warn('[Welcome Card] Animated background resize failed, falling back to static:', gifErr.message);
                        isAnimatedGif = false;
                    }
                }

                if (!isAnimatedGif || !animatedBgBuffer) {
                    isAnimatedGif = false;
                    const pngBuffer = await sharp(rawBuffer)
                        .resize(width, height, { fit: 'cover', position: 'center' })
                        .png()
                        .toBuffer();
                    customBgBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                }
            }
        } catch (bgErr) {
            console.warn('[Welcome Card] Custom background processing fallback used:', bgErr.message);
        }
    }

    // 5. Shape SVG Path Definitions
    let cardMaskShapeSvg = `<rect width="${width}" height="${height}" rx="24" fill="#ffffff" />`;
    let borderSvg = `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="23" fill="none" stroke="url(#borderGrad)" stroke-width="1.8" />`;

    if (activeShape === 'capsule') {
        cardMaskShapeSvg = `<rect width="${width}" height="${height}" rx="54" fill="#ffffff" />`;
        borderSvg = `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="53" fill="none" stroke="url(#borderGrad)" stroke-width="1.8" />`;
    } else if (activeShape === 'hexagon') {
        cardMaskShapeSvg = `<polygon points="50,0 ${width - 50},0 ${width},${height / 2} ${width - 50},${height} 50,${height} 0,${height / 2}" fill="#ffffff" />`;
        borderSvg = `<polygon points="50,1 ${width - 50},1 ${width - 1},${height / 2} ${width - 50},${height - 1} 50,${height - 1} 1,${height / 2}" fill="none" stroke="url(#borderGrad)" stroke-width="1.8" />`;
    } else if (activeShape === 'classic') {
        cardMaskShapeSvg = `<rect width="${width}" height="${height}" rx="8" fill="#ffffff" />`;
        borderSvg = `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="7" fill="none" stroke="url(#borderGrad)" stroke-width="1.8" />`;
    } else if (activeShape === 'diamond') {
        cardMaskShapeSvg = `<rect width="${width}" height="${height}" rx="32" fill="#ffffff" />`;
        borderSvg = `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="31" fill="none" stroke="url(#borderGrad)" stroke-width="2" />`;
    }

    // 6. Text Sanitization and Truncation
    const safeDisplayName = escapeXml(displayName.length > 24 ? displayName.slice(0, 23) + '…' : displayName);
    const safeUsername = escapeXml(username.length > 28 ? username.slice(0, 27) + '…' : username);
    const safeGuildName = escapeXml(guildName.length > 30 ? guildName.slice(0, 29) + '…' : guildName);
    const rawSubtext = customMessage 
        ? customMessage.slice(0, 60) 
        : (isExit ? 'We will miss you! Safe travels.' : 'We are delighted to have you in our community!');
    const safeSubtext = escapeXml(rawSubtext);
    const initial = escapeXml((displayName || username || 'M').charAt(0).toUpperCase());

    const statusBadge = isExit ? 'DEPARTURE' : 'NEW MEMBER';
    const mainBannerTitle = isExit 
        ? `FAREWELL FROM ${safeGuildName.toUpperCase()} • ${totalMembers.toLocaleString()} MEMBERS`
        : `WELCOME TO ${safeGuildName.toUpperCase()} • MEMBER #${totalMembers.toLocaleString()}`;

    // 7. Compose SVG String with Centered Layout
    const svgString = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${bgColor || '#080a12'}" />
                <stop offset="50%" stop-color="#0c101c" />
                <stop offset="100%" stop-color="#05070c" />
            </linearGradient>

            <radialGradient id="avatarGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.65" />
                <stop offset="65%" stop-color="${accentColor}" stop-opacity="0.18" />
                <stop offset="100%" stop-color="${accentColor}" stop-opacity="0" />
            </radialGradient>

            <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.85" />
                <stop offset="50%" stop-color="#ffffff" stop-opacity="0.25" />
                <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.70" />
            </linearGradient>

            <linearGradient id="bannerPillGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.28" />
                <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.14" />
            </linearGradient>

            <linearGradient id="bannerPillBorder" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="rgba(255, 255, 255, 0.45)" />
                <stop offset="50%" stop-color="${accentColor}" stop-opacity="0.65" />
                <stop offset="100%" stop-color="rgba(255, 255, 255, 0.2)" />
            </linearGradient>

            <pattern id="bgPattern" width="40" height="40" patternUnits="userSpaceOnUse">
                <line x1="0" y1="0" x2="40" y2="0" stroke="rgba(255, 255, 255, 0.03)" stroke-width="1"/>
                <line x1="0" y1="0" x2="0" y2="40" stroke="rgba(255, 255, 255, 0.03)" stroke-width="1"/>
            </pattern>

            <clipPath id="cardClip">
                ${cardMaskShapeSvg}
            </clipPath>
        </defs>

        <g clip-path="url(#cardClip)">
            <!-- Base Canvas Fill -->
            <rect width="${width}" height="${height}" fill="url(#bgGrad)" />

            <!-- Optional Server Background Image -->
            ${customBgBase64 ? `
            <image href="${customBgBase64}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
            <rect width="${width}" height="${height}" fill="rgba(6, 8, 14, 0.55)" />
            ` : ''}

            <!-- Tech Geometric Pattern Overlay -->
            <rect width="${width}" height="${height}" fill="url(#bgPattern)" />

            <!-- Top Status Pill -->
            <rect x="350" y="20" width="160" height="24" rx="12" fill="rgba(255, 255, 255, 0.06)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />
            <text x="${centerX}" y="36" text-anchor="middle" font-family="'Segoe UI', -apple-system, Roboto, sans-serif" font-size="11" font-weight="700" fill="${accentColor}" letter-spacing="1.5">
                ${statusBadge}
            </text>

            <!-- Centered Circular PFP Outer Halo & Specular Rings -->
            <circle cx="${centerX}" cy="116" r="92" fill="url(#avatarGlow)" />
            <circle cx="${centerX}" cy="116" r="64" fill="none" stroke="${accentColor}" stroke-width="2.5" opacity="0.85" />
            <circle cx="${centerX}" cy="116" r="60" fill="none" stroke="rgba(255, 255, 255, 0.28)" stroke-width="1" />

            <!-- Fallback PFP Placeholder if avatar unavailable -->
            ${!avatarPngBuffer ? `
            <circle cx="${centerX}" cy="116" r="57" fill="#181c2e" />
            <text x="${centerX}" y="130" text-anchor="middle" font-family="'Segoe UI', -apple-system, Roboto, sans-serif" font-size="40" font-weight="800" fill="#ffffff">${initial}</text>
            ` : ''}

            <!-- Centered Name Directly Below PFP -->
            <text x="${centerX}" y="206" text-anchor="middle" font-family="'Segoe UI', -apple-system, Roboto, sans-serif" font-size="26" font-weight="800" fill="#ffffff" letter-spacing="-0.02em">
                ${safeDisplayName}
            </text>
            <text x="${centerX}" y="228" text-anchor="middle" font-family="'Segoe UI', -apple-system, Roboto, sans-serif" font-size="14" font-weight="600" fill="#94a3b8">
                @${safeUsername}
            </text>

            <!-- More Info Below: Centered Banner Pill -->
            <rect x="160" y="246" width="540" height="40" rx="20" fill="url(#bannerPillGrad)" stroke="url(#bannerPillBorder)" stroke-width="1.2" />
            <text x="${centerX}" y="271" text-anchor="middle" font-family="'Segoe UI', -apple-system, Roboto, sans-serif" font-size="14" font-weight="800" fill="#ffffff" letter-spacing="0.3">
                ${mainBannerTitle}
            </text>

            <!-- Subtitle Context Note -->
            <text x="${centerX}" y="310" text-anchor="middle" font-family="'Segoe UI', -apple-system, Roboto, sans-serif" font-size="13" font-weight="500" fill="#cbd5e1">
                ${safeSubtext}
            </text>

            <!-- Nora Studio Zero-Access Security Tag -->
            <text x="${centerX}" y="336" text-anchor="middle" font-family="'Segoe UI', -apple-system, Roboto, sans-serif" font-size="10" font-weight="700" fill="rgba(255, 255, 255, 0.26)" letter-spacing="1.5">
                NORA STUDIO • PRIVACY FIRST
            </text>

            <!-- Outer Shaped Border -->
            ${borderSvg}
        </g>
    </svg>
    `.trim();

    // 8. Render Base PNG
    const basePngBuffer = await sharp(Buffer.from(svgString))
        .png({ compressionLevel: 6, quality: 100 })
        .toBuffer();

    // 9. Composite Circular Avatar directly on top
    const compositedBuffer = avatarPngBuffer
        ? await sharp(basePngBuffer)
            .composite([{ input: avatarPngBuffer, top: avatarTop, left: avatarLeft }])
            .png()
            .toBuffer()
        : basePngBuffer;

    // 10. Handle Animated Background GIF if present
    if (isAnimatedGif && animatedBgBuffer) {
        try {
            const animMeta = await sharp(animatedBgBuffer, { animated: true }).metadata().catch(() => null);
            const totalPages = animMeta?.pages || 1;
            const maskSvg = `<svg width="${width}" height="${height}">${cardMaskShapeSvg}</svg>`;
            const maskBuffer = await sharp(Buffer.from(maskSvg)).png().toBuffer();

            const overlayCopies = [];
            for (let i = 0; i < totalPages; i++) {
                overlayCopies.push({ input: compositedBuffer, top: i * height, left: 0 });
            }

            const multiPageHeight = height * totalPages;
            const fullOverlay = await sharp({
                create: {
                    width: width,
                    height: multiPageHeight,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            })
            .composite(overlayCopies)
            .png()
            .toBuffer();

            const finalGif = await sharp(animatedBgBuffer, { animated: true })
                .composite([
                    { input: fullOverlay, top: 0, left: 0 },
                    { input: maskBuffer, blend: 'dest-in' }
                ])
                .gif({ loop: 0 })
                .toBuffer();

            return finalGif;
        } catch (gifErr) {
            console.warn('[Welcome Card] Animated composite failed, falling back to composited PNG:', gifErr.message);
            return compositedBuffer;
        }
    }

    return compositedBuffer;
}

module.exports = {
    generateWelcomeCard,
    fetchImageBuffer,
    resolveDirectMediaUrl
};
