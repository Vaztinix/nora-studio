const express = require('express');
const router = express.Router({ mergeParams: true });
const GuildSettings = require('../../database/models/GuildSettings');
const { requireGuildPermission, getDiscordUser } = require('../middleware/auth');
const settingsCache = require('../../utils/settingsCache');

// Rate limiting store for settings endpoints
const settingsRequests = new Map();
const settingsRateLimiter = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'global';
    const now = Date.now();
    const timestamps = (settingsRequests.get(ip) || []).filter(ts => now - ts < 10000);
    if (timestamps.length >= 60) {
        return res.status(429).json({ error: 'Too many requests to settings endpoints.' });
    }
    timestamps.push(now);
    settingsRequests.set(ip, timestamps);
    next();
};

router.use(settingsRateLimiter);
// Apply permission checking middleware to all routes in this router
router.use(requireGuildPermission);

/**
 * GET /api/guilds/:guildId/settings
 * Retrieve the current GuildSettings for the specified server.
 */
router.get('/', settingsRateLimiter, async (req, res) => {
    try {
        const { guildId } = req.params;
        let settings = await settingsCache.get(guildId);
        
        if (!settings) {
            // If settings don't exist yet, return a clean initialization object
            // or create it so the frontend has something to display.
            [settings] = await GuildSettings.findOrCreate({ where: { guildId } });
        }

        // Retrieve the Discord WebSocket client heartbeat (ping)
        const heartbeat = (req.client && req.client.ws && typeof req.client.ws.ping === 'number') 
            ? Math.max(0, Math.round(req.client.ws.ping)) 
            : 15; // default fallback if ws is offline/not connected yet

        // Calculate Premium status for the guild
        let isPremium = !!settings.isPremium || !!settings.isManualPremium;
        const guild = (req.client && req.client.guilds && req.client.guilds.cache) 
            ? req.client.guilds.cache.get(guildId) 
            : null;
        if (guild && (guild.ownerId === '1214048435632603137' || guild.ownerId === '1366229304257544213')) {
            isPremium = true;
        }
        const paidTime = settings.paidExpiresAt ? new Date(settings.paidExpiresAt).getTime() : 0;
        const expandedMs = settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0;
        if (paidTime + expandedMs > Date.now()) {
            isPremium = true;
        }

        const settingsData = typeof settings.toJSON === 'function' 
            ? settings.toJSON() 
            : (settings.dataValues || settings);

        res.json({
            ...settingsData,
            isPremium,
            heartbeat,
            dbSync: 1
        });
    } catch (error) {
        console.error('Error fetching settings for guild %s:', req.params.guildId, error);
        res.status(500).json({ error: 'Internal server error while fetching settings.', details: error.message });
    }
});

/**
 * POST /api/guilds/:guildId/settings
 * Update the GuildSettings for the specified server.
 */
router.post('/', settingsRateLimiter, async (req, res) => {
    try {
        const { guildId } = req.params;
        const payload = req.body;

        // Verify Top.gg keys ownership
        const topggFields = [
            'topggBotId', 'topggLegacyOwnerId', 'topggWebhookAuth', 'topggVoteChannelId', 
            'topggVoteMessage', 'topggVoteContent', 'topggVoteEmbedImage', 'topggVoteEmbedColor', 
            'topggRewardRoleId', 'topggVerified', 'topggXpBoost', 'topggDoubleXp', 
            'topggReminders', 'topggWebhookName', 'topggWebhookAvatar'
        ];
        const containsTopggFields = Object.keys(payload).some(key => topggFields.includes(key));
        if (containsTopggFields) {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
            const token = authHeader.split(' ')[1];
            
            const user = await getDiscordUser(token).catch(() => null);
            if (!user) return res.status(401).json({ error: 'Invalid Discord token' });
            
            const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];
            let isOwner = APP_OWNER_IDS.includes(user.id);
            if (!isOwner) {
                try {
                    const app = await req.client.application.fetch();
                    if (app.owner) {
                        if (app.owner.id === user.id || (app.owner.members && app.owner.members.has(user.id))) {
                            isOwner = true;
                        }
                    }
                } catch (e) {}
            }
            if (!isOwner) {
                return res.status(403).json({ error: 'Forbidden: Only the bot owner can configure Top.gg settings.' });
            }
        }

        // Prevent updating the guildId itself
        if (payload.guildId) {
            delete payload.guildId;
        }

        // Clean payload: convert empty strings to null for nullable database fields
        for (const key of Object.keys(payload)) {
            if (payload[key] === '') {
                payload[key] = null;
            }
        }

        // Find or create settings
        let [settings] = await GuildSettings.findOrCreate({ where: { guildId } });

        // Calculate Premium status
        let isPremium = !!settings.isPremium || !!settings.isManualPremium;
        const guild = req.client.guilds.cache.get(guildId);
        if (guild && (guild.ownerId === '1214048435632603137' || guild.ownerId === '1366229304257544213')) {
            isPremium = true;
        }
        const paidTime = settings.paidExpiresAt ? new Date(settings.paidExpiresAt).getTime() : 0;
        const expandedMs = settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0;
        if (paidTime + expandedMs > Date.now()) {
            isPremium = true;
        }

        // Validate payload constraints
        if (payload.roleRewards) {
            try {
                const rewards = JSON.parse(payload.roleRewards);
                const count = Object.keys(rewards).length;
                const cap = isPremium ? 25 : 5;
                if (count > cap) {
                    return res.status(400).json({ error: `Premium Limit: Free servers are capped at 5 role rewards, while Premium servers get up to 25. Your count: ${count}` });
                }
            } catch (err) {
                return res.status(400).json({ error: 'Invalid JSON format for roleRewards.' });
            }
        }

        if (payload.spamInterval !== undefined && parseInt(payload.spamInterval, 10) !== 5000) {
            if (!isPremium) {
                return res.status(400).json({ error: 'Premium Limit: Custom anti-spam time windows require Nora Premium.' });
            }
        }

        if (payload.customModResponses && payload.customModResponses !== '{}') {
            if (!isPremium) {
                return res.status(400).json({ error: 'Premium Limit: Custom moderation command responses require Nora Premium.' });
            }
        }

        // Validate auto-role on join (welcomeRoleId) limits
        if (payload.welcomeRoleId) {
            const roleCount = payload.welcomeRoleId.split(',').map(r => r.trim()).filter(Boolean).length;
            const maxRoles = isPremium ? 5 : 3;
            if (roleCount > maxRoles) {
                return res.status(400).json({ error: `Auto-Role Limit Exceeded: Free servers can configure up to 3 auto-roles upon join. Nora Plus unlocks up to 5 roles. You selected ${roleCount}.` });
            }
        }

        // Validate verification role (verifyRoleId) limits
        if (payload.verifyRoleId) {
            const roleCount = payload.verifyRoleId.split(',').map(r => r.trim()).filter(Boolean).length;
            const maxRoles = isPremium ? 5 : 3;
            if (roleCount > maxRoles) {
                return res.status(400).json({ error: `Verification Role Limit Exceeded: Free servers can configure up to 3 verified roles. Nora Plus unlocks up to 5 roles. You selected ${roleCount}.` });
            }
        }

        // Decode topggWebhookAvatar base64 image if present
        if (payload.topggWebhookAvatar) {
            const { saveBase64Image } = require('../../utils/imageSaver');
            payload.topggWebhookAvatar = saveBase64Image(payload.topggWebhookAvatar, 'topgg_avatar');
        }

        // Decode starboardWebhookAvatar base64 image if present
        if (payload.starboardWebhookAvatar && payload.starboardWebhookAvatar.startsWith('data:image/')) {
            const { saveBase64Image } = require('../../utils/imageSaver');
            payload.starboardWebhookAvatar = saveBase64Image(payload.starboardWebhookAvatar, 'starboard_avatar');
        }



        // Update the settings model with the payload provided by the dashboard
        await settings.update(payload);
        settingsCache.invalidate(guildId);

        // Sync Top.gg Webhook Auth Token to TopggConnection if updated
        if (payload.topggWebhookAuth !== undefined) {
            const TopggConnection = require('../../database/models/TopggConnection');
            const targetId = payload.topggBotId !== undefined ? payload.topggBotId : settings.topggBotId;
            
            if (targetId) {
                // Try updating the bot connection
                const botConn = await TopggConnection.findOne({
                    where: { guildId, targetId, type: 'bot' }
                });
                if (botConn) {
                    await botConn.update({ token: payload.topggWebhookAuth });
                    console.log(`[Top.gg Sync] Updated webhook auth token for bot connection ${botConn.id}`);
                }
            }
            
            // Also try updating the server connection if no bot connection was found/updated, or if targetId is the guildId
            if (!targetId || targetId === guildId) {
                const serverConn = await TopggConnection.findOne({
                    where: { guildId, targetId: guildId, type: 'server' }
                });
                if (serverConn) {
                    await serverConn.update({ token: payload.topggWebhookAuth });
                    console.log(`[Top.gg Sync] Updated webhook auth token for server connection ${serverConn.id}`);
                }
            }
        }

        // Trigger live Discord integration: sync AutoMod rules live on settings change
        const { syncAllAutoModRules } = require('../../utils/automodSync');
        if (guild) {
            await syncAllAutoModRules(guild, settings).catch(err => {
                console.error('AutoMod Sync failed for guild %s on settings update:', guildId, err);
            });
        }

        if (guild) {
            const authHeader = req.headers.authorization;
            const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
            const user = token ? await getDiscordUser(token).catch(() => null) : null;
            const logger = require('../../utils/logger');
            const changedKeys = Object.keys(payload);
            const userTag = user ? `${user.username} (${user.id})` : 'Dashboard Administrator';
            let keysSummary = changedKeys.length > 0 ? changedKeys.join(', ') : 'None';
            if (keysSummary.length > 950) {
                keysSummary = keysSummary.substring(0, 940) + `... (+${changedKeys.length} keys)`;
            }
            logger.logDashboardOrCommandAction(
                guild,
                'Dashboard Settings Updated',
                [
                    { name: 'Administrator', value: userTag, inline: true },
                    { name: 'Updated Config Keys', value: changedKeys.length > 0 ? `\`${keysSummary}\`` : '*None*' }
                ],
                0x2ed573
            ).catch(() => null);
        }

        // Record per-server action log for Nora's site accountability
        const changedKeys = Object.keys(payload);
        const detailsSummary = changedKeys.length > 0 
            ? `Updated ${changedKeys.length} configuration fields`
            : 'Saved server settings';
        await logServerAction({
            guildId,
            req,
            action: 'UPDATE_SETTINGS',
            details: detailsSummary
        });

        res.json({ success: true, settings });
    } catch (error) {
        console.error('Error updating settings for guild %s:', req.params.guildId, error);
        res.status(500).json({ error: 'Internal server error while updating settings.' });
    }
});

/**
 * DELETE /api/guilds/:guildId/settings
 * Performs a cascading reset / data erasure for the guild.
 */
router.delete('/', settingsRateLimiter, async (req, res) => {
    try {
        const { guildId } = req.params;
        const { performCascadingErasure } = require('../../utils/erasure');
        
        await performCascadingErasure(guildId);
        
        // Invalidate the settings cache as well
        settingsCache.invalidate(guildId);

        // Record per-server action log for Nora's site accountability
        const { logServerAction } = require('../../utils/actionLogger');
        await logServerAction({
            guildId,
            req,
            action: 'RESET_SETTINGS',
            details: 'Performed a complete server configuration reset and data erasure.'
        });
        
        res.json({ success: true, message: 'Cascading settings reset successfully performed.' });
    } catch (error) {
        console.error('Error deleting settings for guild %s:', req.params.guildId, error);
        res.status(500).json({ error: 'Internal server error during settings reset.' });
    }
});

module.exports = router;
