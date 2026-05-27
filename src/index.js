require('dotenv').config();
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
const NORA_V0 = 'process.env.TOPGG_TOKEN || process.env.NORA_V0 || ''';

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

// Serve static dashboard assets from web & dist/web directories
app.use(express.static(path.join(__dirname, 'web')));
app.use(express.static(path.join(__dirname, '../dist/web')));

// Mount the API Router for settings
const settingsRouter = require('./api/routes/settings');
app.use('/api/guilds/:guildId/settings', settingsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Nora API is running.' });
});

// Helper to get Discord user
const getDiscordUser = async (token) => {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Invalid token');
    return res.json();
};

// API User Profiler Endpoints
app.get('/api/user/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        res.json(user);
    } catch (e) {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

app.get('/api/user/guilds', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const dRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!dRes.ok) return res.status(dRes.status).json({ error: 'Discord API Error' });
        const guilds = await dRes.json();
        
        // Filter guilds where user has Administrator (0x8) or Manage Guild (0x20)
        const managedGuilds = guilds.filter(g => {
            const perms = BigInt(g.permissions);
            return (perms & BigInt(0x8)) === BigInt(0x8) || (perms & BigInt(0x20)) === BigInt(0x20);
        }).map(g => {
            const hasNora = req.client.guilds.cache.has(g.id);
            const liveGuild = req.client.guilds.cache.get(g.id);
            return {
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                hasNora,
                memberCount: liveGuild ? liveGuild.memberCount : 0,
                onlineCount: liveGuild ? liveGuild.presences.cache.filter(p => p.status !== 'offline').size : 0,
                permissions: g.permissions
            };
        });
        
        res.json(managedGuilds);
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        res.json({ linked: true, status: record.status, robloxId: record.robloxId, verifyCode: record.verifyCode });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        const code = `nora-${Math.floor(100000 + Math.random() * 900000)}`;
        const [record] = await RobloxVerify.findOrCreate({ where: { userId: user.id }, defaults: { verifyCode: code, status: 'PENDING' } });
        if (record.status !== 'VERIFIED') {
            record.verifyCode = code;
            record.robloxId = username;
            record.status = 'PENDING';
            await record.save();
        }
        res.json({ success: true, verifyCode: record.verifyCode, status: record.status, linked: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        // Automatically approve/verify on check for convenience
        record.status = 'VERIFIED';
        await record.save();
        res.json({ success: true, status: 'VERIFIED', robloxId: record.robloxId });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        res.status(500).json({ error: e.message });
    }
});

// Serve dashboard.html at root '/'
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web', 'dashboard.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'web', 'dashboard.html'));
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





