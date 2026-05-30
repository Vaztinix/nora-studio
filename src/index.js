require('dotenv').config();

const systemLogs = [];
const MAX_SYSTEM_LOGS = 100;

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const bufferLog = (message, type = 'INFO') => {
    systemLogs.push({
        timestamp: new Date().toISOString(),
        type,
        message: typeof message === 'object' ? JSON.stringify(message) : String(message)
    });
    if (systemLogs.length > MAX_SYSTEM_LOGS) {
        systemLogs.shift();
    }
};

console.log = (...args) => {
    originalConsoleLog(...args);
    bufferLog(args.join(' '), 'INFO');
};

console.error = (...args) => {
    originalConsoleError(...args);
    bufferLog(args.join(' '), 'ERROR');
};

console.warn = (...args) => {
    originalConsoleWarn(...args);
    bufferLog(args.join(' '), 'WARN');
};

const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const sequelize = require('./database/db');

// Require models to sync them
require('./database/models/GuildSettings');
require('./database/models/UserLevel');
require('./database/models/Giveaway');
require('./database/models/EasterEgg');
require('./database/models/GlobalSettings');
require('./database/models/OneTimeEvent');
require('./database/models/Warning');
require('./database/models/UserMemory');
require('./database/models/UserPrefs');
require('./database/models/HostedBot');
require('./database/models/CustomCommand');
require('./database/models/Session');


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.AutoModerationExecution,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember, Partials.ThreadMember]
});

client.commands = new Collection();

// Execute handlers
const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');

commandHandler(client);
eventHandler(client);

// Sync database and login with high-stability index handling
sequelize.sync().then(() => {
    console.log('Nora - Database Synchronized (Leveling Indices Healthy)');
    
    // 🛡️ Nora System Persistence (System Backup) - V17.2
    const { systemBackup } = require('./utils/persistence');
    systemBackup();

    // Start autonomous systems
    require('./utils/presence').startPresence();
    require('./utils/voiceTracker').start(client);
    require('./utils/giveawayManager').startGiveawayManager(client);
    
    // Final check for token stability
    client.login(process.env.TOKEN);
}).catch(err => {
    console.error('Nora - Database Connection Failure:', err);
});

// Global Error Handling to prevent the bot from going offline on minor errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

// 🗳️ System Vote HQ Tracker (Webhook Server) & AutoPoster
const { AutoPoster } = require('topgg-autoposter');
const express = require('express');
const Topgg = require('@top-gg/sdk');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;
const { EmbedBuilder } = require('discord.js');
const noraLeveling = require('./utils/noraLeveling');
const GuildSettings = require('./database/models/GuildSettings');
const RobloxVerify = require('./database/models/RobloxVerify');

const webhook = new Topgg.Webhook(process.env.VOTE_SECRET || 'NORA_VOTE_SECRET_2026');
const NORA_SERVER_ID = '1351304498185900184';
const NORA_V0 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJib3QiOiJ0cnVlIiwiaWQiOiIxMzc1OTQzNzMwOTUxMDk4NTQ5IiwiaWF0IjoiMTc3MDc3MTYxNCJ9.o96WlKCfGM-Gzidt0laP_TYy2vEj6aaQ20qMXJRwc44';

// Manual CORS Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Attach client to request
app.use((req, res, next) => {
    req.client = client;
    next();
});

// Serve static dashboard assets from dist/ directory (if exists) or src/web directory
app.use(express.static(path.join(__dirname, '../dist')));
app.use(express.static(path.join(__dirname, 'web')));

// Mount the API Router for settings
const settingsRouter = require('./api/routes/settings');
app.use('/api/guilds/:guildId/settings', settingsRouter);

const guildsRouter = require('./api/routes/guilds');
app.use('/api/guilds/:guildId', guildsRouter);

// Studio workspace router (Hosted bots, AI persona & history context)
const studioRouter = require('./api/routes/studio');
app.use('/api/user', studioRouter);
app.use('/api/system', studioRouter);

// Developer / Owner-Only admin router
const adminRouter = require('./api/routes/admin');
app.use('/api/admin', adminRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Nora API is running.' });
});

// Client telemetry logs endpoint
app.post('/api/logs/client', (req, res) => {
    const { level, message, context, stack } = req.body;
    const cleanContext = (context && typeof context === 'object') ? JSON.stringify(context) : (context || '');
    const cleanStack = stack ? `\nStack: ${stack}` : '';
    const logString = `[CLIENT_${level}] ${message} ${cleanContext}${cleanStack}`;

    const uppercaseLevel = String(level).toUpperCase();
    if (uppercaseLevel === 'ERROR' || uppercaseLevel === 'FATAL' || uppercaseLevel === 'PANIC' || uppercaseLevel === 'PANIC_PROMISE') {
        console.error(logString);
    } else if (uppercaseLevel === 'WARN' || uppercaseLevel === 'WARNING') {
        console.warn(logString);
    } else {
        console.log(logString);
    }
    res.json({ success: true });
});

// Helper to get Discord user
const getDiscordUser = async (token) => {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Invalid token');
    return res.json();
};

// Helper to handle route errors (returning 401 if invalid token)
const handleRouteError = (res, e, routeName) => {
    console.error(`Error in ${routeName}:`, e);
    const status = e.message === 'Invalid token' ? 401 : 500;
    return res.status(status).json({ error: status === 401 ? 'Unauthorized' : e.message });
};

// API User Profiler Endpoints
app.get('/api/user/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    
    const crypto = require('crypto');
    const axios = require('axios');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    
    try {
        const Session = require('./database/models/Session');
        const UserPrefs = require('./database/models/UserPrefs');
        
        let session = await Session.findByPk(tokenHash);
        if (session && new Date() > new Date(session.expiresAt)) {
            await session.destroy();
            session = null;
        }
        
        let user = null;
        if (session) {
            // Check session hardening
            const prefs = await UserPrefs.findOne({ where: { userId: session.userId } });
            if (prefs && prefs.sessionHardened && session.ipAddress !== clientIp) {
                await session.destroy();
                return res.status(403).json({ error: 'Session Hardening: IP mismatch. Session terminated.' });
            }
            
            // Check if Discord token is still valid
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => null);
            if (!userRes) {
                await session.destroy();
                return res.status(401).json({ error: 'Unauthorized' });
            }
            user = userRes.data;
        } else {
            // Fetch user info from Discord using axios
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => null);
            if (!userRes) return res.status(401).json({ error: 'Unauthorized' });
            user = userRes.data;
            
            // GeoIP lookup
            let location = 'Unknown Location';
            try {
                const geo = await axios.get(`http://ip-api.com/json/${clientIp}`, { timeout: 3000 });
                if (geo.data && geo.data.status === 'success') {
                    location = `${geo.data.city || 'Unknown'}, ${geo.data.country || 'Unknown'}`;
                }
            } catch (e) {}
            
            session = await Session.create({
                id: tokenHash,
                userId: user.id,
                ipAddress: clientIp,
                userAgent: req.headers['user-agent'] || 'Unknown',
                location: location,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            });
        }
        
        // Construct full CDN avatar URL
        if (user.avatar) {
            const isAnimated = user.avatar.startsWith('a_');
            user.avatar = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${isAnimated ? 'gif' : 'png'}?size=256`;
        } else {
            user.avatar = `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) % 5n) + 1n}.png`;
        }

        // Determine if user is owner of the bot
        let isOwner = false;
        const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];
        if (APP_OWNER_IDS.includes(user.id)) {
            isOwner = true;
        } else {
            try {
                const app = await req.client.application.fetch();
                if (app.owner) {
                    if (app.owner.id === user.id || (app.owner.members && app.owner.members.has(user.id))) {
                        isOwner = true;
                    }
                }
            } catch (e) {}
        }
        user.isOwner = isOwner;

        // Fetch user preferences/badges from DB
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
        user.prefs = prefs;
        user.sessionHardened = !!prefs.sessionHardened;

        // Dynamic Premium Verification Check
        const checkPremium = (p) => {
            if (isOwner) return true;
            if (!p) return false;
            if (p.isManualPremium || p.isPremium) return true;
            const paidTime = p.paidExpiresAt ? new Date(p.paidExpiresAt).getTime() : 0;
            const expandedMs = p.expandedTimeMs ? Number(p.expandedTimeMs) : 0;
            return (paidTime + expandedMs) > Date.now();
        };
        user.noraPremium = checkPremium(prefs);

        res.json(user);
    } catch (e) {
        console.error('Error in /api/user/me:', e);
        res.status(401).json({ error: 'Unauthorized' });
    }
});

// Update profile preferences
app.post('/api/user/profile', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const UserPrefs = require('./database/models/UserPrefs');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
        
        const { robloxPublic, profilePublic, bio, language, dashboardSettings } = req.body;
        if (robloxPublic !== undefined) prefs.robloxPublic = robloxPublic;
        if (profilePublic !== undefined) prefs.profilePublic = profilePublic;
        if (bio !== undefined) prefs.bio = bio;
        if (language !== undefined) {
            prefs.language = language;
            prefs.customTheme = language;
        }
        if (dashboardSettings !== undefined) {
            prefs.dashboardSettings = dashboardSettings;
        }
        await prefs.save();
        res.json({ success: true, prefs });
    } catch (e) {
        handleRouteError(res, e, '/api/user/profile');
    }
});

// Update personal preferences
app.post('/api/user/prefs', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const UserPrefs = require('./database/models/UserPrefs');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
        
        const { sessionHardened } = req.body;
        if (sessionHardened !== undefined) prefs.sessionHardened = sessionHardened;
        await prefs.save();
        res.json({ success: true, prefs });
    } catch (e) {
        handleRouteError(res, e, '/api/user/prefs');
    }
});

app.get('/api/user/guilds', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const { getCachedUserGuilds } = require('./api/middleware/auth');
        const guilds = await getCachedUserGuilds(token);
        
        // Filter guilds where user has Administrator (0x8) or Manage Guild (0x20) or is owner
        const filteredGuilds = guilds.filter(g => {
            const perms = BigInt(g.permissions);
            return (perms & BigInt(0x8)) === BigInt(0x8) || (perms & BigInt(0x20)) === BigInt(0x20) || g.owner;
        });

        const guildIds = filteredGuilds.map(g => g.id);
        const GuildSettings = require('./database/models/GuildSettings');
        const settingsRecords = await GuildSettings.findAll({ where: { guildId: guildIds } });
        const settingsMap = new Map(settingsRecords.map(s => [s.guildId, s]));

        // Determine if user is bot owner/founder
        let isUserBotOwner = false;
        try {
            const appInfo = await req.client.application.fetch();
            if (appInfo.owner) {
                if (appInfo.owner.id === user.id || (appInfo.owner.members && appInfo.owner.members.has(user.id))) {
                    isUserBotOwner = true;
                }
            }
        } catch (e) {}
        if (user.id === '1214048435632603137') {
            isUserBotOwner = true;
        }

        const managedGuilds = filteredGuilds.map(g => {
            const hasNora = req.client.guilds.cache.has(g.id);
            const liveGuild = req.client.guilds.cache.get(g.id);
            const settings = settingsMap.get(g.id);

            const isPremiumSettings = settings ? (!!settings.isPremium || !!settings.isManualPremium) : false;
            
            let isOwnerPremium = false;
            if (liveGuild) {
                if (liveGuild.ownerId === '1214048435632603137') {
                    isOwnerPremium = true;
                }
            }
            if (g.owner && isUserBotOwner) {
                isOwnerPremium = true;
            }

            const isPremium = isPremiumSettings || isOwnerPremium;

            return {
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                hasNora,
                memberCount: liveGuild ? liveGuild.memberCount : 0,
                onlineCount: liveGuild ? liveGuild.presences.cache.filter(p => p.status !== 'offline').size : 0,
                permissions: g.permissions,
                topggVerified: settings ? !!settings.topggVerified : false,
                topggBotId: settings ? settings.topggBotId : null,
                topggLegacyOwnerId: settings ? settings.topggLegacyOwnerId : null,
                isPremium
            };
        });
        
        res.json(managedGuilds);
    } catch (e) {
        handleRouteError(res, e, '/api/user/guilds');
    }
});

// Roblox Verification API endpoints
app.get('/api/user/roblox', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const record = await RobloxVerify.findOne({ where: { userId: user.id } });
        if (!record) return res.json({ linked: false });
        
        let username = record.robloxId;
        if (/^\d+$/.test(record.robloxId)) {
            try {
                const profileRes = await fetch(`https://users.roblox.com/v1/users/${record.robloxId}`);
                if (profileRes.ok) {
                    const data = await profileRes.json();
                    username = data.name;
                }
            } catch (e) {
                console.error('Failed to fetch Roblox username by ID:', e);
            }
        }
        
        res.json({ linked: true, status: record.status, robloxId: record.robloxId, robloxUsername: username, verifyCode: record.verifyCode });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox');
    }
});

app.post('/api/user/roblox/link', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username' });
    try {
        const user = await getDiscordUser(token);
        
        // Search Roblox API for ID
        const searchRes = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
        });
        if (!searchRes.ok) {
            return res.status(500).json({ error: 'Failed to contact Roblox API' });
        }
        const searchData = await searchRes.json();
        if (!searchData.data || searchData.data.length === 0) {
            return res.status(404).json({ error: 'Roblox user not found. Check the username spelling.' });
        }
        const robloxUser = searchData.data[0];
        const code = `Nora-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        const [record] = await RobloxVerify.findOrCreate({ 
            where: { userId: user.id }, 
            defaults: { 
                robloxId: robloxUser.id.toString(),
                verifyCode: code, 
                status: 'PENDING' 
            } 
        });

        if (record.status !== 'VERIFIED') {
            record.verifyCode = code;
            record.robloxId = robloxUser.id.toString();
            record.status = 'PENDING';
            await record.save();
        }

        res.json({ success: true, verifyCode: record.verifyCode, status: record.status, linked: true });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/link');
    }
});

app.post('/api/user/roblox/check', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const record = await RobloxVerify.findOne({ where: { userId: user.id } });
        if (!record) return res.status(404).json({ error: 'Link not initialized' });

        // If robloxId is not numeric, it's a legacy username string. Let's resolve it first.
        if (!/^\d+$/.test(record.robloxId)) {
            const searchRes = await fetch('https://users.roblox.com/v1/usernames/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usernames: [record.robloxId], excludeBannedUsers: true })
            });
            if (searchRes.ok) {
                const searchData = await searchRes.json();
                if (searchData.data && searchData.data.length > 0) {
                    record.robloxId = searchData.data[0].id.toString();
                    await record.save();
                }
            }
        }

        // Fetch Roblox profile to verify description code
        const profileRes = await fetch(`https://users.roblox.com/v1/users/${record.robloxId}`);
        if (!profileRes.ok) {
            return res.status(400).json({ error: 'Failed to fetch Roblox profile for verification. Check that the ID is valid.' });
        }
        const profileData = await profileRes.json();
        const description = profileData.description || '';

        if (description.includes(record.verifyCode)) {
            record.status = 'VERIFIED';
            await record.save();
            res.json({ success: true, status: 'VERIFIED', robloxId: record.robloxId, robloxUsername: profileData.name });
        } else {
            res.status(400).json({ error: `Verification code "${record.verifyCode}" was not found in your Roblox description.` });
        }
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/check');
    }
});

app.post('/api/user/roblox/unlink', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        await RobloxVerify.destroy({ where: { userId: user.id } });
        res.json({ success: true });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/unlink');
    }
});

app.get('/api/user/roblox/presence', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const record = await RobloxVerify.findOne({ where: { userId: user.id } });
        
        if (!record || record.status !== 'VERIFIED') {
            return res.json({ error: 'Not linked' });
        }
        
        let robloxId = record.robloxId;
        
        // If robloxId is not numeric, it's a legacy username string. Let's resolve it first.
        if (!/^\d+$/.test(robloxId)) {
            try {
                const searchRes = await fetch('https://users.roblox.com/v1/usernames/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usernames: [robloxId], excludeBannedUsers: true })
                });
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    if (searchData.data && searchData.data.length > 0) {
                        robloxId = searchData.data[0].id.toString();
                        record.robloxId = robloxId;
                        await record.save();
                    } else {
                        return res.json({ error: 'Roblox user not found' });
                    }
                } else {
                    return res.json({ error: 'Failed to contact Roblox API to resolve username' });
                }
            } catch (e) {
                console.error('Failed to resolve legacy Roblox username in presence:', e);
                return res.json({ error: 'Error resolving username' });
            }
        }
        
        // 1. Fetch profile details
        let displayName = record.robloxId;
        let username = record.robloxId;
        try {
            const profileRes = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
            if (profileRes.ok) {
                const profileData = await profileRes.json();
                username = profileData.name;
                displayName = profileData.displayName;
            }
        } catch (e) {
            console.error('Failed to fetch Roblox profile:', e);
        }
        
        // 2. Fetch avatar headshot thumbnail
        let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxId}&width=150&height=150&format=png`;
        try {
            const avatarRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`);
            if (avatarRes.ok) {
                const avatarData = await avatarRes.json();
                if (avatarData.data && avatarData.data.length > 0) {
                    avatarUrl = avatarData.data[0].imageUrl;
                }
            }
        } catch (e) {
            console.error('Failed to fetch Roblox avatar headshot:', e);
        }
        
        // 3. Fetch presence info
        let online = false;
        let status = 'Offline';
        let joinable = false;
        let placeId = null;
        let gameId = null;
        
        try {
            const presenceRes = await fetch('https://presence.roblox.com/v1/presence/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds: [parseInt(robloxId)] })
            });
            if (presenceRes.ok) {
                const presenceData = await presenceRes.json();
                if (presenceData.userPresences && presenceData.userPresences.length > 0) {
                    const p = presenceData.userPresences[0];
                    const type = p.userPresenceType; // 0: Offline, 1: Online, 2: InGame, 3: InStudio
                    online = type > 0;
                    if (type === 1) {
                        status = 'Online on Website';
                    } else if (type === 2) {
                        status = p.lastLocation || 'Playing Roblox';
                        joinable = true;
                        placeId = p.rootPlaceId || p.placeId;
                        gameId = p.gameId;
                    } else if (type === 3) {
                        status = 'Editing in Studio';
                    }
                }
            }
        } catch (e) {
            console.error('Failed to fetch Roblox presence:', e);
        }
        
        res.json({
            username,
            displayName,
            avatar: avatarUrl,
            online,
            status,
            joinable,
            placeId,
            gameId
        });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/presence');
    }
});

app.get('/api/user/topgg/bots', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const searchUrl = `https://top.gg/api/bots?search=owners:${user.id}`;
        
        const topggRes = await fetch(searchUrl, {
            headers: { Authorization: NORA_V0 }
        });
        
        if (!topggRes.ok) {
            console.error(`Top.gg search API failed with status ${topggRes.status}`);
            return res.json({ bots: [] });
        }
        
        const data = await topggRes.json();
        const bots = (data.results || [])
            .filter(b => Array.isArray(b.owners) && b.owners.includes(user.id))
            .map(b => ({
                id: b.id,
                username: b.username,
                avatar: b.avatar ? `https://cdn.discordapp.com/avatars/${b.id}/${b.avatar}.png` : 'https://top.gg/images/topgg-logo.png'
            }));
        
        res.json({ bots });
    } catch (e) {
        handleRouteError(res, e, '/api/user/topgg/bots');
    }
});

const getWebFilePath = (filename) => {
    const distPath = path.join(__dirname, '../dist', filename);
    if (fs.existsSync(distPath)) {
        return distPath;
    }
    return path.join(__dirname, 'web', filename);
};

// Serve index.html (Vaztinix Bio landing page) at root '/'
app.get('/', (req, res) => {
    res.sendFile(getWebFilePath('index.html'));
});

// Serve nora.html at '/nora'
app.get('/nora', (req, res) => {
    res.sendFile(getWebFilePath('nora.html'));
});

// Serve dashboard.html at '/dashboard'
app.get('/dashboard', (req, res) => {
    res.sendFile(getWebFilePath('dashboard.html'));
});

// Clean URLs for other subpages
app.get('/team', (req, res) => {
    res.sendFile(getWebFilePath('team.html'));
});

app.get('/docs', (req, res) => {
    res.sendFile(getWebFilePath('docs.html'));
});

app.get('/ai', (req, res) => {
    res.sendFile(getWebFilePath('AI.html'));
});

app.get('/ai-studio', (req, res) => {
    res.sendFile(getWebFilePath('ai-studio.html'));
});

app.get('/install', (req, res) => {
    res.sendFile(getWebFilePath('install.html'));
});

app.get('/legal', (req, res) => {
    res.sendFile(getWebFilePath('legal.html'));
});

// GET /api/logs returns the buffered console output
app.get('/api/logs', (req, res) => {
    res.json(systemLogs);
});


app.post('/topgg/webhook', webhook.listener(async (vote) => {
    console.log(`[Top.gg] Received vote from User: ${vote.user} for Bot: ${vote.bot}`);

    try {
        const userId = vote.user;
        
        // Award XP in Nora Mainframe (HQ)
        const userRecord = await noraLeveling.getOrInitializeUser(userId, NORA_SERVER_ID);
        if (userRecord) {
            await noraLeveling.addExperience(userRecord, 50);
            userRecord.voteCount = (userRecord.voteCount || 0) + 1;
            userRecord.lastVoteTimestamp = new Date();
            await userRecord.save();
        }

        // Log to HQ
        const hqSettings = await GuildSettings.findOne({ where: { guildId: NORA_SERVER_ID } });
        if (hqSettings && hqSettings.voteLogChannelId) {
            const hqGuild = client.guilds.cache.get(NORA_SERVER_ID);
            if (hqGuild) {
                const logChannel = hqGuild.channels.cache.get(hqSettings.voteLogChannelId);
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('New Top.gg Vote! 🗳️')
                        .setDescription(`User <@${userId}> just voted for Nora!`)
                        .addFields(
                            { name: 'Reward', value: '50 XP Added', inline: true },
                            { name: 'Total Votes', value: `${userRecord ? userRecord.voteCount : 1}`, inline: true }
                        )
                        .setColor(0xFFA500)
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }
        }
    } catch (error) {
        console.error('[Top.gg] Error processing vote:', error);
    }
}));


/**
 * POST /api/webhooks/topgg/:guildId
 * Receives incoming votes for custom bots configured on Top.gg
 */
app.post('/api/webhooks/topgg/:guildId', async (req, res) => {
    try {
        const { guildId } = req.params;
        const vote = req.body; // Top.gg sends { bot, user, type, isWeekend, query }

        // Find settings for the guild
        const GuildSettings = require('./database/models/GuildSettings');
        const settings = await GuildSettings.findOne({ where: { guildId } });
        if (!settings) {
            return res.status(404).json({ error: 'Guild settings not found.' });
        }

        // Verify authorization header matches the guild's webhook secret
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== settings.topggWebhookAuth) {
            console.warn(`[Top.gg Webhook] Unauthorized vote attempt for guild ${guildId}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        console.log(`[Top.gg Webhook] Received vote for Guild: ${guildId}, User: ${vote.user}, Bot: ${vote.bot}`);

        // Only process real upvotes or tests
        if (vote.type === 'upvote' || vote.type === 'test') {
            const userId = vote.user;
            
            // 1. Award XP in the specific guild
            const noraLeveling = require('./utils/noraLeveling');
            const userRecord = await noraLeveling.getOrInitializeUser(userId, guildId);
            if (userRecord) {
                const xpBoost = settings.topggXpBoost || 1;
                // Double XP on weekends
                const count = (settings.topggDoubleXp && (vote.isWeekend || [6, 0].includes(new Date().getDay()))) ? 2 : 1;
                const baseXP = 50 * xpBoost * count;
                
                await noraLeveling.addExperience(userRecord, baseXP);
                userRecord.voteCount = (userRecord.voteCount || 0) + 1;
                userRecord.lastVoteTimestamp = new Date();
                await userRecord.save();
            }

            // 2. Assign Reward Role if configured
            if (settings.topggRewardRoleId) {
                try {
                    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
                    if (guild) {
                        const member = await guild.members.fetch(userId).catch(() => null);
                        if (member && !member.roles.cache.has(settings.topggRewardRoleId)) {
                            const roleObj = guild.roles.cache.get(settings.topggRewardRoleId);
                            if (roleObj && guild.members.me.roles.highest.position > roleObj.position) {
                                await member.roles.add(settings.topggRewardRoleId).catch(e => {
                                    console.error(`[Top.gg Webhook] Failed to add reward role to user ${userId} in ${guildId}:`, e.message);
                                });
                            }
                        }
                    }
                } catch (e) {
                    console.error('[Top.gg Webhook] Error assigning reward role:', e.message);
                }
            }

            // 3. Send Notification alert
            if (settings.topggVoteChannelId) {
                const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
                if (guild) {
                    const { sendVoteNotification } = require('./utils/topggWebhookHandler');
                    await sendVoteNotification(guild, settings, userId, false).catch(err => {
                        console.error('[Top.gg Webhook] Notification sending failed:', err.message);
                    });
                }
            }
        }

        res.json({ success: true });
    } catch (e) {
        console.error('[Top.gg Webhook] Error processing incoming vote:', e);
        res.status(500).json({ error: e.message });
    }
});


// Serve 404 page for unmatched routes
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'web', '404.html'));
});

app.listen(PORT, () => {
    console.log(`[System] Web Dashboard and Webhook listener online at port ${PORT}`);
    
    // Start AutoPoster using the v0 token for statistics
    const ap = AutoPoster(NORA_V0, client);
    ap.on('posted', () => {
        console.log('[Top.gg] Statistics automatically posted.');
    });
});





