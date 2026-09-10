const sharp = require('sharp');

/**
 * Fast, non-blocking image buffer fetcher using native fetch and AbortController timeout.
 * Completely eliminates axios socket hanging/blocking on avatar or media fetches.
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

async function resolveDirectMediaUrl(url, timeoutMs = 2500) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('data:image')) return url;

    // Klipy URL direct API resolver
    if (url.includes('klipy.com')) {
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
        } catch (e) {}
    }
    return url;
}

/**
 * Generates a rank card image buffer with custom image backgrounds and shape presets.
 * Member uploaded changes ALWAYS overwrite server settings.
 */
async function generateRankCard({ 
    username, 
    level = 0, 
    currentXp = 0, 
    nextLevelXp, 
    requiredXp = 100,
    rank = 1, 
    avatarUrl, 
    showPfp = true, 
    bgColor = '#090a10', 
    accentColor = '#6366f1', 
    borderColor = '#232538',
    isPremium = false,
    // Member image & shape (takes priority)
    userCustomBg = null,
    userShape = null,
    // Server fallbacks
    serverCustomBg = null,
    serverShape = 'rounded-rect'
}) {
    const finalNextLevelXp = Number(nextLevelXp || requiredXp) || 100;
    const finalCurrentXp = Number(currentXp) || 0;
    // Member changes ALWAYS overwrite server changes
    const finalBgImage = userCustomBg || serverCustomBg || null;
    const rawShape = (userShape && userShape !== 'default') ? userShape : (serverShape || 'rounded-rect');
    const shape = ['rounded-rect', 'capsule', 'hexagon', 'diamond', 'classic'].includes(rawShape) ? rawShape : 'rounded-rect';

    let avatarPngBuffer = null;
    if (showPfp && avatarUrl) {
        try {
            const rawAvatar = await fetchImageBuffer(avatarUrl, 1500);
            if (rawAvatar) {
                // Smooth circle clip for avatar
                const circleSvg = `<svg width="124" height="124"><circle cx="62" cy="62" r="62" fill="#fff"/></svg>`;
                const circleMask = Buffer.from(circleSvg);

                const resizedAvatar = await sharp(rawAvatar)
                    .resize(124, 124)
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
                resolveDirectMediaUrl(finalBgImage, 1500),
                new Promise((r) => setTimeout(() => r(finalBgImage), 1500))
            ]);

            let rawBuffer = await fetchImageBuffer(resolvedUrl, 2500);
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
                            .resize(860, 240, { fit: 'cover' })
                            .toBuffer();
                    } catch(gifErr) {
                        console.warn('[Rank Generator] Animated background resize failed, falling back to static:', gifErr.message);
                        isAnimatedGif = false;
                    }
                }

                if (!isAnimatedGif || !animatedBgBuffer) {
                    isAnimatedGif = false;
                    const pngBuffer = await sharp(rawBuffer)
                        .resize(860, 240, { fit: 'cover' })
                        .png()
                        .toBuffer();
                    customBgBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                }
            }
        } catch (e) {
            console.warn('[Rank Generator] Custom background processing fallback used:', e.message);
        }
    }

    const progressPercent = Math.min(100, Math.max(0, (finalCurrentXp / Math.max(1, finalNextLevelXp)) * 100));
    const totalBarWidth = 616;
    const barWidth = Math.round((progressPercent / 100) * totalBarWidth);

    // Dynamic Shape Clips & Masks
    let cardMaskShapeSvg = '<rect width="860" height="240" rx="22" fill="#ffffff" />';
    let cardClipSvg = '<rect width="860" height="240" rx="22" fill="url(#bgPattern)" />';
    let borderSvg = '<rect x="1" y="1" width="858" height="238" rx="21" fill="none" stroke="url(#borderGrad)" stroke-width="1.5" />';

    if (shape === 'capsule') {
        cardMaskShapeSvg = '<rect width="860" height="240" rx="44" fill="#ffffff" />';
        cardClipSvg = '<rect width="860" height="240" rx="44" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="1" y="1" width="858" height="238" rx="43" fill="none" stroke="url(#borderGrad)" stroke-width="1.5" />';
    } else if (shape === 'hexagon') {
        cardMaskShapeSvg = '<polygon points="44,0 816,0 860,120 816,240 44,240 0,120" fill="#ffffff" />';
        cardClipSvg = '<polygon points="44,0 816,0 860,120 816,240 44,240 0,120" fill="url(#bgPattern)" />';
        borderSvg = '<polygon points="44,0 816,0 860,120 816,240 44,240 0,120" fill="none" stroke="url(#borderGrad)" stroke-width="1.5" />';
    } else if (shape === 'classic') {
        cardMaskShapeSvg = '<rect width="860" height="240" rx="6" fill="#ffffff" />';
        cardClipSvg = '<rect width="860" height="240" rx="6" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="1" y="1" width="858" height="238" rx="5" fill="none" stroke="url(#borderGrad)" stroke-width="1.5" />';
    } else if (shape === 'diamond') {
        cardMaskShapeSvg = '<rect width="860" height="240" rx="28" fill="#ffffff" />';
        cardClipSvg = '<rect width="860" height="240" rx="28" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="1" y="1" width="858" height="238" rx="27" fill="none" stroke="url(#borderGrad)" stroke-width="2" />';
    }

    const svgBgFill = isAnimatedGif ? 'none' : (bgColor || '#090a10');
    const svgOverlayFill = isAnimatedGif ? 'rgba(7, 9, 16, 0.35)' : 'rgba(7, 9, 16, 0.50)';

    const safeUsername = String(username || 'User').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const svgString = `
    <svg width="860" height="240" viewBox="0 0 860 240" xmlns="http://www.w3.org/2000/svg" text-rendering="geometricPrecision" shape-rendering="geometricPrecision" image-rendering="optimizeQuality">
        <defs>
            <linearGradient id="obsidianGlass" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#090a10" />
                <stop offset="50%" stop-color="#121320" />
                <stop offset="100%" stop-color="#07080d" />
            </linearGradient>

            <linearGradient id="dynamicScrimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#05070d" stop-opacity="0.45" />
                <stop offset="50%" stop-color="#05070d" stop-opacity="0.25" />
                <stop offset="100%" stop-color="#05070d" stop-opacity="0.40" />
            </linearGradient>

            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="${accentColor}" />
                <stop offset="100%" stop-color="#38bdf8" />
            </linearGradient>

            <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.85" />
                <stop offset="50%" stop-color="rgba(255,255,255,0.25)" />
                <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.75" />
            </linearGradient>

            <radialGradient id="rankGlow1" cx="20%" cy="30%" r="60%">
                <stop offset="0%" stop-color="rgba(99, 102, 241, 0.18)" />
                <stop offset="100%" stop-color="transparent" />
            </radialGradient>

            <radialGradient id="rankGlow2" cx="80%" cy="80%" r="60%">
                <stop offset="0%" stop-color="rgba(56, 189, 248, 0.14)" />
                <stop offset="100%" stop-color="transparent" />
            </radialGradient>

            <filter id="crispShadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.95" />
                <feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="#000000" flood-opacity="0.90" />
            </filter>

            <pattern id="bgPattern" width="860" height="240" patternUnits="userSpaceOnUse">
                ${isAnimatedGif ? `<rect width="860" height="240" fill="url(#dynamicScrimGrad)" />` : `<rect width="860" height="240" fill="url(#obsidianGlass)" />`}
                <rect width="860" height="240" fill="url(#rankGlow1)" />
                <rect width="860" height="240" fill="url(#rankGlow2)" />
                ${(!isAnimatedGif && customBgBase64) ? `<image href="${customBgBase64}" x="0" y="0" width="860" height="240" preserveAspectRatio="xMidYMid slice" />` : ''}
                ${(!isAnimatedGif && customBgBase64) ? `<rect width="860" height="240" fill="url(#dynamicScrimGrad)" />` : (!isAnimatedGif ? `<rect width="860" height="240" fill="${svgOverlayFill}" />` : '')}
            </pattern>
        </defs>

        <!-- Base Shape Fill with Background Pattern -->
        ${cardClipSvg}
        
        <!-- Subtle Tech Mesh -->
        <path d="M 0 60 L 860 60 M 0 120 L 860 120 M 0 180 L 860 180" stroke="rgba(255,255,255,0.025)" stroke-width="1"/>
        <path d="M 215 0 L 215 240 M 430 0 L 430 240 M 645 0 L 645 240" stroke="rgba(255,255,255,0.025)" stroke-width="1"/>

        <!-- Shape Outline -->
        ${borderSvg}

        <!-- Avatar soft dark backing, glow & ring -->
        <circle cx="106" cy="120" r="66" fill="rgba(8, 10, 18, 0.45)" />
        <circle cx="106" cy="120" r="70" fill="none" stroke="${accentColor}" stroke-opacity="0.3" stroke-width="6" />
        <circle cx="106" cy="120" r="66" fill="none" stroke="${accentColor}" stroke-width="2.5" />
        ${!avatarPngBuffer ? `<circle cx="106" cy="120" r="62" fill="#13141f" /><text x="106" y="132" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="900" fill="${accentColor}" text-anchor="middle">@</text>` : ''}

        <!-- Rank Pill Badge -->
        <rect x="696" y="34" width="124" height="36" rx="18" fill="rgba(10, 12, 22, 0.65)" stroke="${accentColor}" stroke-width="1.5" filter="url(#crispShadow)" />
        <circle cx="718" cy="52" r="4.5" fill="${accentColor}" />
        <text x="764" y="57" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="13" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">RANK #${rank}</text>

        <!-- Username Header -->
        <text x="204" y="72" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="34" font-weight="900" fill="#ffffff" filter="url(#crispShadow)" letter-spacing="-0.3">@${safeUsername}</text>

        <!-- Level Pill & Stats -->
        <rect x="204" y="94" width="112" height="28" rx="14" fill="rgba(10, 12, 22, 0.65)" stroke="${accentColor}" stroke-opacity="0.75" stroke-width="1.2" filter="url(#crispShadow)" />
        <text x="260" y="113" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="900" fill="#e0e7ff" text-anchor="middle" letter-spacing="0.5">LEVEL ${level}</text>

        <!-- XP Info with subtle glass backplate for extreme contrast -->
        <text x="820" y="114" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="15" font-weight="800" text-anchor="end" filter="url(#crispShadow)">
            <tspan fill="#ffffff" font-weight="900">${finalCurrentXp.toLocaleString()}</tspan>
            <tspan fill="#cbd5e1" font-weight="700"> / ${finalNextLevelXp.toLocaleString()} XP </tspan>
            <tspan fill="${accentColor}" font-weight="900">(${Math.round(progressPercent)}%)</tspan>
        </text>

        <!-- Progress Bar container -->
        <rect x="204" y="136" width="${totalBarWidth}" height="22" rx="11" fill="rgba(5, 7, 14, 0.70)" stroke="rgba(255,255,255,0.20)" stroke-width="1.2" filter="url(#crispShadow)" />
        <!-- Progress fill -->
        ${barWidth > 0 ? `<rect x="204" y="136" width="${barWidth}" height="22" rx="11" fill="url(#progressGrad)" />` : ''}

        <!-- Footer Tag -->
        <text x="204" y="188" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#cbd5e1" filter="url(#crispShadow)" letter-spacing="0.8">NORA PROGRESSION NETWORK • VAZTINIX.DEV</text>
    </svg>
    `.trim();

    const basePngBuffer = await sharp(Buffer.from(svgString))
        .png({ compressionLevel: 6, quality: 100 })
        .toBuffer();

    const composited = avatarPngBuffer 
        ? await sharp(basePngBuffer).composite([{ input: avatarPngBuffer, left: 44, top: 58 }]).png().toBuffer()
        : basePngBuffer;

    if (isAnimatedGif && animatedBgBuffer) {
        try {
            const maskSvg = `<svg width="860" height="240">${cardMaskShapeSvg}</svg>`;
            const maskBuffer = await sharp(Buffer.from(maskSvg)).png().toBuffer();

            return await sharp(animatedBgBuffer, { animated: true })
                .composite([
                    { input: maskBuffer, blend: 'dest-in', tile: true },
                    { input: composited, blend: 'over', tile: true }
                ])
                .gif({ loop: 0, effort: 1, colours: 128, dither: 0.8 })
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
    accentColor = '#6366f1'
}) {
    const width = 900;
    const height = 520;

    let avatarPngBuffer = null;
    if (avatarUrl) {
        try {
            const rawAvatar = await fetchImageBuffer(avatarUrl, 1500);
            if (rawAvatar) {
                const maskSvg = `<svg width="140" height="140"><rect width="140" height="140" rx="20" fill="#fff"/></svg>`;
                const maskBuffer = Buffer.from(maskSvg);

                const resizedAvatar = await sharp(rawAvatar)
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

    let accent = accentColor || '#5865F2';
    if (isOwner || isPremium) accent = '#F59E0B';
    else if (isPromoter) accent = '#EC4899';

    const progressPct = Math.min(100, Math.max(0, Math.floor((currentXp / Math.max(1, nextLevelXp)) * 100)));
    const barWidth = Math.floor((progressPct / 100) * 350);

    const safeUser = String(username || 'User').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeGuild = String(guildName || 'Nora Network').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeBio = String(bio || 'No bio set. Customize in Nora Dashboard.').substring(0, 75).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeClearance = String(clearance || 'MEMBER').toUpperCase();
    const safeRoblox = String(robloxText || 'Not Verified').substring(0, 45).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const badgesStr = badges.length > 0 ? badges.slice(0, 4).join('  •  ') : 'STANDARD MEMBER';

    const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0b0c10" />
          <stop offset="50%" stop-color="#12141a" />
          <stop offset="100%" stop-color="#0b0c10" />
        </linearGradient>
      </defs>

      <!-- Outer Base Canvas -->
      <rect width="${width}" height="${height}" rx="20" fill="url(#bgGrad)" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>

      <!-- Inner Glass Container -->
      <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="14" fill="rgba(255, 255, 255, 0.015)" stroke="rgba(255, 255, 255, 0.05)" stroke-width="1"/>

      <!-- Top Header Bar -->
      <rect x="16" y="16" width="${width - 32}" height="48" rx="14" fill="rgba(255, 255, 255, 0.03)"/>
      <line x1="16" y1="64" x2="${width - 16}" y2="64" stroke="rgba(255, 255, 255, 0.06)" stroke-width="1"/>

      <!-- Top Header Text -->
      <text x="36" y="46" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#94A3B8" letter-spacing="1">MEMBER IDENTIFICATION</text>
      <text x="${width - 36}" y="46" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="12" font-weight="600" fill="#64748B" text-anchor="end" letter-spacing="0.5">VERIFIED PASS</text>

      <!-- Left Column: Avatar Border -->
      <rect x="40" y="88" width="148" height="148" rx="18" fill="rgba(255,255,255,0.03)" stroke="${accent}" stroke-width="2"/>

      <!-- Left Column: Clearance Pill -->
      <rect x="40" y="248" width="148" height="28" rx="8" fill="rgba(255, 255, 255, 0.04)" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1"/>
      <text x="114" y="266" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="10" font-weight="800" fill="#E2E8F0" text-anchor="middle" letter-spacing="0.8">${safeClearance}</text>

      <!-- Left Column: Dates -->
      <text x="40" y="302" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="10" font-weight="700" fill="#64748B" letter-spacing="0.8">JOINED SERVER</text>
      <text x="40" y="318" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="12" font-weight="600" fill="#CBD5E1">${joinedAt}</text>

      <text x="40" y="348" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="10" font-weight="700" fill="#64748B" letter-spacing="0.8">ACCOUNT CREATED</text>
      <text x="40" y="364" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="12" font-weight="600" fill="#CBD5E1">${createdAt}</text>

      <!-- Right Main Panel -->
      <text x="215" y="118" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="26" font-weight="800" fill="#F8FAFC" letter-spacing="-0.3">${safeUser}</text>
      <text x="215" y="140" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="12" font-weight="600" fill="${accent}">${badgesStr}</text>
      <text x="215" y="164" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="12" font-style="italic" fill="#64748B">"${safeBio}"</text>

      <line x1="215" y1="180" x2="860" y2="180" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

      <!-- Stats Box -->
      <rect x="215" y="194" width="645" height="120" rx="12" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      
      <text x="235" y="224" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#64748B" letter-spacing="0.8">LEVEL</text>
      <text x="235" y="252" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="22" font-weight="800" fill="#F8FAFC">${level}</text>

      <text x="340" y="224" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#64748B" letter-spacing="0.8">SERVER RANK</text>
      <text x="340" y="252" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="22" font-weight="800" fill="${accent}">${rank}</text>

      <text x="490" y="224" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#64748B" letter-spacing="0.8">PROGRESSION (${progressPct}%)</text>
      <text x="490" y="248" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#CBD5E1">${currentXp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP <tspan font-size="11" fill="#64748B">(Total: ${totalXp.toLocaleString()})</tspan></text>

      <rect x="490" y="264" width="350" height="10" rx="5" fill="rgba(255,255,255,0.08)"/>
      <rect x="490" y="264" width="${barWidth}" height="10" rx="5" fill="${accent}"/>

      <!-- Integrations Box -->
      <rect x="215" y="328" width="645" height="98" rx="12" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <text x="235" y="354" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#64748B" letter-spacing="0.8">ROBLOX IDENTITY</text>
      <text x="235" y="378" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#F8FAFC">${safeRoblox}</text>
      <text x="235" y="402" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="11" font-weight="500" fill="#64748B">CURRENT GUILD: <tspan fill="#CBD5E1">${safeGuild}</tspan></text>

      <!-- Footer Divider -->
      <line x1="16" y1="446" x2="884" y2="446" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

      <text x="36" y="480" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#64748B" letter-spacing="0.5">USER ID: ${userId}</text>
      <text x="${width - 36}" y="480" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#64748B" text-anchor="end" letter-spacing="0.5">NORA PROFILE PASS</text>
    </svg>
    `;

    let baseBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    if (avatarPngBuffer) {
        baseBuffer = await sharp(baseBuffer)
            .composite([{ input: avatarPngBuffer, top: 92, left: 44 }])
            .png()
            .toBuffer();
    }

    return baseBuffer;
}

module.exports = {
    generateRankCard,
    generateUserIdCard
};
