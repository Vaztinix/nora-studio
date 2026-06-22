const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const GuildSettings = require('../../database/models/GuildSettings');
const UserLevel = require('../../database/models/UserLevel');
const UserPrefs = require('../../database/models/UserPrefs');

// Owner-only authentication middleware using native fetch
const requireOwner = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    try {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: authHeader }
        });
        if (!response.ok) {
            return res.status(401).json({ error: 'Unauthorized: Invalid Discord token' });
        }
        const user = await response.json();

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
        return res.status(500).json({ error: 'Internal server error verifying authorization' });
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
            where: { isTerminated: true }
        });
        const list = [];
        for (const up of terminatedPrefs) {
            let userObj = req.client.users.cache.get(up.userId);
            if (!userObj) {
                try {
                    userObj = await req.client.users.fetch(up.userId);
                } catch (e) {}
            }
            list.push({
                userId: up.userId,
                username: userObj ? userObj.username : 'Unknown User',
                avatar: userObj && userObj.avatar 
                    ? `https://cdn.discordapp.com/avatars/${up.userId}/${userObj.avatar}.png?size=128` 
                    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(up.userId) % 5n) + 1n}.png`,
                terminationReason: up.terminationReason || 'No reason specified.'
            });
        }
        res.json({ terminated: list });
    } catch (e) {
        console.error('Error fetching terminated users:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/global-ban
router.post('/global-ban', requireOwner, async (req, res) => {
    try {
        const { action, userId, reason } = req.body;
        if (!userId || !action) {
            return res.status(400).json({ error: 'Missing userId or action' });
        }

        const [prefs] = await UserPrefs.findOrCreate({ where: { userId } });

        if (action === 'ban') {
            const banReason = reason || 'Violation of terms of service.';
            await prefs.update({ 
                isTerminated: true, 
                terminationReason: banReason, 
                profilePublic: false, 
                robloxPublic: false 
            }); // Disable visibility and block logins
            console.log(`[GLOBAL MITIGATION] Suspended user ${userId} for: ${banReason}`);
            return res.json({ success: true, message: `Successfully suspended user ${userId}` });
        } else if (action === 'unban') {
            await prefs.update({
                isTerminated: false,
                terminationReason: null
            });
            console.log(`[GLOBAL MITIGATION] Restored user ${userId}`);
            return res.json({ success: true, message: `Successfully removed user ${userId} from suspension` });
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
