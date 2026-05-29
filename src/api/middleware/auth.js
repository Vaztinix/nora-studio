const fetch = require('node-fetch');

// Simple in-memory cache for Discord guilds to prevent 429 Rate Limits
const guildsCache = new Map();
const activeRequests = new Map(); // token -> Promise
const CACHE_TTL = 30 * 1000; // 30 seconds cache

const getCachedUserGuilds = async (token) => {
    const now = Date.now();
    const cached = guildsCache.get(token);
    if (cached && cached.expires > now) {
        return cached.guilds;
    }

    if (activeRequests.has(token)) {
        return activeRequests.get(token);
    }

    const fetchPromise = (async () => {
        try {
            const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!response.ok) {
                if (response.status === 429 && cached) {
                    console.warn('[Auth Middleware] Discord Rate Limit hit (429). Reusing expired cache.');
                    return cached.guilds;
                }
                const err = new Error(`Discord API returned ${response.status}`);
                err.status = response.status;
                throw err;
            }

            const guilds = await response.json();
            guildsCache.set(token, {
                guilds,
                expires: Date.now() + CACHE_TTL
            });
            return guilds;
        } finally {
            activeRequests.delete(token);
        }
    })();

    activeRequests.set(token, fetchPromise);
    return fetchPromise;
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
        if (error.status === 429 || (error.message && error.message.includes('429'))) {
            return res.status(429).json({ 
                error: 'Discord API rate limit reached. Discord allows only a limited number of requests per minute. Please wait a few seconds and try again.',
                code: 'DISCORD_RATE_LIMIT'
            });
        }
        if (error.status === 401) {
            return res.status(401).json({ 
                error: 'Your Discord login token is invalid or has expired. Please re-authenticate by logging out and back in.',
                code: 'DISCORD_UNAUTHORIZED'
            });
        }
        if (error.status >= 500) {
            return res.status(502).json({ 
                error: `Discord servers returned a server error (HTTP ${error.status}). Discord might be experiencing outages. Please try again later.`,
                code: 'DISCORD_SERVER_ERROR'
            });
        }
        return res.status(401).json({ 
            error: 'Invalid or expired Discord token. Please clear your session and log in again.',
            code: 'INVALID_TOKEN'
        });
    }
};

module.exports = { requireGuildPermission, getCachedUserGuilds };
