const express = require('express');
const router = express.Router({ mergeParams: true });
const GuildSettings = require('../../database/models/GuildSettings');
const { requireGuildPermission } = require('../middleware/auth');

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

        res.json(settings);
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

        // Prevent updating the guildId itself
        if (payload.guildId) {
            delete payload.guildId;
        }

        // Find or create settings
        let [settings] = await GuildSettings.findOrCreate({ where: { guildId } });

        // Update the settings model with the payload provided by the dashboard
        await settings.update(payload);

        // NOTE: If you need to trigger live Discord integrations (like syncing AutoMod rules)
        // when these settings change, you would import and call those sync functions here.

        res.json({ success: true, settings });
    } catch (error) {
        console.error(`Error updating settings for guild ${req.params.guildId}:`, error);
        res.status(500).json({ error: 'Internal server error while updating settings.' });
    }
});

module.exports = router;
