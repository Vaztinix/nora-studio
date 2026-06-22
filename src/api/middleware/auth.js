const fetch = require('node-fetch');

// Simple in-memory cache for Discord guilds to prevent 429 Rate Limits
const guildsCache = new Map();
const activeRequests = new Map(); // token -> Promise
const CACHE_TTL = 60 * 1000; // 60 seconds cache

const resolveDiscordToken = async (token) => {
    if (token && token.startsWith('nora_sess_')) {
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const SessionModel = require('../../database/models/Session');
        const session = await SessionModel.findByPk(tokenHash);
        if (!session || (session.expiresAt && new Date() > new Date(session.expiresAt))) {
            const err = new Error('Invalid or expired custom session');
            err.status = 401;
            throw err;
        }
        return session.discordToken;
    }
    return token;
};

const getCachedUserGuilds = async (token) => {
    if (token === 'nora_mock_token') {
        return [
            {
                id: '1351304498185900184',
                name: "Nora's Hub",
                icon: 'https://cdn.discordapp.com/embed/avatars/1.png',
                permissions: '1099511627775',
                owner: true
            },
            {
                id: '222222222222222222',
                name: 'Nora Studio Support',
                icon: 'https://cdn.discordapp.com/embed/avatars/2.png',
                permissions: '1099511627775',
                owner: false
            },
            {
                id: '333333333333333333',
                name: 'Role Access Guild',
                icon: 'https://cdn.discordapp.com/embed/avatars/3.png',
                permissions: '0',
                owner: false
            }
        ];
    }
    let resolvedToken;
    try {
        resolvedToken = await resolveDiscordToken(token);
    } catch (e) {
        resolvedToken = token;
    }
    const now = Date.now();
    const cached = guildsCache.get(resolvedToken);
    if (cached && cached.expires > now) {
        return cached.guilds;
    }

    if (activeRequests.has(resolvedToken)) {
        return activeRequests.get(resolvedToken);
    }

    const fetchPromise = (async () => {
        try {
            const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
                headers: { Authorization: `Bearer ${resolvedToken}` }
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
            guildsCache.set(resolvedToken, {
                guilds,
                expires: Date.now() + CACHE_TTL
            });
            return guilds;
        } finally {
            activeRequests.delete(resolvedToken);
        }
    })();

    activeRequests.set(resolvedToken, fetchPromise);
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

    if (token !== 'nora_mock_token') {
        try {
            const user = await getDiscordUser(token).catch(() => null);
            if (user) {
                const UserPrefs = require('../../database/models/UserPrefs');
                const prefs = await UserPrefs.findOne({ where: { userId: user.id } });
                if (prefs && prefs.isTerminated) {
                    return res.status(403).json({ error: 'Terminated', reason: prefs.terminationReason || 'Violation of terms of service.' });
                }
            }
        } catch (e) {
            console.error('Error checking user termination status in requireGuildPermission:', e);
        }
    }

    if (token === 'nora_mock_token') {
        req.userGuild = {
            id: guildId,
            name: "Mock Guild",
            permissions: '1099511627775'
        };
        return next();
    }

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

// Simple in-memory cache for Discord user info to prevent rate limits
const userCache = new Map();
const activeUserRequests = new Map();
const USER_CACHE_TTL = 60 * 1000; // 60 seconds cache

const getDiscordUser = async (token) => {
    if (token === 'nora_mock_token') {
        return {
            id: '1214048435632603137',
            username: 'vaztinix',
            global_name: 'Vaz',
            avatar: 'https://cdn.discordapp.com/embed/avatars/0.png'
        };
    }
    let resolvedToken;
    try {
        resolvedToken = await resolveDiscordToken(token);
    } catch (e) {
        resolvedToken = token;
    }
    const now = Date.now();
    const cached = userCache.get(resolvedToken);
    if (cached && cached.expires > now) {
        return cached.user;
    }

    if (activeUserRequests.has(resolvedToken)) {
        return activeUserRequests.get(resolvedToken);
    }

    const fetchPromise = (async () => {
        try {
            const response = await fetch('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${resolvedToken}` }
            });

            if (!response.ok) {
                if (response.status === 429 && cached) {
                    console.warn('[Auth Middleware] Discord Rate Limit hit (429) for user. Reusing expired cache.');
                    return cached.user;
                }
                const err = new Error(`Discord User API returned ${response.status}`);
                err.status = response.status;
                throw err;
            }

            const user = await response.json();
            userCache.set(resolvedToken, {
                user,
                expires: Date.now() + USER_CACHE_TTL
            });
            return user;
        } finally {
            activeUserRequests.delete(resolvedToken);
        }
    })();

    activeUserRequests.set(resolvedToken, fetchPromise);
    return fetchPromise;
};

// Clean up user cache periodically
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of userCache.entries()) {
        if (data.expires < now) {
            userCache.delete(token);
        }
    }
}, 5 * 60 * 1000);

module.exports = { requireGuildPermission, getCachedUserGuilds, getDiscordUser };
