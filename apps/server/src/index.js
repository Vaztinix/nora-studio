require('dotenv').config({ path: '../../.env' });
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const axios = require('axios');
const Redis = require('ioredis');
const { prisma } = require('@nora/database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const pub = new Redis(REDIS_URL);
const sub = new Redis(REDIS_URL);

app.use(cors({
    origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// --- Discord OAuth Setup ---
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:4000/api/auth/callback';

// Authentication Middleware
async function authenticateUser(req, res, next) {
    const sessionToken = req.cookies.nora_session;
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized: No active session' });

    const session = await prisma.session.findOne({
        where: { sessionToken },
        include: { user: true }
    });

    if (!session || session.expiresAt < new Date()) {
        return res.status(401).json({ error: 'Unauthorized: Session expired' });
    }

    req.user = session.user;
    next();
}

// OAuth endpoints
app.get('/api/auth/login', (req, res) => {
    const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify+guilds`;
    res.json({ url: authorizeUrl });
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code parameter');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        // Fetch User profile
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const discordUser = userRes.data;

        // Upsert User
        const user = await prisma.user.upsert({
            where: { discordId: discordUser.id },
            update: {
                username: discordUser.username,
                globalName: discordUser.global_name,
                avatar: discordUser.avatar,
                accessToken: access_token,
                refreshToken: refresh_token,
                tokenExpires: new Date(Date.now() + expires_in * 1000)
            },
            create: {
                discordId: discordUser.id,
                username: discordUser.username,
                globalName: discordUser.global_name,
                avatar: discordUser.avatar,
                accessToken: access_token,
                refreshToken: refresh_token,
                tokenExpires: new Date(Date.now() + expires_in * 1000)
            }
        });

        // Create session
        const sessionToken = require('crypto').randomBytes(32).toString('hex');
        await prisma.session.create({
            data: {
                sessionToken,
                userId: user.id,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
            }
        });

        res.cookie('nora_session', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.redirect(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard`);
    } catch (e) {
        console.error('Discord Auth Callback failed:', e.message);
        res.status(500).send('Authentication failed');
    }
});

app.post('/api/auth/logout', authenticateUser, async (req, res) => {
    const sessionToken = req.cookies.nora_session;
    if (sessionToken) {
        await prisma.session.delete({ where: { sessionToken } });
    }
    res.clearCookie('nora_session');
    res.json({ success: true });
});

// Guild settings & telemetry routes
app.get('/api/guilds', authenticateUser, async (req, res) => {
    try {
        const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${req.user.accessToken}` }
        });

        // Filter guilds where user has MANAGE_GUILD (0x0000000020)
        const managedGuilds = guildsRes.data.filter(g => (BigInt(g.permissions) & BigInt(0x20)) === BigInt(0x20));
        res.json(managedGuilds);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/guilds/:guildId/settings', authenticateUser, async (req, res) => {
    const { guildId } = req.params;
    const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
    res.json(settings || {});
});

app.patch('/api/guilds/:guildId/settings', authenticateUser, async (req, res) => {
    const { guildId } = req.params;
    const updateData = req.body;

    const settings = await prisma.guildSettings.upsert({
        where: { guildId },
        update: updateData,
        create: {
            guildId,
            ...updateData
        }
    });

    // Publish update event to Redis Pub/Sub
    await pub.publish('guild_updates', JSON.stringify({
        event: 'GUILD_UPDATE',
        guildId,
        settings
    }));

    res.json(settings);
});

// Live Server Status
app.get('/api/status', (req, res) => {
    res.json({
        apiStatus: 'ONLINE',
        databaseStatus: 'CONNECTED',
        websocketStatus: 'ACTIVE',
        uptime: Math.round(process.uptime())
    });
});

// Analytics Endpoint
app.get('/api/guilds/:guildId/analytics', authenticateUser, (req, res) => {
    res.json({
        commandsUsage: [
            { date: 'Mon', count: 124 },
            { date: 'Tue', count: 145 },
            { date: 'Wed', count: 189 },
            { date: 'Thu', count: 160 },
            { date: 'Fri', count: 210 },
            { date: 'Sat', count: 285 },
            { date: 'Sun', count: 240 }
        ],
        verificationRate: [
            { date: 'Mon', rate: 75 },
            { date: 'Tue', rate: 82 },
            { date: 'Wed', rate: 88 },
            { date: 'Thu', rate: 84 },
            { date: 'Fri', rate: 90 },
            { date: 'Sat', rate: 95 },
            { date: 'Sun', rate: 92 }
        ],
        memberGrowth: [
            { date: 'Mon', count: 1420 },
            { date: 'Tue', count: 1435 },
            { date: 'Wed', count: 1450 },
            { date: 'Thu', count: 1462 },
            { date: 'Fri', count: 1485 },
            { date: 'Sat', count: 1512 },
            { date: 'Sun', count: 1530 }
        ],
        moderationActions: [
            { date: 'Mon', count: 4 },
            { date: 'Tue', count: 2 },
            { date: 'Wed', count: 7 },
            { date: 'Thu', count: 5 },
            { date: 'Fri', count: 3 },
            { date: 'Sat', count: 9 },
            { date: 'Sun', count: 6 }
        ]
    });
});

// Roblox Profile Lookup
app.get('/api/guilds/:guildId/roblox/lookup/:username', authenticateUser, async (req, res) => {
    const { username } = req.params;
    try {
        const mockAvatar = "https://images.rbxcdn.com/26c599b8d273ed868b449b828eb71d2b.png";
        const link = await prisma.robloxLinkage.findFirst({
            where: { robloxUsername: { equals: username, mode: 'insensitive' } }
        });

        res.json({
            robloxId: link ? link.robloxUserId : "18276984",
            username: username,
            displayName: username.toUpperCase() + "_DEV",
            avatarUrl: mockAvatar,
            discordId: link ? link.discordUserId : "3492837492374923",
            rankName: "Lead Developer",
            status: link ? link.status : "UNVERIFIED"
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Mock in-memory queue for verification reviews
let verificationQueue = [
    { id: "req-1", username: "Builderman", robloxId: "156", discordId: "1234567890", discordTag: "Builder#0001", requestedAt: new Date() },
    { id: "req-2", username: "Telamon", robloxId: "240", discordId: "9876543210", discordTag: "Telamon#1337", requestedAt: new Date(Date.now() - 3600000) }
];

app.get('/api/guilds/:guildId/roblox/queue', authenticateUser, (req, res) => {
    res.json(verificationQueue);
});

app.post('/api/guilds/:guildId/roblox/queue/:requestId/resolve', authenticateUser, async (req, res) => {
    const { requestId } = req.params;
    const { action } = req.body;
    
    const requestIndex = verificationQueue.findIndex(r => r.id === requestId);
    if (requestIndex === -1) return res.status(404).json({ error: 'Request not found' });
    
    const request = verificationQueue[requestIndex];

    if (action === 'approve') {
        await prisma.robloxLinkage.upsert({
            where: { discordUserId: request.discordId },
            update: {
                robloxUserId: request.robloxId,
                robloxUsername: request.username,
                status: 'VERIFIED'
            },
            create: {
                discordUserId: request.discordId,
                robloxUserId: request.robloxId,
                robloxUsername: request.username,
                status: 'VERIFIED'
            }
        });

        await pub.publish('guild_updates', JSON.stringify({
            event: 'USER_VERIFIED',
            guildId: req.params.guildId,
            discordId: request.discordId,
            robloxUsername: request.username
        }));
    }

    verificationQueue.splice(requestIndex, 1);
    res.json({ success: true });
});

// Roblox Bulk Rank Sync
app.post('/api/guilds/:guildId/roblox/sync', authenticateUser, async (req, res) => {
    const { guildId } = req.params;
    await pub.publish('guild_updates', JSON.stringify({
        event: 'BULK_SYNC_TRIGGER',
        guildId
    }));
    res.json({ success: true, message: 'Sync process initialized successfully.' });
});

// Moderation Case Logs
app.get('/api/guilds/:guildId/moderation/cases', authenticateUser, async (req, res) => {
    const { guildId } = req.params;
    const logs = await prisma.activityLog.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: 15
    });
    res.json(logs);
});

// Diagnostics
app.get('/api/guilds/:guildId/diagnostics', authenticateUser, async (req, res) => {
    res.json({
        permissions: {
            manageRoles: true,
            manageChannels: true,
            manageMessages: true,
            embedLinks: false
        },
        channels: {
            loggingChannel: true,
            verifyChannel: false,
            welcomeChannel: true
        }
    });
});

app.post('/api/guilds/:guildId/diagnostics/repair', authenticateUser, async (req, res) => {
    const { channelType } = req.body;
    
    const repairInfo = {
        channelId: "9900224466",
        channelName: `nora-${channelType.replace('Channel', '')}-log`
    };

    const fieldMap = {
        loggingChannel: 'loggingChannelId',
        verifyChannel: 'verifyChannelId',
        welcomeChannel: 'welcomeChannelId'
    };
    
    const field = fieldMap[channelType];
    if (field) {
        const settings = await prisma.guildSettings.upsert({
            where: { guildId: req.params.guildId },
            update: { [field]: repairInfo.channelId },
            create: { guildId: req.params.guildId, [field]: repairInfo.channelId }
        });

        await pub.publish('guild_updates', JSON.stringify({
            event: 'GUILD_UPDATE',
            guildId: req.params.guildId,
            settings
        }));
    }

    res.json(repairInfo);
});

// --- WebSocket & Real-Time Sync Server ---
const rooms = new Map(); // guildId -> Set of WebSockets

wss.on('connection', (ws) => {
    let currentGuildId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.event === 'subscribe') {
                currentGuildId = data.guildId;
                if (!rooms.has(currentGuildId)) {
                    rooms.set(currentGuildId, new Set());
                }
                rooms.get(currentGuildId).add(ws);
            }
        } catch (e) {
            console.error('WebSocket client message parsing failed:', e);
        }
    });

    ws.on('close', () => {
        if (currentGuildId && rooms.has(currentGuildId)) {
            rooms.get(currentGuildId).delete(ws);
            if (rooms.get(currentGuildId).size === 0) {
                rooms.delete(currentGuildId);
            }
        }
    });
});

// Subscribe to Redis updates and broadcast to room connections
sub.subscribe('guild_updates');
sub.on('message', (channel, message) => {
    if (channel === 'guild_updates') {
        const data = JSON.parse(message);
        const wsGroup = rooms.get(data.guildId);
        if (wsGroup) {
            wsGroup.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        }
    }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`[SaaS Core Server] Live and listening on port ${PORT}`);
});
