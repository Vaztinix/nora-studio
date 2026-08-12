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
}

/**
 * Generates an official digital Personal ID Card image buffer (PNG).
 */
async function generateUserIdCard({
    username,
    userId,
    guildName,
    avatarUrl,
    level = 0,
    currentXp = 0,
    nextLevelXp = 100,
    totalXp = 0,
    rank = 'N/A',
    isPremium = false,
    isOwner = false,
    isPromoter = false,
    clearance = 'Member',
    joinedAt = 'N/A',
    createdAt = 'N/A',
    bio = '',
    robloxText = 'Not Verified',
    badges = [],
    accentColor = '#7c3aed'
}) {
    const width = 900;
    const height = 520;

    let avatarPngBuffer = null;
    if (avatarUrl) {
        try {
            const avatarRes = await axios.get(avatarUrl, {
                responseType: 'arraybuffer',
                timeout: 3000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }).catch(() => null);

            if (avatarRes && avatarRes.data) {
                const maskSvg = `<svg width="140" height="140"><rect width="140" height="140" rx="18" fill="#fff"/></svg>`;
                const maskBuffer = Buffer.from(maskSvg);

                const resizedAvatar = await sharp(avatarRes.data)
                    .resize(140, 140)
                    .png()
                    .toBuffer();

                avatarPngBuffer = await sharp(resizedAvatar)
                    .composite([{ input: maskBuffer, blend: 'dest-in' }])
                    .png()
                    .toBuffer();
            }
        } catch (e) {
            console.warn('[ID Card Generator] Avatar fetch error:', e.message);
        }
    }

    let headerAccent = accentColor || '#7c3aed';
    if (isOwner || isPremium) headerAccent = '#FFD700';
    else if (isPromoter) headerAccent = '#FF007A';

    const progressPct = Math.min(100, Math.max(0, Math.floor((currentXp / Math.max(1, nextLevelXp)) * 100)));
    const barWidth = Math.floor((progressPct / 100) * 350);

    const safeUser = String(username || 'User').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeGuild = String(guildName || 'Nora Network').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeBio = String(bio || 'No bio set. Customize in Nora Dashboard!').substring(0, 75).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeClearance = String(clearance || 'MEMBER').toUpperCase();
    const safeRoblox = String(robloxText || 'Not Verified').substring(0, 45).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const badgesStr = badges.length > 0 ? badges.slice(0, 4).join('  •  ') : 'OFFICIAL MEMBER PASS';

    const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0a0b10" />
          <stop offset="50%" stop-color="#141624" />
          <stop offset="100%" stop-color="#08090d" />
        </linearGradient>

        <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${headerAccent}" stop-opacity="0.9" />
          <stop offset="100%" stop-color="#4F46E5" stop-opacity="0.75" />
        </linearGradient>

        <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${headerAccent}" />
          <stop offset="100%" stop-color="#06B6D4" />
        </linearGradient>
      </defs>

      <!-- Outer Base Canvas -->
      <rect width="${width}" height="${height}" rx="24" fill="url(#bgGrad)"/>

      <!-- Tech Background Grid Lines -->
      <path d="M 0 60 L 900 60 M 0 120 L 900 120 M 0 180 L 900 180 M 0 240 L 900 240 M 0 300 L 900 300 M 0 360 L 900 360 M 0 420 L 900 420" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <path d="M 150 0 L 150 520 M 300 0 L 300 520 M 450 0 L 450 520 M 600 0 L 600 520 M 750 0 L 750 520" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>

      <!-- Inner Glass Container -->
      <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="18" fill="rgba(255, 255, 255, 0.02)" stroke="${headerAccent}" stroke-opacity="0.3" stroke-width="1.5"/>

      <!-- Top Header Bar -->
      <rect x="16" y="16" width="${width - 32}" height="54" rx="18" fill="url(#headerGrad)"/>
      <rect x="16" y="52" width="${width - 32}" height="18" fill="url(#headerGrad)"/>

      <!-- Top Header Text -->
      <text x="36" y="48" font-family="Arial, sans-serif" font-size="16" font-weight="900" fill="#FFFFFF" letter-spacing="1.5">NORA IDENTIFICATION PASS</text>
      <text x="${width - 36}" y="48" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#FFFFFF" text-anchor="end" letter-spacing="1">VERIFIED DIGITAL ID • 🟢 ACTIVE</text>

      <!-- Left Column: Avatar Border -->
      <rect x="40" y="95" width="148" height="148" rx="22" fill="rgba(255,255,255,0.05)" stroke="${headerAccent}" stroke-width="2"/>

      <!-- Left Column: Clearance Pill -->
      <rect x="40" y="255" width="148" height="28" rx="8" fill="rgba(124, 58, 237, 0.25)" stroke="${headerAccent}" stroke-opacity="0.6" stroke-width="1"/>
      <text x="114" y="273" font-family="Arial, sans-serif" font-size="10" font-weight="800" fill="#FFFFFF" text-anchor="middle" letter-spacing="1">${safeClearance}</text>

      <!-- Left Column: Dates -->
      <text x="40" y="308" font-family="Arial, sans-serif" font-size="10" font-weight="800" fill="#8E9297" letter-spacing="1">JOINED SERVER</text>
      <text x="40" y="324" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="#FFFFFF">${joinedAt}</text>

      <text x="40" y="352" font-family="Arial, sans-serif" font-size="10" font-weight="800" fill="#8E9297" letter-spacing="1">ACCOUNT CREATED</text>
      <text x="40" y="368" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="#FFFFFF">${createdAt}</text>

      <!-- Right Main Panel -->
      <text x="215" y="125" font-family="Arial, sans-serif" font-size="28" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">${safeUser}</text>
      <text x="215" y="148" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="${headerAccent}">${badgesStr}</text>
      <text x="215" y="172" font-family="Arial, sans-serif" font-size="12" font-style="italic" fill="#B9BBBE">"${safeBio}"</text>

      <line x1="215" y1="188" x2="860" y2="188" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>

      <!-- Stats Box -->
      <rect x="215" y="200" width="645" height="120" rx="14" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      
      <text x="235" y="230" font-family="Arial, sans-serif" font-size="11" font-weight="800" fill="#8E9297" letter-spacing="1">LEVEL</text>
      <text x="235" y="258" font-family="Arial, sans-serif" font-size="24" font-weight="900" fill="#FFFFFF">${level}</text>

      <text x="340" y="230" font-family="Arial, sans-serif" font-size="11" font-weight="800" fill="#8E9297" letter-spacing="1">SERVER RANK</text>
      <text x="340" y="258" font-family="Arial, sans-serif" font-size="24" font-weight="900" fill="${headerAccent}">${rank}</text>

      <text x="490" y="230" font-family="Arial, sans-serif" font-size="11" font-weight="800" fill="#8E9297" letter-spacing="1">XP PROGRESSION (${progressPct}%)</text>
      <text x="490" y="256" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF">${currentXp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP <tspan font-size="11" fill="#8E9297">(Total: ${totalXp.toLocaleString()})</tspan></text>

      <rect x="490" y="272" width="350" height="12" rx="6" fill="rgba(255,255,255,0.1)"/>
      <rect x="490" y="272" width="${barWidth}" height="12" rx="6" fill="url(#progressGrad)"/>

      <!-- Integrations Box -->
      <rect x="215" y="332" width="645" height="98" rx="14" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      <text x="235" y="358" font-family="Arial, sans-serif" font-size="11" font-weight="800" fill="#8E9297" letter-spacing="1">ROBLOX IDENTITY &amp; INTEGRATIONS</text>
      <text x="235" y="382" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF">${safeRoblox}</text>
      <text x="235" y="406" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#8E9297">CURRENT GUILD: <tspan fill="#FFFFFF">${safeGuild}</tspan></text>

      <!-- Footer Divider -->
      <line x1="16" y1="450" x2="884" y2="450" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>

      <text x="36" y="484" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#8E9297" letter-spacing="1">USER ID: ${userId}</text>
      <text x="${width - 36}" y="484" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#8E9297" text-anchor="end" letter-spacing="1">OFFICIAL NORA PERSONAL ID • 2026</text>
    </svg>
    `;

    let baseBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    if (avatarPngBuffer) {
        baseBuffer = await sharp(baseBuffer)
            .composite([{ input: avatarPngBuffer, top: 99, left: 44 }])
            .png()
            .toBuffer();
    }

    return baseBuffer;
}

module.exports = {
    generateRankCard,
    generateUserIdCard
};
