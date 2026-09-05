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

async function resolveDirectMediaUrl(url, timeoutMs = 1500) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('data:image')) return url;

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
                const isGifHeader = rawBuffer.slice(0, 3).toString() === 'GIF';
                if (isGifHeader || (typeof resolvedUrl === 'string' && (resolvedUrl.toLowerCase().includes('.gif') || resolvedUrl.includes('klipy') || resolvedUrl.includes('tenor') || resolvedUrl.includes('giphy')))) {
                    isAnimatedGif = true;
                }

                if (isAnimatedGif) {
                    try {
                        animatedBgBuffer = await sharp(rawBuffer, { animated: true })
                            .resize(860, 240, { fit: 'cover' })
                            .toBuffer();
                    } catch(gifErr) {
                        isAnimatedGif = false;
                        const pngBuffer = await sharp(rawBuffer)
                            .resize(860, 240, { fit: 'cover' })
                            .png()
                            .toBuffer();
                        customBgBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                    }
                } else {
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
    const barWidth = Math.round((progressPercent / 100) * 480);

    // Dynamic Shape Clips
    let cardClipSvg = '<rect width="860" height="240" rx="22" fill="url(#bgPattern)" />';
    let borderSvg = '<rect x="1" y="1" width="858" height="238" rx="21" fill="none" stroke="url(#borderGrad)" stroke-width="1.5" />';

    if (shape === 'capsule') {
        cardClipSvg = '<rect width="860" height="240" rx="44" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="1" y="1" width="858" height="238" rx="43" fill="none" stroke="url(#borderGrad)" stroke-width="1.5" />';
    } else if (shape === 'hexagon') {
        cardClipSvg = '<polygon points="44,0 816,0 860,120 816,240 44,240 0,120" fill="url(#bgPattern)" />';
        borderSvg = '<polygon points="44,0 816,0 860,120 816,240 44,240 0,120" fill="none" stroke="url(#borderGrad)" stroke-width="1.5" />';
    } else if (shape === 'classic') {
        cardClipSvg = '<rect width="860" height="240" rx="6" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="1" y="1" width="858" height="238" rx="5" fill="none" stroke="url(#borderGrad)" stroke-width="1.5" />';
    } else if (shape === 'diamond') {
        cardClipSvg = '<rect width="860" height="240" rx="28" fill="url(#bgPattern)" />';
        borderSvg = '<rect x="1" y="1" width="858" height="238" rx="27" fill="none" stroke="url(#borderGrad)" stroke-width="2" />';
    }

    const svgBgFill = isAnimatedGif ? 'none' : (bgColor || '#090a10');
    const svgOverlayFill = isAnimatedGif ? 'rgba(9, 10, 16, 0.65)' : 'rgba(9, 10, 16, 0.55)';

    const safeUsername = String(username || 'User').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const svgString = `
    <svg width="860" height="240" viewBox="0 0 860 240" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="obsidianGlass" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#090a10" />
                <stop offset="50%" stop-color="#121320" />
                <stop offset="100%" stop-color="#07080d" />
            </linearGradient>

            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="${accentColor}" />
                <stop offset="100%" stop-color="#38bdf8" />
            </linearGradient>

            <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.8" />
                <stop offset="50%" stop-color="rgba(255,255,255,0.12)" />
                <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.6" />
            </linearGradient>

            <radialGradient id="rankGlow1" cx="20%" cy="30%" r="60%">
                <stop offset="0%" stop-color="rgba(99, 102, 241, 0.25)" />
                <stop offset="100%" stop-color="transparent" />
            </radialGradient>

            <radialGradient id="rankGlow2" cx="80%" cy="80%" r="60%">
                <stop offset="0%" stop-color="rgba(56, 189, 248, 0.18)" />
                <stop offset="100%" stop-color="transparent" />
            </radialGradient>

            <pattern id="bgPattern" width="860" height="240" patternUnits="userSpaceOnUse">
                <rect width="860" height="240" fill="url(#obsidianGlass)" />
                <rect width="860" height="240" fill="url(#rankGlow1)" />
                <rect width="860" height="240" fill="url(#rankGlow2)" />
                ${(!isAnimatedGif && customBgBase64) ? `<image href="${customBgBase64}" x="0" y="0" width="860" height="240" preserveAspectRatio="xMidYMid slice" />` : ''}
                <rect width="860" height="240" fill="${svgOverlayFill}" />
            </pattern>
        </defs>

        <!-- Base Shape Fill with Background Pattern -->
        ${cardClipSvg}
        
        <!-- Subtle Tech Mesh -->
        <path d="M 0 60 L 860 60 M 0 120 L 860 120 M 0 180 L 860 180" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>
        <path d="M 215 0 L 215 240 M 430 0 L 430 240 M 645 0 L 645 240" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>

        <!-- Shape Outline -->
        ${borderSvg}

        <!-- Avatar glow backdrop & ring -->
        <circle cx="106" cy="120" r="70" fill="none" stroke="${accentColor}" stroke-opacity="0.25" stroke-width="6" />
        <circle cx="106" cy="120" r="66" fill="none" stroke="${accentColor}" stroke-width="2.5" />
        ${!avatarPngBuffer ? `<circle cx="106" cy="120" r="62" fill="#13141f" /><text x="106" y="132" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="900" fill="${accentColor}" text-anchor="middle">@</text>` : ''}

        <!-- Rank Pill Badge -->
        <rect x="696" y="36" width="124" height="38" rx="19" fill="rgba(10, 12, 20, 0.85)" stroke="${accentColor}" stroke-width="1.5" />
        <circle cx="718" cy="55" r="4.5" fill="${accentColor}" />
        <text x="764" y="60" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="13" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">RANK #${rank}</text>

        <!-- Username Header -->
        <text x="204" y="78" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="34" font-weight="900" fill="#ffffff" letter-spacing="-0.5">@${safeUsername}</text>

        <!-- Level Pill & Stats -->
        <rect x="204" y="104" width="108" height="28" rx="14" fill="rgba(99, 102, 241, 0.18)" stroke="${accentColor}" stroke-opacity="0.5" stroke-width="1" />
        <text x="258" y="123" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="900" fill="#818cf8" text-anchor="middle" letter-spacing="0.5">LEVEL ${level}</text>

        <!-- XP Info -->
        <text x="684" y="124" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="15" font-weight="800" fill="#ffffff" text-anchor="end">${finalCurrentXp.toLocaleString()} <tspan fill="#64748b" font-weight="600">/ ${finalNextLevelXp.toLocaleString()} XP</tspan> <tspan fill="${accentColor}" font-weight="800">(${Math.round(progressPercent)}%)</tspan></text>

        <!-- Progress Bar container -->
        <rect x="204" y="146" width="480" height="22" rx="11" fill="rgba(5, 6, 10, 0.75)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
        <!-- Progress fill -->
        ${barWidth > 0 ? `<rect x="204" y="146" width="${barWidth}" height="22" rx="11" fill="url(#progressGrad)" />` : ''}

        <!-- Footer Tag -->
        <text x="204" y="196" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="700" fill="#64748b" letter-spacing="0.5">NORA PROGRESSION NETWORK • VAZTINIX.DEV</text>
    </svg>
    `.trim();

    const basePngBuffer = await sharp(Buffer.from(svgString))
        .png({ compressionLevel: 8, quality: 85 })
        .toBuffer();

    const composited = avatarPngBuffer 
        ? await sharp(basePngBuffer).composite([{ input: avatarPngBuffer, left: 44, top: 58 }]).png().toBuffer()
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

    let headerAccent = accentColor || '#6366f1';
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
          <stop offset="0%" stop-color="#090a10" />
          <stop offset="50%" stop-color="#121320" />
          <stop offset="100%" stop-color="#07080d" />
        </linearGradient>

        <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${headerAccent}" stop-opacity="0.9" />
          <stop offset="100%" stop-color="#4F46E5" stop-opacity="0.75" />
        </linearGradient>

        <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${headerAccent}" />
          <stop offset="100%" stop-color="#38bdf8" />
        </linearGradient>
      </defs>

      <!-- Outer Base Canvas -->
      <rect width="${width}" height="${height}" rx="26" fill="url(#bgGrad)"/>

      <!-- Tech Background Grid Lines -->
      <path d="M 0 60 L 900 60 M 0 120 L 900 120 M 0 180 L 900 180 M 0 240 L 900 240 M 0 300 L 900 300 M 0 360 L 900 360 M 0 420 L 900 420" stroke="rgba(255,255,255,0.025)" stroke-width="1"/>
      <path d="M 150 0 L 150 520 M 300 0 L 300 520 M 450 0 L 450 520 M 600 0 L 600 520 M 750 0 L 750 520" stroke="rgba(255,255,255,0.025)" stroke-width="1"/>

      <!-- Inner Glass Container -->
      <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="20" fill="rgba(255, 255, 255, 0.025)" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1.5"/>

      <!-- Top Header Bar -->
      <rect x="16" y="16" width="${width - 32}" height="54" rx="20" fill="url(#headerGrad)"/>
      <rect x="16" y="52" width="${width - 32}" height="18" fill="url(#headerGrad)"/>

      <!-- Top Header Text -->
      <text x="36" y="48" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="15" font-weight="900" fill="#FFFFFF" letter-spacing="1.5">NORA IDENTIFICATION PASS</text>
      <text x="${width - 36}" y="48" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="800" fill="#FFFFFF" text-anchor="end" letter-spacing="1">VERIFIED DIGITAL ID • 🟢 ONLINE</text>

      <!-- Left Column: Avatar Border -->
      <rect x="40" y="95" width="148" height="148" rx="24" fill="rgba(255,255,255,0.04)" stroke="${headerAccent}" stroke-width="2"/>

      <!-- Left Column: Clearance Pill -->
      <rect x="40" y="255" width="148" height="28" rx="10" fill="rgba(99, 102, 241, 0.2)" stroke="${headerAccent}" stroke-opacity="0.6" stroke-width="1"/>
      <text x="114" y="273" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="10" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="1">${safeClearance}</text>

      <!-- Left Column: Dates -->
      <text x="40" y="308" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="10" font-weight="800" fill="#8E9297" letter-spacing="1">JOINED SERVER</text>
      <text x="40" y="324" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#FFFFFF">${joinedAt}</text>

      <text x="40" y="352" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="10" font-weight="800" fill="#8E9297" letter-spacing="1">ACCOUNT CREATED</text>
      <text x="40" y="368" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#FFFFFF">${createdAt}</text>

      <!-- Right Main Panel -->
      <text x="215" y="125" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="28" font-weight="900" fill="#FFFFFF" letter-spacing="-0.5">${safeUser}</text>
      <text x="215" y="148" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="${headerAccent}">${badgesStr}</text>
      <text x="215" y="172" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-style="italic" fill="#94a3b8">"${safeBio}"</text>

      <line x1="215" y1="188" x2="860" y2="188" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>

      <!-- Stats Box -->
      <rect x="215" y="200" width="645" height="120" rx="16" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
      
      <text x="235" y="230" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#8E9297" letter-spacing="1">LEVEL</text>
      <text x="235" y="258" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" font-weight="900" fill="#FFFFFF">${level}</text>

      <text x="340" y="230" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#8E9297" letter-spacing="1">SERVER RANK</text>
      <text x="340" y="258" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" font-weight="900" fill="${headerAccent}">${rank}</text>

      <text x="490" y="230" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#8E9297" letter-spacing="1">XP PROGRESSION (${progressPct}%)</text>
      <text x="490" y="256" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF">${currentXp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP <tspan font-size="11" fill="#8E9297">(Total: ${totalXp.toLocaleString()})</tspan></text>

      <rect x="490" y="272" width="350" height="12" rx="6" fill="rgba(255,255,255,0.08)"/>
      <rect x="490" y="272" width="${barWidth}" height="12" rx="6" fill="url(#progressGrad)"/>

      <!-- Integrations Box -->
      <rect x="215" y="332" width="645" height="98" rx="16" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
      <text x="235" y="358" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#8E9297" letter-spacing="1">ROBLOX IDENTITY &amp; INTEGRATIONS</text>
      <text x="235" y="382" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF">${safeRoblox}</text>
      <text x="235" y="406" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="600" fill="#8E9297">CURRENT GUILD: <tspan fill="#FFFFFF">${safeGuild}</tspan></text>

      <!-- Footer Divider -->
      <line x1="16" y1="450" x2="884" y2="450" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>

      <text x="36" y="484" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="700" fill="#8E9297" letter-spacing="1">USER ID: ${userId}</text>
      <text x="${width - 36}" y="484" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="700" fill="#8E9297" text-anchor="end" letter-spacing="1">OFFICIAL NORA PERSONAL ID • 2026</text>
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
