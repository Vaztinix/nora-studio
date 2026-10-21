const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const axios = require('axios');
const GuildSettings = require('../../database/models/GuildSettings');
const UserLevel = require('../../database/models/UserLevel');
const UserPrefs = require('../../database/models/UserPrefs');

// Owner-only authentication middleware using axios
const requireOwner = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    try {
        let response;
        try {
            response = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: authHeader }
            });
        } catch (axiosErr) {
            console.error('Discord API token verification failed in requireOwner:', axiosErr.response?.data || axiosErr.message);
            return res.status(401).json({ 
                error: 'Unauthorized: Invalid Discord token', 
                details: axiosErr.response?.data ? JSON.stringify(axiosErr.response.data) : axiosErr.message 
            });
        }
        const user = response.data;

        let isOwner = false;
        try {
            const app = await req.client.application.fetch();
            if (app.owner) {
                if (app.owner.id === user.id || (app.owner.members && app.owner.members.has(user.id))) {
                    isOwner = true;
                }
            }
        } catch (e) {}
        const APP_OWNER_IDS = ['1214048435632603137', '1366229304257544213'];
        if (APP_OWNER_IDS.includes(user.id)) {
            isOwner = true;
        }

        if (!isOwner) {
            return res.status(403).json({ error: 'Forbidden: Owner-only access.' });
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('Error verifying owner in admin middleware:', err);
        return res.status(500).json({ error: 'Internal server error verifying authorization', details: err.message });
    }
};

// GET /api/admin/premium
router.get('/premium', requireOwner, async (req, res) => {
    try {
        // 1. Fetch Premium Servers
        const premiumServers = await GuildSettings.findAll({
            where: {
                [Op.or]: [
                    { isPremium: true },
                    { isManualPremium: true }
                ]
            }
        });

        const serversList = premiumServers.map(gs => {
            const guild = req.client.guilds.cache.get(gs.guildId);
            return {
                guildId: gs.guildId,
                name: guild ? guild.name : 'Unknown Server',
                icon: guild && guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                isManualPremium: !!gs.isManualPremium,
                isPremium: !!gs.isPremium
            };
        });

        // 2. Fetch Premium Users (merging UserPrefs and UserLevel)
        const usersPrefsList = await UserPrefs.findAll({
            where: {
                [Op.or]: [
                    { isPremium: true },
                    { isManualPremium: true }
                ]
            }
        });

        const userLevelList = await UserLevel.findAll({
            where: {
                [Op.or]: [
                    { isPremium: true },
                    { isManualPremium: true }
                ]
            }
        });

        const premiumUserIds = new Set();
        const manualPremiumMap = new Map();
        const autoPremiumMap = new Map();

        usersPrefsList.forEach(up => {
            premiumUserIds.add(up.userId);
            manualPremiumMap.set(up.userId, up.isManualPremium || manualPremiumMap.get(up.userId));
            autoPremiumMap.set(up.userId, up.isPremium || autoPremiumMap.get(up.userId));
        });

        userLevelList.forEach(ul => {
            premiumUserIds.add(ul.userId);
            manualPremiumMap.set(ul.userId, ul.isManualPremium || manualPremiumMap.get(ul.userId));
            autoPremiumMap.set(ul.userId, ul.isPremium || autoPremiumMap.get(ul.userId));
        });

        const usersList = [];
        for (const userId of premiumUserIds) {
            let userObj = req.client.users.cache.get(userId);
            if (!userObj) {
                try {
                    userObj = await req.client.users.fetch(userId);
                } catch (e) {}
            }
            usersList.push({
                userId,
                username: userObj ? userObj.username : 'Unknown User',
                avatar: userObj && userObj.avatar 
                    ? `https://cdn.discordapp.com/avatars/${userId}/${userObj.avatar}.png?size=128` 
                    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(userId) % 5n) + 1n}.png`,
                isManualPremium: !!manualPremiumMap.get(userId),
                isPremium: !!autoPremiumMap.get(userId)
            });
        }

        res.json({
            servers: serversList,
            users: usersList
        });
    } catch (e) {
        console.error('Error fetching admin premium lists:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/premium/grant
router.post('/premium/grant', requireOwner, async (req, res) => {
    const { type, id } = req.body;
    if (!type || !id) {
        return res.status(400).json({ error: 'Missing type or id' });
    }

    try {
        if (type === 'server') {
            const [settings] = await GuildSettings.findOrCreate({ where: { guildId: id } });
            await settings.update({ isPremium: true, isManualPremium: true });

            // Sync automod rules if guild is active
            const { syncAllAutoModRules } = require('../../utils/automodSync');
            const guild = req.client.guilds.cache.get(id);
            if (guild) {
                await syncAllAutoModRules(guild, settings).catch(() => {});
            }
            return res.json({ success: true, message: `Premium manual access successfully granted to server ${id}` });
        } else if (type === 'user') {
            // Update global preferences
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: id } });
            await prefs.update({ isPremium: true, isManualPremium: true });

            // Update all local guild user levels
            await UserLevel.update(
                { isPremium: true, isManualPremium: true },
                { where: { userId: id } }
            );
            return res.json({ success: true, message: `Premium manual access successfully granted to user ${id}` });
        } else {
            return res.status(400).json({ error: 'Invalid type. Must be user or server.' });
        }
    } catch (e) {
        console.error('Error granting premium:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/premium/revoke
router.post('/premium/revoke', requireOwner, async (req, res) => {
    const { type, id } = req.body;
    if (!type || !id) {
        return res.status(400).json({ error: 'Missing type or id' });
    }

    try {
        if (type === 'server') {
            const settings = await GuildSettings.findOne({ where: { guildId: id } });
            if (settings) {
                await settings.update({ isPremium: false, isManualPremium: false });

                // Sync automod rules if guild is active
                const { syncAllAutoModRules } = require('../../utils/automodSync');
                const guild = req.client.guilds.cache.get(id);
                if (guild) {
                    await syncAllAutoModRules(guild, settings).catch(() => {});
                }
            }
            return res.json({ success: true, message: `Premium access successfully revoked from server ${id}` });
        } else if (type === 'user') {
            // Update global preferences
            const prefs = await UserPrefs.findOne({ where: { userId: id } });
            if (prefs) {
                await prefs.update({ isPremium: false, isManualPremium: false });
            }

            // Update all local guild user levels
            await UserLevel.update(
                { isPremium: false, isManualPremium: false },
                { where: { userId: id } }
            );
            return res.json({ success: true, message: `Premium access successfully revoked from user ${id}` });
        } else {
            return res.status(400).json({ error: 'Invalid type. Must be user or server.' });
        }
    } catch (e) {
        console.error('Error revoking premium:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/premium/grant-time
router.post('/premium/grant-time', requireOwner, async (req, res) => {
    const { type, id, durationMs } = req.body;
    if (!type || !id || durationMs === undefined) {
        return res.status(400).json({ error: 'Missing type, id or durationMs' });
    }
    const msToAdd = Number(durationMs);
    if (isNaN(msToAdd) || msToAdd <= 0) {
        return res.status(400).json({ error: 'Invalid durationMs. Must be positive.' });
    }

    try {
        if (type === 'server') {
            const [settings] = await GuildSettings.findOrCreate({ where: { guildId: id } });
            const currentMs = settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0;
            const newMs = currentMs + msToAdd;
            
            const paidTime = settings.paidExpiresAt ? new Date(settings.paidExpiresAt).getTime() : Date.now();
            const newExpires = new Date(paidTime + newMs);
            
            await settings.update({
                expandedTimeMs: newMs,
                premiumExpiresAt: newExpires
            });
            return res.json({ success: true, message: `Successfully added ${msToAdd / 1000}s of expanded time to server ${id}. Total: ${newMs}ms.`, settings });
        } else if (type === 'user') {
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: id } });
            const currentMs = prefs.expandedTimeMs ? Number(prefs.expandedTimeMs) : 0;
            const newMs = currentMs + msToAdd;
            
            const paidTime = prefs.paidExpiresAt ? new Date(prefs.paidExpiresAt).getTime() : Date.now();
            const newExpires = new Date(paidTime + newMs);
            
            await prefs.update({
                expandedTimeMs: newMs,
                premiumExpiresAt: newExpires
            });
            
            await UserLevel.update(
                { isPremium: true },
                { where: { userId: id } }
            );
            return res.json({ success: true, message: `Successfully added ${msToAdd / 1000}s of expanded time to user ${id}. Total: ${newMs}ms.`, prefs });
        } else {
            return res.status(400).json({ error: 'Invalid type. Must be user or server.' });
        }
    } catch (e) {
        console.error('Error adding premium time:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/premium/revoke-time
router.post('/premium/revoke-time', requireOwner, async (req, res) => {
    const { type, id, durationMs } = req.body;
    if (!type || !id || durationMs === undefined) {
        return res.status(400).json({ error: 'Missing type, id or durationMs' });
    }
    const msToRemove = Number(durationMs);
    if (isNaN(msToRemove) || msToRemove <= 0) {
        return res.status(400).json({ error: 'Invalid durationMs. Must be positive.' });
    }

    try {
        if (type === 'server') {
            const settings = await GuildSettings.findOne({ where: { guildId: id } });
            if (!settings) return res.status(404).json({ error: 'Server settings not found.' });

            const currentMs = settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0;
            
            if (msToRemove > currentMs) {
                return res.status(400).json({ error: `CRITICAL CONTROLLER CONSTRAINT: Cannot revoke more than the manually granted expanded time (${currentMs}ms). Paid subscription duration cannot be cut short.` });
            }

            const newMs = currentMs - msToRemove;
            const paidTime = settings.paidExpiresAt ? new Date(settings.paidExpiresAt).getTime() : Date.now();
            const newExpires = new Date(paidTime + newMs);

            await settings.update({
                expandedTimeMs: newMs,
                premiumExpiresAt: newExpires
            });
            return res.json({ success: true, message: `Successfully revoked ${msToRemove / 1000}s of manual time from server ${id}. Remaining: ${newMs}ms.`, settings });
        } else if (type === 'user') {
            const prefs = await UserPrefs.findOne({ where: { userId: id } });
            if (!prefs) return res.status(404).json({ error: 'User preferences not found.' });

            const currentMs = prefs.expandedTimeMs ? Number(prefs.expandedTimeMs) : 0;

            if (msToRemove > currentMs) {
                return res.status(400).json({ error: `CRITICAL CONTROLLER CONSTRAINT: Cannot revoke more than the manually granted expanded time (${currentMs}ms). Paid subscription duration cannot be cut short.` });
            }

            const newMs = currentMs - msToRemove;
            const paidTime = prefs.paidExpiresAt ? new Date(prefs.paidExpiresAt).getTime() : Date.now();
            const newExpires = new Date(paidTime + newMs);

            await prefs.update({
                expandedTimeMs: newMs,
                premiumExpiresAt: newExpires
            });
            return res.json({ success: true, message: `Successfully revoked ${msToRemove / 1000}s of manual time from user ${id}. Remaining: ${newMs}ms.`, prefs });
        } else {
            return res.status(400).json({ error: 'Invalid type. Must be user or server.' });
        }
    } catch (e) {
        console.error('Error revoking premium time:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/oauth-exchange
router.post('/oauth-exchange', async (req, res) => {
    try {
        const { code, redirect_uri } = req.body;
        if (!code || !redirect_uri) {
            return res.status(400).json({ error: 'Missing code or redirect_uri' });
        }

        const client_id = process.env.CLIENT_ID || '1375943730951098549';
        const client_secret = process.env.CLIENT_SECRET;
        if (!client_secret) {
            return res.status(500).json({ error: 'System configuration error: client_secret missing' });
        }

        const params = new URLSearchParams();
        params.append('client_id', client_id);
        params.append('client_secret', client_secret);
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirect_uri);

        const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            console.error('OAuth token exchange error:', errBody);
            return res.status(400).json({ error: 'Discord OAuth token exchange failed' });
        }

        const tokenData = await tokenRes.json();
        res.json({ token: tokenData.access_token });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/terminated
router.get('/terminated', requireOwner, async (req, res) => {
    try {
        const terminatedPrefs = await UserPrefs.findAll({
            where: {
                [Op.or]: [
                    { isTerminated: true },
                    { tempBlacklistExpiresAt: { [Op.gt]: new Date() } }
                ]
            }
        });
        const list = [];
        for (const up of terminatedPrefs) {
            let userObj = req.client.users.cache.get(up.userId);
            if (!userObj) {
                try {
                    userObj = await req.client.users.fetch(up.userId);
                } catch (e) {}
            }
            const isTemp = up.tempBlacklistExpiresAt && new Date(up.tempBlacklistExpiresAt) > new Date();
            list.push({
                userId: up.userId,
                username: userObj ? userObj.username : 'Unknown User',
                avatar: userObj && userObj.avatar 
                    ? `https://cdn.discordapp.com/avatars/${up.userId}/${userObj.avatar}.png?size=128` 
                    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(up.userId) % 5n) + 1n}.png`,
                terminationReason: up.terminationReason || 'No reason specified.',
                isTerminated: !!up.isTerminated,
                isTempBanned: isTemp,
                tempBlacklistExpiresAt: up.tempBlacklistExpiresAt
            });
        }
        res.json({ terminated: list });
    } catch (e) {
        console.error('Error fetching terminated users:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/ip-bans
router.get('/ip-bans', requireOwner, async (req, res) => {
    try {
        const IpBan = require('../../database/models/IpBan');
        const bans = await IpBan.findAll({ order: [['createdAt', 'DESC']] });
        const list = [];
        for (const b of bans) {
            let userObj = null;
            if (b.associatedUserId) {
                userObj = req.client.users.cache.get(b.associatedUserId);
                if (!userObj) {
                    try {
                        userObj = await req.client.users.fetch(b.associatedUserId);
                    } catch (e) {}
                }
            }
            list.push({
                ipAddress: b.ipAddress,
                associatedUserId: b.associatedUserId,
                reason: b.reason,
                createdAt: b.createdAt,
                user: userObj ? {
                    username: userObj.username,
                    avatar: userObj.avatar 
                        ? `https://cdn.discordapp.com/avatars/${b.associatedUserId}/${userObj.avatar}.png?size=128` 
                        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(b.associatedUserId) % 5n) + 1n}.png`
                } : null
            });
        }
        res.json({ ipBans: list });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/ip-bans/revoke
router.post('/ip-bans/revoke', requireOwner, async (req, res) => {
    try {
        const { ipAddress } = req.body;
        if (!ipAddress) return res.status(400).json({ error: 'Missing ipAddress' });
        const IpBan = require('../../database/models/IpBan');
        await IpBan.destroy({ where: { ipAddress } });
        res.json({ success: true, message: `IP ban revoked for ${ipAddress}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/global-ban
router.post('/global-ban', requireOwner, async (req, res) => {
    try {
        const { action, userId, reason, tempDurationHours } = req.body;
        if (!userId || !action) {
            return res.status(400).json({ error: 'Missing userId or action' });
        }

        const [prefs] = await UserPrefs.findOrCreate({ where: { userId } });
        const IpBan = require('../../database/models/IpBan');
        const Session = require('../../database/models/Session');

        if (action === 'ban') {
            const banReason = reason || 'Violation of terms of service.';
            let tempExpires = null;
            if (tempDurationHours && !isNaN(tempDurationHours)) {
                tempExpires = new Date(Date.now() + Number(tempDurationHours) * 60 * 60 * 1000);
            }

            await prefs.update({ 
                isTerminated: tempExpires ? false : true,
                tempBlacklistExpiresAt: tempExpires,
                terminationReason: banReason, 
                profilePublic: false, 
                robloxPublic: false 
            });

            // Harvest IPs from user's active/past sessions
            const userSessions = await Session.findAll({ where: { userId } });
            const ips = [...new Set(userSessions.map(s => s.ipAddress).filter(Boolean))];
            
            for (const ip of ips) {
                if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') continue;
                await IpBan.findOrCreate({
                    where: { ipAddress: ip },
                    defaults: {
                        associatedUserId: userId,
                        reason: `Associated with banned user ${userId}: ${banReason}`
                    }
                });
            }

            // Revoke current session
            await Session.destroy({ where: { userId } });

            console.log(`[GLOBAL MITIGATION] Suspended user ${userId} (Temp: ${!!tempExpires}) for: ${banReason}`);
            return res.json({ success: true, message: `Successfully suspended user ${userId}` });
        } else if (action === 'unban') {
            await prefs.update({
                isTerminated: false,
                tempBlacklistExpiresAt: null,
                terminationReason: null
            });

            // Automatically clean up associated IP bans
            await IpBan.destroy({ where: { associatedUserId: userId } });

            console.log(`[GLOBAL MITIGATION] Restored user ${userId}`);
            return res.json({ success: true, message: `Successfully removed user ${userId} from suspension` });
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/all-servers
router.get('/all-servers', requireOwner, async (req, res) => {
    try {
        const premiumGuilds = await GuildSettings.findAll({
            where: {
                [Op.or]: [
                    { isPremium: true },
                    { isManualPremium: true },
                    { paidExpiresAt: { [Op.ne]: null } }
                ]
            },
            attributes: ['guildId', 'isPremium', 'isManualPremium', 'paidExpiresAt']
        });
        const premiumMap = new Map(premiumGuilds.map(g => [g.guildId, g]));

        const guilds = Array.from(req.client.guilds.cache.values());
        const list = guilds.map(g => {
            const gs = premiumMap.get(g.id);
            return {
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                memberCount: g.memberCount,
                joinedAt: g.joinedAt,
                ownerId: g.ownerId,
                isPremium: gs ? !!gs.isPremium : false,
                isManualPremium: gs ? !!gs.isManualPremium : false,
                paidExpiresAt: gs ? gs.paidExpiresAt : null
            };
        });

        const sort = req.query.sort || 'newest';
        if (sort === 'newest') {
            list.sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt));
        } else if (sort === 'oldest') {
            list.sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
        } else if (sort === 'members_desc') {
            list.sort((a, b) => b.memberCount - a.memberCount);
        } else if (sort === 'members_asc') {
            list.sort((a, b) => a.memberCount - b.memberCount);
        } else if (sort === 'alphabetical') {
            list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }

        res.json({ guilds: list });
    } catch (e) {
        console.error('Error fetching all servers:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/all-users
router.get('/all-users', requireOwner, async (req, res) => {
    try {
        const allPrefs = await UserPrefs.findAll();

        const list = await Promise.all(allPrefs.map(async prefs => {
            let userObj = req.client.users.cache.get(prefs.userId);
            if (!userObj) {
                try {
                    userObj = await req.client.users.fetch(prefs.userId);
                } catch (e) {}
            }
            return {
                userId: prefs.userId,
                username: userObj ? userObj.username : `ID: ${prefs.userId}`,
                displayName: prefs.displayName || (userObj ? (userObj.globalName || userObj.username) : `ID: ${prefs.userId}`),
                avatar: userObj ? userObj.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png',
                authedAt: prefs.createdAt,
                language: prefs.language,
                bio: prefs.bio || '',
                isPremium: !!prefs.isPremium,
                isManualPremium: !!prefs.isManualPremium,
                paidExpiresAt: prefs.paidExpiresAt
            };
        }));

        const sort = req.query.sort || 'newest';
        if (sort === 'newest') {
            list.sort((a, b) => new Date(b.authedAt) - new Date(a.authedAt));
        } else if (sort === 'oldest') {
            list.sort((a, b) => new Date(a.authedAt) - new Date(b.authedAt));
        } else if (sort === 'alphabetical_username') {
            list.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
        } else if (sort === 'alphabetical_display') {
            list.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
        }

        res.json({ users: list });
    } catch (e) {
        console.error('Error fetching all users:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/leave-server
router.post('/leave-server', requireOwner, async (req, res) => {
    try {
        const { guildId, reason } = req.body;
        if (!guildId) {
            return res.status(400).json({ error: 'Missing guildId' });
        }
        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: 'A valid revocation reason is required.' });
        }

        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Server not found or bot not in server' });
        }

        const cleanReason = reason.trim();
        const guildName = guild.name;
        const ownerId = guild.ownerId;

        // Attempt to DM the server owner before leaving
        let dmDelivered = false;
        try {
            const ownerUser = await req.client.users.fetch(ownerId).catch(() => null);
            if (ownerUser) {
                const { EmbedBuilder } = require('discord.js');
                const dmEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Notice: Nora Revoked from Server')
                    .setColor(0xED4245)
                    .setDescription(
                        `Hello <@${ownerId}>,\n\n` +
                        `Nora has been **revoked and removed** from your server **${guildName}** by the bot administrators.\n\n` +
                        `**Revocation Reason:**\n>>> ${cleanReason}\n\n` +
                        `If you believe this administrative action was taken in error, please reach out to the bot management team.`
                    )
                    .addFields(
                        { name: '🏰 Server', value: `${guildName} (\`${guildId}\`)`, inline: true },
                        { name: '🛑 Action', value: 'Administrative Revocation', inline: true },
                        { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                    )
                    .setFooter({ text: 'Nora Platform Administration & Server Management' })
                    .setTimestamp();

                await ownerUser.send({ embeds: [dmEmbed] });
                dmDelivered = true;
            }
        } catch (dmErr) {
            console.warn(`[LeaveServer] Could not DM server owner ${ownerId}:`, dmErr.message);
        }

        // Leave the guild
        await guild.leave();
        console.log(`[Developer Panel] Bot left guild ${guildName} (${guildId}). Reason: ${cleanReason}`);

        // Write a persistent notification to the server owner
        const Notification = require('../../database/models/Notification');
        await Notification.create({
            userId: ownerId,
            title: `Nora Bot Deactivated from ${guildName}`,
            content: `Nora Bot has been removed from your server "${guildName}" by the Bot Owner.\n\nReason: "${cleanReason}"`,
            type: 'special',
            isSpecial: true,
            isOwnerAction: true,
            serverName: guildName
        }).catch(() => {});

        res.json({ 
            success: true, 
            message: `Successfully removed bot from ${guildName}.${dmDelivered ? ' Server owner notified via DM.' : ' (Owner DMs closed)'}` 
        });
    } catch (e) {
        console.error('Error leaving server:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/perm-revoke-server
router.post('/perm-revoke-server', requireOwner, async (req, res) => {
    try {
        const { guildId, reason } = req.body;
        if (!guildId) {
            return res.status(400).json({ error: 'Missing guildId' });
        }
        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: 'A valid reason is required for permanent revocation.' });
        }

        const cleanReason = reason.trim();
        const guild = req.client.guilds.cache.get(guildId);
        const guildName = guild ? guild.name : (req.body.guildName || `Server (${guildId})`);
        const ownerId = guild ? guild.ownerId : req.body.ownerId;

        // 1. Attempt to DM the server owner before leaving
        let dmDelivered = false;
        if (ownerId) {
            try {
                const ownerUser = await req.client.users.fetch(ownerId).catch(() => null);
                if (ownerUser) {
                    const { EmbedBuilder } = require('discord.js');
                    const exileEmbed = new EmbedBuilder()
                        .setTitle('🚫 Notice: Server Permanently Revoked & Blacklisted')
                        .setColor(0xED4245)
                        .setDescription(
                            `Hello <@${ownerId}>,\n\n` +
                            `Your server **${guildName}** has been **permanently revoked and blacklisted** from using Nora by the bot administrators.\n\n` +
                            `**Reason for Permanent Revocation:**\n>>> ${cleanReason}\n\n` +
                            `Nora has departed from your server immediately. If Nora is re-invited in the future, she will automatically sever connection upon arrival.`
                        )
                        .addFields(
                            { name: '🏰 Server', value: `${guildName} (\`${guildId}\`)`, inline: true },
                            { name: '🛑 Status', value: 'Permanently Blacklisted', inline: true },
                            { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                        )
                        .setFooter({ text: 'Nora Platform Security & Blacklist Enforcement' })
                        .setTimestamp();

                    await ownerUser.send({ embeds: [exileEmbed] });
                    dmDelivered = true;
                }
            } catch (dmErr) {
                console.warn(`[PermRevoke] Could not DM owner ${ownerId}:`, dmErr.message);
            }
        }

        // 2. Add / Update ServerBlacklist record
        const ServerBlacklist = require('../../database/models/ServerBlacklist');
        await ServerBlacklist.upsert({
            guildId,
            guildName,
            ownerId: ownerId || null,
            reason: cleanReason,
            revokedBy: req.user?.username || 'Owner',
            revokedAt: new Date(),
            isActive: true
        });

        // 3. Update GlobalSettings bannedGuildIds
        const GlobalSettings = require('../../database/models/GlobalSettings');
        let global;
        try {
            const [result] = await GlobalSettings.findOrCreate({ where: { id: 1 } });
            global = result;
        } catch (e) {
            global = await GlobalSettings.findOne({ where: { id: 1 } });
        }
        const bannedIds = new Set(JSON.parse(global?.bannedGuildIds || '[]'));
        bannedIds.add(guildId);
        await global.update({ bannedGuildIds: JSON.stringify(Array.from(bannedIds)) });

        // 4. Leave guild if bot is currently in it
        if (guild) {
            try {
                await guild.leave();
                console.log(`[Developer Panel] Bot permanently revoked and left guild ${guildName} (${guildId}).`);
            } catch (leaveErr) {
                console.warn(`[PermRevoke] Guild leave error:`, leaveErr.message);
            }
        }

        // 5. Write notification
        if (ownerId) {
            const Notification = require('../../database/models/Notification');
            await Notification.create({
                userId: ownerId,
                title: `Server Permanently Revoked: ${guildName}`,
                content: `Your server "${guildName}" has been permanently revoked and blacklisted by the Bot Owner.\n\nReason: "${cleanReason}"`,
                type: 'special',
                isSpecial: true,
                isOwnerAction: true,
                serverName: guildName
            }).catch(() => {});
        }

        res.json({
            success: true,
            message: `Server "${guildName}" has been permanently revoked and blacklisted.${dmDelivered ? ' Owner notified via DM.' : ''}`
        });
    } catch (e) {
        console.error('Error permanently revoking server:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/blacklisted-servers
router.get('/blacklisted-servers', requireOwner, async (req, res) => {
    try {
        const ServerBlacklist = require('../../database/models/ServerBlacklist');
        const list = await ServerBlacklist.findAll({
            where: { isActive: true },
            order: [['revokedAt', 'DESC']]
        });
        res.json({ blacklisted: list });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/un-perm-revoke-server
router.post('/un-perm-revoke-server', requireOwner, async (req, res) => {
    try {
        const { guildId } = req.body;
        if (!guildId) return res.status(400).json({ error: 'Missing guildId' });

        const ServerBlacklist = require('../../database/models/ServerBlacklist');
        await ServerBlacklist.destroy({ where: { guildId } });

        const GlobalSettings = require('../../database/models/GlobalSettings');
        const global = await GlobalSettings.findOne({ where: { id: 1 } });
        if (global) {
            const bannedIds = JSON.parse(global.bannedGuildIds || '[]').filter(id => id !== guildId);
            await global.update({ bannedGuildIds: JSON.stringify(bannedIds) });
        }

        res.json({ success: true, message: `Server ${guildId} removed from permanent blacklist.` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 🧠 GEMINI AI ENGINE CONTROL & TELEMETRY
// ==========================================

// GET /api/admin/ai-stats
router.get('/ai-stats', requireOwner, async (req, res) => {
    try {
        const geminiKeyManager = require('../../utils/geminiKeyManager');
        const stats = geminiKeyManager.getQuotaStats();
        res.json({ success: true, stats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/ai-reset-cooldowns
router.post('/ai-reset-cooldowns', requireOwner, async (req, res) => {
    try {
        const geminiKeyManager = require('../../utils/geminiKeyManager');
        geminiKeyManager.cooldowns.clear();
        geminiKeyManager.strikes.clear();
        geminiKeyManager.isDailyQuota.clear();
        console.log(`[Admin Desk] Bot Owner reset all Gemini Key cooldowns and strikes.`);
        res.json({ success: true, message: 'All Gemini API key cooldowns and quota strikes cleared successfully.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/ai-test-ping
router.post('/ai-test-ping', requireOwner, async (req, res) => {
    try {
        const geminiKeyManager = require('../../utils/geminiKeyManager');
        const available = geminiKeyManager.getAvailableKeys();
        if (available.length === 0) {
            return res.status(503).json({ error: 'All Gemini API keys are currently cooling down.' });
        }
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const startTime = Date.now();

        const candidateModels = [
            'gemini-flash-lite-latest',
            'gemini-3.5-flash',
            'gemini-flash-latest',
            'gemini-3.8-flash'
        ];

        let lastErr = null;
        for (const apiKey of available) {
            const genAI = new GoogleGenerativeAI(apiKey);
            for (const modelName of candidateModels) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent('Return exactly the word "OPERATIONAL" and nothing else.');
                    const latencyMs = Date.now() - startTime;
                    const text = result.response.text();
                    geminiKeyManager.reportSuccess(apiKey, text);
                    return res.json({ 
                        success: true, 
                        latencyMs, 
                        model: modelName,
                        response: text.trim() 
                    });
                } catch (mErr) {
                    lastErr = mErr;
                }
            }
        }

        res.status(500).json({ error: lastErr ? lastErr.message : 'All model candidates failed.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 🚨 STATUS FLAGS & INCIDENT DESK (vaztinix.dev/status)
// ==========================================

// GET /api/admin/status-flags
router.get('/status-flags', requireOwner, async (req, res) => {
    try {
        const StatusFlag = require('../../database/models/StatusFlag');
        const flags = await StatusFlag.findAll({
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        res.json({ success: true, flags });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/status-flags
router.post('/status-flags', requireOwner, async (req, res) => {
    try {
        const { title, message, severity, shardId } = req.body;
        if (!title || !message) {
            return res.status(400).json({ error: 'Title and message are required.' });
        }
        const StatusFlag = require('../../database/models/StatusFlag');
        const flag = await StatusFlag.create({
            title: title.trim(),
            message: message.trim(),
            severity: severity || 'info',
            shardId: shardId !== undefined && shardId !== '' ? parseInt(shardId, 10) : 0,
            author: req.user?.username || 'Owner',
            isResolved: false
        });
        res.json({ success: true, flag, message: `Status flag #${flag.id} published to vaztinix.dev/status` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/status-flags/:id/resolve
router.post('/status-flags/:id/resolve', requireOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const { resolutionNote } = req.body;
        const StatusFlag = require('../../database/models/StatusFlag');
        const flag = await StatusFlag.findByPk(id);
        if (!flag) return res.status(404).json({ error: 'Status flag not found' });

        await flag.update({
            isResolved: true,
            resolutionNote: resolutionNote || 'Operational status fully restored.',
            resolvedAt: new Date()
        });

        res.json({ success: true, flag, message: `Status flag #${id} resolved.` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/admin/status-flags/:id
router.delete('/status-flags/:id', requireOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const StatusFlag = require('../../database/models/StatusFlag');
        await StatusFlag.destroy({ where: { id } });
        res.json({ success: true, message: `Status flag #${id} deleted.` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 📢 SITE ALERTS & BROADCAST NOTIFICATIONS
// ==========================================

// GET /api/admin/site-alerts
router.get('/site-alerts', requireOwner, async (req, res) => {
    try {
        const SiteAlert = require('../../database/models/SiteAlert');
        const alerts = await SiteAlert.findAll({ order: [['id', 'DESC']], limit: 30 });
        res.json({ alerts });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/site-alert
router.post('/site-alert', requireOwner, async (req, res) => {
    try {
        const { title, message, type, isActive } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Missing alert message' });
        }
        const SiteAlert = require('../../database/models/SiteAlert');
        const alert = await SiteAlert.create({
            title: title || '📢 Nora Announcement',
            message,
            type: type || 'announcement',
            authorId: req.user.id,
            isActive: isActive !== undefined ? !!isActive : true
        });
        res.json({ success: true, alert });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/admin/site-alert/:id
router.delete('/site-alert/:id', requireOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const SiteAlert = require('../../database/models/SiteAlert');
        await SiteAlert.destroy({ where: { id } });
        res.json({ success: true, message: `Alert #${id} deleted.` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/broadcast-notification
router.post('/broadcast-notification', requireOwner, async (req, res) => {
    try {
        const { title, content, type, targetUserId } = req.body;
        if (!title || !content) {
            return res.status(400).json({ error: 'Missing notification title or content' });
        }
        const Notification = require('../../database/models/Notification');

        if (targetUserId) {
            await Notification.create({
                userId: targetUserId,
                title,
                content,
                type: type || 'special',
                isSpecial: true,
                isOwnerAction: true
            });
            return res.json({ success: true, message: `Notification sent to user ${targetUserId}` });
        }

        // Broadcast to all authenticated users in UserPrefs
        const allUsers = await UserPrefs.findAll({ attributes: ['userId'] });
        const records = allUsers.map(u => ({
            userId: u.userId,
            title,
            content,
            type: type || 'special',
            isSpecial: true,
            isOwnerAction: true
        }));

        if (records.length > 0) {
            await Notification.bulkCreate(records);
        }

        res.json({ success: true, count: records.length, message: `Broadcast sent to ${records.length} user dashboard inboxes.` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 💎 ENTITLEMENT BINDINGS INSPECTOR
// ==========================================

// GET /api/admin/entitlement-bindings
router.get('/entitlement-bindings', requireOwner, async (req, res) => {
    try {
        const boundPrefs = await UserPrefs.findAll({
            where: {
                boundGuildId: { [Op.ne]: null }
            }
        });

        const list = await Promise.all(boundPrefs.map(async p => {
            let userObj = req.client.users.cache.get(p.userId);
            if (!userObj) {
                try { userObj = await req.client.users.fetch(p.userId); } catch (e) {}
            }
            const guildObj = req.client.guilds.cache.get(p.boundGuildId);
            return {
                userId: p.userId,
                username: userObj ? userObj.username : `ID: ${p.userId}`,
                avatar: userObj ? userObj.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png',
                boundGuildId: p.boundGuildId,
                boundGuildName: guildObj ? guildObj.name : (p.boundGuildName || 'Unknown Guild'),
                guildIcon: guildObj && guildObj.icon ? `https://cdn.discordapp.com/icons/${guildObj.id}/${guildObj.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                isPremium: !!p.isPremium,
                isManualPremium: !!p.isManualPremium,
                paidExpiresAt: p.paidExpiresAt
            };
        }));

        res.json({ bindings: list });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/entitlement-unbind
router.post('/entitlement-unbind', requireOwner, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const prefs = await UserPrefs.findOne({ where: { userId } });
        if (prefs && prefs.boundGuildId) {
            const oldGuild = prefs.boundGuildId;
            prefs.boundGuildId = null;
            prefs.boundGuildName = null;
            await prefs.save();

            const settingsCache = require('../../utils/settingsCache');
            settingsCache.invalidate(oldGuild);
        }

        res.json({ success: true, message: `Successfully released bound premium slot for user ${userId}.` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ⚙️ SYSTEM CORE MAINTENANCE & TELEMETRY
// ==========================================

// POST /api/admin/telemetry-sync
router.post('/telemetry-sync', requireOwner, async (req, res) => {
    try {
        const { updateTelemetrySnapshot } = require('../../utils/telemetrySnapshot');
        const snapshot = updateTelemetrySnapshot(req.client);
        res.json({ success: true, snapshot, message: 'Static telemetry snapshot generated and synchronized.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/clear-cache
router.post('/clear-cache', requireOwner, async (req, res) => {
    try {
        const settingsCache = require('../../utils/settingsCache');
        if (settingsCache && settingsCache.cache) {
            settingsCache.cache.clear();
        }
        res.json({ success: true, message: 'Settings cache cleared across all nodes.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
