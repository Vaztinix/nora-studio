const fetch = require('node-fetch');

// Simple in-memory cache for Discord guilds to prevent 429 Rate Limits
const guildsCache = new Map();
const CACHE_TTL = 30 * 1000; // 30 seconds cache

const getCachedUserGuilds = async (token) => {
    const now = Date.now();
    const cached = guildsCache.get(token);
    if (cached && cached.expires > now) {
        return cached.guilds;
    }

    const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
        if (response.status === 429 && cached) {
            console.warn('[Auth Middleware] Discord Rate Limit hit (429). Reusing expired cache.');
            return cached.guilds;
        }
        throw new Error(`Discord API returned ${response.status}`);
    }

    const guilds = await response.json();
    guildsCache.set(token, {
        guilds,
        expires: now + CACHE_TTL
    });
    return guilds;
};

// Clean up cache periodically to prevent leaks
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of guildsCache.entries()) {
        if (data.expires < now) {
            guildsCache.delete(token);
        }
    }
}, 5 * 60 * 1000);

/**
 * Middleware to verify Discord Bearer Token and Guild Permissions
 */
const requireGuildPermission = async (req, res, next) => {
    // Determine the guildId from URL params or body
    const guildId = req.params.guildId || req.body.guildId;
    if (!guildId) {
        return res.status(400).json({ error: 'Missing guildId parameter.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Fetch user's guilds from cache or Discord API
        const guilds = await getCachedUserGuilds(token);
        
        // Find the requested guild in the user's guild list
        const guild = guilds.find(g => g.id === guildId);
        
        if (!guild) {
            return res.status(403).json({ error: 'User is not in this guild or missing permissions.' });
        }

        // Check for ADMINISTRATOR (0x8) or MANAGE_GUILD (0x20)
        const permissions = BigInt(guild.permissions);
        const isAdmin = (permissions & BigInt(0x8)) === BigInt(0x8);
        const canManageGuild = (permissions & BigInt(0x20)) === BigInt(0x20);

        if (isAdmin || canManageGuild) {
            // User has permission, proceed to next middleware/handler
            req.userGuild = guild;
            next();
        } else {
            return res.status(403).json({ error: 'Insufficient permissions. You must have Administrator or Manage Server permissions.' });
        }
    } catch (error) {
        console.error('Discord Auth API Error:', error);
        return res.status(401).json({ error: 'Invalid or expired Discord token.' });
    }
};

module.exports = { requireGuildPermission, getCachedUserGuilds };
