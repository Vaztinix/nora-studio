const axios = require('axios');
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
 * Helper to convert RGB to Hex.
 */
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

/**
 * Helper to convert Hex to RGB.
 */
function hexToRgb(hex) {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
        clean = clean.split('').map(c => c + c).join('');
    }
    const num = parseInt(clean, 16);
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

/**
 * Ensures a color has sufficient saturation and luminance for glowing liquid glass effects.
 */
function enhanceVibrancy({ r, g, b }) {
    // Relative luminance
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let boostR = r, boostG = g, boostB = b;

    // If too dark, scale up
    if (lum < 60) {
        const factor = 110 / Math.max(lum, 10);
        boostR = Math.min(255, r * factor + 40);
        boostG = Math.min(255, g * factor + 40);
        boostB = Math.min(255, b * factor + 60);
    }

    // If completely desaturated (grey/white/black), inject slight cyan/indigo tone
    const maxVal = Math.max(boostR, boostG, boostB);
    const minVal = Math.min(boostR, boostG, boostB);
    if (maxVal - minVal < 20) {
        boostR = Math.min(255, boostR + 30);
        boostB = Math.min(255, boostB + 70);
    }

    return {
        r: Math.round(boostR),
        g: Math.round(boostG),
        b: Math.round(boostB)
    };
}

/**
 * Generates an ultra-premium liquid glass Welcome or Exit card.
 *
 * @param {Object} options
 * @param {import('discord.js').GuildMember|Object} options.member - Discord GuildMember or user object
 * @param {import('discord.js').Guild|Object} options.guild - Discord Guild object
 * @param {boolean} [options.isExit=false] - Whether this is an exit / departure card
 * @param {string|null} [options.customMessage=null] - Optional custom message/subtext
 * @param {string|null} [options.customAccent=null] - Optional override accent color (hex)
 * @param {string|null} [options.customBgUrl=null] - Optional background image URL
 * @param {number|null} [options.memberCount=null] - Member count override
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateWelcomeCard({
    member,
    guild,
    isExit = false,
    customMessage = null,
    customAccent = null,
    customBgUrl = null,
    memberCount = null
}) {
    const width = 1000;
    const height = 460;

    const user = member?.user || member;
    const username = user?.username || 'Member';
    const displayName = user?.displayName || user?.globalName || username;
    const guildName = guild?.name || 'Server';
    const totalMembers = memberCount ?? (guild?.memberCount || 1);

    // 1. Download Avatar & Extract Profile Colors
    let avatarBase64 = '';
    let extractedColor = { r: 99, g: 102, b: 241 }; // Default vibrant indigo

    const avatarUrl = user?.displayAvatarURL
        ? user.displayAvatarURL({ extension: 'png', size: 256 })
        : (user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : null);

    if (avatarUrl) {
        try {
            const res = await axios.get(avatarUrl, { responseType: 'arraybuffer', timeout: 5000 });
            const avatarRaw = res.data;

            // Extract dominant color by resizing down to 1x1 pixel
            try {
                const pixel = await sharp(avatarRaw).resize(1, 1).raw().toBuffer();
                if (pixel.length >= 3) {
                    extractedColor = { r: pixel[0], g: pixel[1], b: pixel[2] };
                }
            } catch (err) {}

            // Circular processed avatar
            const avatarPng = await sharp(avatarRaw)
                .resize(136, 136)
                .png()
                .toBuffer();
            avatarBase64 = `data:image/png;base64,${avatarPng.toString('base64')}`;
        } catch (e) {
            // console.warn('[Welcomer Card] Failed to fetch avatar:', e.message);
        }
    }

    // Check user accent color from Discord profile if available
    if (user?.accentColor && !customAccent) {
        const hex = '#' + user.accentColor.toString(16).padStart(6, '0');
        extractedColor = hexToRgb(hex);
    }

    // Apply custom accent if provided by server
    if (customAccent && customAccent.startsWith('#')) {
        extractedColor = hexToRgb(customAccent);
    }

    // For exit cards, shift default palette towards warm sunset/ruby if not explicitly overridden
    if (isExit && !customAccent && !user?.accentColor) {
        extractedColor = { r: 244, g: 63, b: 94 }; // Rose / Coral
    }

    // Enhance vibrancy so glass bubbles glow radiantly
    const vibrant = enhanceVibrancy(extractedColor);
    const primaryHex = rgbToHex(vibrant.r, vibrant.g, vibrant.b);

    // Compute secondary complementary/analogous color for multi-tone liquid refraction
    const secR = Math.min(255, Math.max(0, 255 - vibrant.b + 30));
    const secG = Math.min(255, Math.max(0, vibrant.g / 2 + 100));
    const secB = Math.min(255, Math.max(0, vibrant.r + 50));
    const secondaryHex = rgbToHex(secR, secG, secB);

    // 2. Fetch Optional Custom Server Background
    let customBgBase64 = '';
    if (customBgUrl && (customBgUrl.startsWith('http://') || customBgUrl.startsWith('https://'))) {
        try {
            const bgRes = await axios.get(customBgUrl, { responseType: 'arraybuffer', timeout: 6000 });
            const bgPng = await sharp(bgRes.data)
                .resize(width, height, { fit: 'cover' })
                .png()
                .toBuffer();
            customBgBase64 = `data:image/png;base64,${bgPng.toString('base64')}`;
        } catch (bgErr) {
            // Ignore and fallback to liquid gradient
        }
    }

    // Text formatting
    const rawDisplayName = displayName.length > 20 ? displayName.slice(0, 19) + '…' : displayName;
    const rawUsername = username.length > 24 ? username.slice(0, 23) + '…' : username;
    const rawGuildName = guildName.length > 28 ? guildName.slice(0, 27) + '…' : guildName;
    const rawSubtext = customMessage 
        ? customMessage.slice(0, 48) 
        : (isExit ? 'We will miss you! Safe travels.' : 'We are delighted to have you here!');

    const safeDisplayName = escapeXml(rawDisplayName);
    const safeUsername = escapeXml(rawUsername);
    const safeGuildName = escapeXml(rawGuildName);
    const subtext = escapeXml(rawSubtext);
    const fallbackInitial = escapeXml((displayName || username || 'M').charAt(0).toUpperCase());

    const topBadgeText = isExit 
        ? escapeXml(`FAREWELL FROM ${rawGuildName.toUpperCase()}`)
        : escapeXml(`WELCOME TO ${rawGuildName.toUpperCase()}`);

    const memberPillText = escapeXml(isExit
        ? `Members Remaining: ${totalMembers.toLocaleString()}`
        : `Member #${totalMembers.toLocaleString()}`);

    const themeTitle = isExit ? 'GOODBYE' : 'WELCOME';

    // 3. Assemble SVG with Real Liquid Glassmorphism & Transparent Blurs
    const svgString = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <!-- Background base gradient -->
            <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#07080c" />
                <stop offset="50%" stop-color="#0b0d14" />
                <stop offset="100%" stop-color="#06070a" />
            </linearGradient>

            <!-- Profile Glow Gradient 1 -->
            <radialGradient id="profileOrb1" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${primaryHex}" stop-opacity="0.8" />
                <stop offset="60%" stop-color="${primaryHex}" stop-opacity="0.25" />
                <stop offset="100%" stop-color="${primaryHex}" stop-opacity="0" />
            </radialGradient>

            <!-- Profile Glow Gradient 2 (Secondary) -->
            <radialGradient id="profileOrb2" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${secondaryHex}" stop-opacity="0.7" />
                <stop offset="65%" stop-color="${secondaryHex}" stop-opacity="0.2" />
                <stop offset="100%" stop-color="${secondaryHex}" stop-opacity="0" />
            </radialGradient>

            <!-- Liquid Glass Fill Gradient -->
            <linearGradient id="liquidGlassFill" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="rgba(255, 255, 255, 0.16)" />
                <stop offset="40%" stop-color="rgba(255, 255, 255, 0.05)" />
                <stop offset="85%" stop-color="rgba(255, 255, 255, 0.02)" />
                <stop offset="100%" stop-color="rgba(255, 255, 255, 0.09)" />
            </linearGradient>

            <!-- Liquid Glass Specular Border -->
            <linearGradient id="liquidGlassBorder" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="rgba(255, 255, 255, 0.55)" />
                <stop offset="25%" stop-color="${primaryHex}" stop-opacity="0.4" />
                <stop offset="70%" stop-color="rgba(255, 255, 255, 0.08)" />
                <stop offset="100%" stop-color="rgba(255, 255, 255, 0.35)" />
            </linearGradient>

            <!-- Bubble Pill Gradient -->
            <linearGradient id="bubblePillGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="${primaryHex}" stop-opacity="0.28" />
                <stop offset="100%" stop-color="${secondaryHex}" stop-opacity="0.2" />
            </linearGradient>

            <!-- Bubble Pill Border -->
            <linearGradient id="bubblePillBorder" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="rgba(255, 255, 255, 0.45)" />
                <stop offset="50%" stop-color="${primaryHex}" stop-opacity="0.5" />
                <stop offset="100%" stop-color="rgba(255, 255, 255, 0.25)" />
            </linearGradient>

            <!-- Avatar Glow Ring -->
            <linearGradient id="avatarRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
                <stop offset="50%" stop-color="${primaryHex}" />
                <stop offset="100%" stop-color="${secondaryHex}" />
            </linearGradient>

            <!-- Heavy Chromatic Dispersion Filter for liquid orbs -->
            <filter id="heavyBlur" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="65" />
            </filter>

            <filter id="bubbleBlur" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="35" />
            </filter>

            <!-- Avatar Circular Clip -->
            <clipPath id="avatarClip">
                <circle cx="165" cy="230" r="68" />
            </clipPath>

            <!-- Card Corner Clip -->
            <clipPath id="cardClip">
                <rect x="0" y="0" width="${width}" height="${height}" rx="32" />
            </clipPath>
        </defs>

        <!-- Base Canvas with Rounded Corners -->
        <g clip-path="url(#cardClip)">
            <!-- 1. Deep Base Background -->
            <rect width="${width}" height="${height}" fill="url(#bgGrad)" />

            <!-- Optional Custom Background Image -->
            ${customBgBase64 ? `
            <image href="${customBgBase64}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
            <rect width="${width}" height="${height}" fill="rgba(6, 7, 10, 0.65)" />
            ` : ''}

            <!-- 2. Dynamic Liquid Background Orbs (Reflecting Profile Colors) -->
            <!-- Large primary color liquid bubble behind avatar & left -->
            <circle cx="170" cy="220" r="190" fill="url(#profileOrb1)" filter="url(#heavyBlur)" />

            <!-- Secondary color liquid bubble behind center right -->
            <circle cx="780" cy="180" r="220" fill="url(#profileOrb2)" filter="url(#heavyBlur)" />

            <!-- Radiant floating accent bubble bottom right -->
            <circle cx="520" cy="380" r="140" fill="url(#profileOrb1)" filter="url(#heavyBlur)" />

            <!-- White/cyan specular glow at top edge -->
            <ellipse cx="480" cy="30" rx="320" ry="70" fill="rgba(255, 255, 255, 0.08)" filter="url(#bubbleBlur)" />

            <!-- 3. MAIN LIQUID GLASS CONTAINER (The Big Floating Acrylic Bubble) -->
            <rect x="36" y="36" width="928" height="388" rx="28" 
                  fill="url(#liquidGlassFill)" 
                  stroke="url(#liquidGlassBorder)" 
                  stroke-width="1.8" />

            <!-- Liquid Glass Specular Highlight Curve (Glossy Acrylic Rim) -->
            <path d="M 64 38 Q 500 48 936 38" stroke="rgba(255, 255, 255, 0.55)" stroke-width="1.2" fill="none" />
            <ellipse cx="500" cy="42" rx="360" ry="1.5" fill="rgba(255, 255, 255, 0.85)" />

            <!-- 4. AVATAR SECTION: Multi-Layer Frosted Liquid Glass Bubble -->
            <!-- Outer Avatar Frosted Glass Ring -->
            <circle cx="165" cy="230" r="82" 
                    fill="rgba(255, 255, 255, 0.04)" 
                    stroke="url(#liquidGlassBorder)" 
                    stroke-width="1.5" />

            <!-- Radiant Neon Liquid Halo around Avatar -->
            <circle cx="165" cy="230" r="74" 
                    fill="none" 
                    stroke="url(#avatarRingGrad)" 
                    stroke-width="3.5" />

            <!-- Inner Avatar Drop Shadow -->
            <circle cx="165" cy="230" r="68" fill="#11131a" />

            <!-- User Avatar Image -->
            ${avatarBase64 ? `
            <image href="${avatarBase64}" x="97" y="162" width="136" height="136" clip-path="url(#avatarClip)" />
            ` : `
            <circle cx="165" cy="230" r="68" fill="${primaryHex}" />
            <text x="165" y="246" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="44" font-weight="900" fill="#ffffff" text-anchor="middle">
                ${fallbackInitial}
            </text>
            `}

            <!-- 5. CONTENT SECTION: Liquid Glass Bubbles For Text -->
            
            <!-- (A) Top Pill Bubble: Greeting & Server Name -->
            <g transform="translate(285, 78)">
                <rect width="640" height="38" rx="19" 
                      fill="rgba(255, 255, 255, 0.07)" 
                      stroke="rgba(255, 255, 255, 0.22)" 
                      stroke-width="1.2" />
                <!-- Subtle glowing inner indicator dot -->
                <circle cx="22" cy="19" r="6" fill="${primaryHex}" />
                <circle cx="22" cy="19" r="3" fill="#ffffff" />
                <text x="38" y="24" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="800" fill="#e2e8f0" letter-spacing="1.5">
                    ${topBadgeText}
                </text>
            </g>

            <!-- (B) Hero Title: WELCOME / GOODBYE (Uppercase Liquid Typography) -->
            <text x="288" y="166" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="28" font-weight="900" fill="${primaryHex}" letter-spacing="3">
                ${themeTitle}
            </text>

            <!-- (C) Main Display Name (Large, crisp, prominent) -->
            <text x="288" y="222" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="46" font-weight="900" fill="#ffffff" letter-spacing="-0.5">
                ${safeDisplayName}
            </text>

            <!-- (D) Handle / Tag Pill Bubble -->
            <g transform="translate(288, 240)">
                <rect width="180" height="28" rx="14" 
                      fill="rgba(255, 255, 255, 0.06)" 
                      stroke="rgba(255, 255, 255, 0.15)" 
                      stroke-width="1" />
                <text x="14" y="18" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="600" fill="${primaryHex}">
                    @${safeUsername}
                </text>
            </g>

            <!-- Subtitle Greeting -->
            <text x="288" y="302" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="16" font-weight="500" fill="#94a3b8">
                ${subtext}
            </text>

            <!-- (E) Bottom Liquid Glass Milestone Bubble (Pill containing Member Count) -->
            <g transform="translate(288, 332)">
                <!-- Liquid Glass Pill -->
                <rect width="360" height="46" rx="23" 
                      fill="url(#bubblePillGrad)" 
                      stroke="url(#bubblePillBorder)" 
                      stroke-width="1.4" />
                
                <!-- Glossy specular top shine -->
                <path d="M 16 3 Q 180 12 344 3" stroke="rgba(255, 255, 255, 0.45)" stroke-width="1" fill="none" />

                <!-- Milestone Icon (Emoji / Sparkle) -->
                <text x="24" y="29" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="18">
                    ${isExit ? '🚪' : '🎉'}
                </text>

                <!-- Milestone Text -->
                <text x="56" y="29" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff" letter-spacing="0.5">
                    ${memberPillText}
                </text>
            </g>

            <!-- Nora Studio Signature Glass Tag (Bottom Right) -->
            <g transform="translate(820, 388)">
                <text x="0" y="0" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="rgba(255, 255, 255, 0.28)" letter-spacing="1">
                    NORA STUDIO
                </text>
            </g>
        </g>
    </svg>
    `.trim();

    return await sharp(Buffer.from(svgString))
        .png({ quality: 95 })
        .toBuffer();
}

module.exports = {
    generateWelcomeCard,
    enhanceVibrancy
};
