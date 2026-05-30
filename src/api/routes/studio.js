const express = require('express');
const router = express.Router();
const HostedBot = require('../../database/models/HostedBot');
const CustomCommand = require('../../database/models/CustomCommand');
const UserPrefs = require('../../database/models/UserPrefs');

// Authentication middleware using session verification and IP hardening
const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const token = authHeader.split(' ')[1];
    
    const crypto = require('crypto');
    const axios = require('axios');
    const Session = require('../../database/models/Session');
    const UserPrefs = require('../../database/models/UserPrefs');
    
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    
    try {
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
            
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => null);
            if (!userRes) {
                await session.destroy();
                return res.status(401).json({ error: 'Unauthorized: Invalid token' });
            }
            user = userRes.data;
        } else {
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => null);
            if (!userRes) {
                return res.status(401).json({ error: 'Unauthorized: Invalid token' });
            }
            user = userRes.data;
            
            // Fetch GeoIP
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
        
        req.user = user;
        req.session = session;
        next();
    } catch (err) {
        console.error('Error verifying token in studio middleware:', err);
        return res.status(500).json({ error: 'Internal server error verifying token' });
    }
};

// GET /api/system/health
router.get('/health', async (req, res) => {
    try {
        const guildsCount = req.client.guilds.cache.size;
        const uptime = process.uptime();
        const pid = process.pid;
        const ready = req.client.isReady();
        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
        
        res.json({
            guilds: guildsCount,
            uptime: uptime,
            pid: pid,
            ready: ready,
            memoryMB: Math.round(memoryUsage)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/user/ai-profile
router.get('/ai-profile', requireAuth, async (req, res) => {
    try {
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: req.user.id } });
        let profileObj = {};
        try {
            profileObj = JSON.parse(prefs.aiProfile || '{}');
        } catch (e) {}

        const defaultProfile = {
            mode: 'balanced',
            voice: 'friendly',
            contextDays: '30',
            responseLength: 'medium',
            customInstructions: 'Be helpful, transparent, and respectful. Keep answers concise and community-focused.',
            webSearchEnabled: true,
            historySummarize: true,
            showFallbackNote: true
        };
        const mergedProfile = { ...defaultProfile, ...profileObj };

        res.json({
            profile: mergedProfile,
            usage: {
                requestsThisMonth: 0,
                tokensThisMonth: 0
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/user/ai-profile
router.post('/ai-profile', requireAuth, async (req, res) => {
    try {
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: req.user.id } });
        prefs.aiProfile = JSON.stringify(req.body);
        await prefs.save();
        res.json({ success: true, profile: req.body });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/user/hosted-bots
router.get('/hosted-bots', requireAuth, async (req, res) => {
    try {
        const bots = await HostedBot.findAll({ where: { ownerId: req.user.id } });
        res.json(bots);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/user/hosted-bots
router.post('/hosted-bots', requireAuth, async (req, res) => {
    const { token, prefix, label } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'Missing bot token' });
    }

    try {
        const botRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` }
        });
        if (!botRes.ok) {
            return res.status(400).json({ error: 'Invalid Bot Token. Please check that it is valid.' });
        }
        const botUser = await botRes.json();
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${botUser.id}&permissions=8&scope=bot%20applications.commands`;

        const [bot, created] = await HostedBot.findOrCreate({
            where: { id: botUser.id },
            defaults: {
                id: botUser.id,
                ownerId: req.user.id,
                name: label || botUser.username,
                token: token,
                inviteUrl: inviteUrl,
                avatar: botUser.avatar || null,
                prefix: prefix || '!',
                isEnabled: true
            }
        });

        if (!created) {
            await bot.update({
                ownerId: req.user.id,
                name: label || bot.name,
                token: token,
                inviteUrl: inviteUrl,
                avatar: botUser.avatar || bot.avatar,
                prefix: prefix || bot.prefix
            });
        }

        res.json({ success: true, bot });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/user/hosted-bots/:botId
router.delete('/hosted-bots/:botId', requireAuth, async (req, res) => {
    try {
        const { botId } = req.params;
        const bot = await HostedBot.findOne({ where: { id: botId, ownerId: req.user.id } });
        if (!bot) {
            return res.status(404).json({ error: 'Hosted bot not found' });
        }

        await CustomCommand.destroy({ where: { botId: bot.id } });
        await bot.destroy();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/user/hosted-bots/:botId/commands
router.get('/hosted-bots/:botId/commands', requireAuth, async (req, res) => {
    try {
        const { botId } = req.params;
        const bot = await HostedBot.findOne({ where: { id: botId, ownerId: req.user.id } });
        if (!bot) {
            return res.status(404).json({ error: 'Hosted bot not found' });
        }

        const commands = await CustomCommand.findAll({ where: { botId: bot.id } });
        res.json(commands);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/user/hosted-bots/:botId/commands
router.post('/hosted-bots/:botId/commands', requireAuth, async (req, res) => {
    try {
        const { botId } = req.params;
        const { name, type, trigger, description, response } = req.body;

        const bot = await HostedBot.findOne({ where: { id: botId, ownerId: req.user.id } });
        if (!bot) {
            return res.status(404).json({ error: 'Hosted bot not found' });
        }

        const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32);
        if (!cleanName) {
            return res.status(400).json({ error: 'Invalid command name' });
        }

        const [command, created] = await CustomCommand.findOrCreate({
            where: { botId: bot.id, name: cleanName },
            defaults: {
                id: `${bot.id}-${cleanName}`,
                botId: bot.id,
                name: cleanName,
                description: description || `Custom command ${cleanName}`,
                type: type || 'text',
                responseContent: response,
                trigger: trigger || 'message',
                arguments: [],
                permissions: [],
                tokenCost: 1,
                totalExecutions: 0,
                enabled: true
            }
        });

        if (!created) {
            await command.update({
                description: description || command.description,
                type: type || command.type,
                responseContent: response,
                trigger: trigger || command.trigger,
                enabled: true
            });
        }

        // Update command count in bot record
        const count = await CustomCommand.count({ where: { botId: bot.id } });
        await bot.update({ commandCount: count });

        res.json({ success: true, command });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/user/hosted-bots/:botId/commands/:commandName
router.delete('/hosted-bots/:botId/commands/:commandName', requireAuth, async (req, res) => {
    try {
        const { botId, commandName } = req.params;
        const bot = await HostedBot.findOne({ where: { id: botId, ownerId: req.user.id } });
        if (!bot) {
            return res.status(404).json({ error: 'Hosted bot not found' });
        }

        const command = await CustomCommand.findOne({ where: { botId: bot.id, name: commandName } });
        if (!command) {
            return res.status(404).json({ error: 'Command not found' });
        }

        await command.destroy();

        // Update command count in bot record
        const count = await CustomCommand.count({ where: { botId: bot.id } });
        await bot.update({ commandCount: count });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/user/ai-history
router.get('/ai-history', requireAuth, async (req, res) => {
    try {
        const { guildId, channelId } = req.query;
        if (!guildId || !channelId) {
            return res.status(400).json({ error: 'Missing guildId or channelId' });
        }

        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Guild not found by bot.' });
        }

        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found in this guild.' });
        }

        if (!channel.isTextBased()) {
            return res.status(400).json({ error: 'Channel is not text-based.' });
        }

        const messages = await channel.messages.fetch({ limit: 10 }).catch(() => []);
        const summaryLines = Array.from(messages.values()).reverse().map(m => `${m.author.username}: ${m.content}`);
        const summary = summaryLines.join('\n') || 'No recent messages in this channel.';
        
        res.json({ summary });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/user/sessions
router.get('/sessions', requireAuth, async (req, res) => {
    try {
        const Session = require('../../database/models/Session');
        const sessions = await Session.findAll({ where: { userId: req.user.id } });
        
        const currentToken = req.headers.authorization.split(' ')[1];
        const crypto = require('crypto');
        const currentHash = crypto.createHash('sha256').update(currentToken).digest('hex');
        
        const formatted = sessions.map(s => ({
            id: s.id,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            location: s.location || 'Unknown Location',
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
            isCurrent: s.id === currentHash
        }));
        
        res.json(formatted);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/user/sessions/:sessionId/expire
router.post('/sessions/:sessionId/expire', requireAuth, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const Session = require('../../database/models/Session');
        const count = await Session.destroy({ where: { id: sessionId, userId: req.user.id } });
        res.json({ success: count > 0 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/user/sessions/expire-all
router.post('/sessions/expire-all', requireAuth, async (req, res) => {
    try {
        const Session = require('../../database/models/Session');
        const currentToken = req.headers.authorization.split(' ')[1];
        const crypto = require('crypto');
        const currentHash = crypto.createHash('sha256').update(currentToken).digest('hex');
        
        const { Op } = require('sequelize');
        const count = await Session.destroy({
            where: {
                userId: req.user.id,
                id: { [Op.ne]: currentHash }
            }
        });
        res.json({ success: true, count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
