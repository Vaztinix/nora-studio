const express = require('express');
const router = express.Router({ mergeParams: true });
const GuildSettings = require('../../database/models/GuildSettings');
const { requireGuildPermission, getDiscordUser } = require('../middleware/auth');
const settingsCache = require('../../utils/settingsCache');

// Apply permission checking middleware to all routes in this router
router.use(requireGuildPermission);

/**
 * GET /api/guilds/:guildId/settings
 * Retrieve the current GuildSettings for the specified server.
 */
router.get('/', async (req, res) => {
    try {
        const { guildId } = req.params;
        let settings = await GuildSettings.findOne({ where: { guildId } });
        
        if (!settings) {
            // If settings don't exist yet, return a clean initialization object
            // or create it so the frontend has something to display.
            [settings] = await GuildSettings.findOrCreate({ where: { guildId } });
        }

        // Measure database query roundtrip time (latency to SQLite)
        const dbStart = Date.now();
        await GuildSettings.sequelize.authenticate();
        const dbSync = Date.now() - dbStart;

        // Retrieve the Discord WebSocket client heartbeat (ping)
        const heartbeat = (req.client && typeof req.client.ws.ping === 'number') 
            ? Math.max(0, Math.round(req.client.ws.ping)) 
            : 15; // default fallback if ws is offline/not connected yet

        res.json({
            ...settings.toJSON(),
            heartbeat,
            dbSync
        });
    } catch (error) {
        console.error(`Error fetching settings for guild ${req.params.guildId}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching settings.' });
    }
});

/**
 * POST /api/guilds/:guildId/settings
 * Update the GuildSettings for the specified server.
 */
router.post('/', async (req, res) => {
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
                const cap = isPremium ? 15 : 10;
                if (count > cap) {
                    return res.status(400).json({ error: `Premium Limit: Free servers are capped at 10 role rewards, while Premium servers get up to 15. Your count: ${count}` });
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

        // Force levelUpDmEnabled to false/disabled until a robust opt-out mechanism is implemented
        payload.levelUpDmEnabled = false;

        // Update the settings model with the payload provided by the dashboard
        await settings.update(payload);
        settingsCache.invalidate(guildId);

        // Trigger live Discord integration: sync AutoMod rules live on settings change
        const { syncAllAutoModRules } = require('../../utils/automodSync');
        if (guild) {
            await syncAllAutoModRules(guild, settings).catch(err => {
                console.error(`AutoMod Sync failed for guild ${guildId} on settings update:`, err);
            });
        }

        res.json({ success: true, settings });
    } catch (error) {
        console.error(`Error updating settings for guild ${req.params.guildId}:`, error);
        res.status(500).json({ error: 'Internal server error while updating settings.' });
    }
});

module.exports = router;
