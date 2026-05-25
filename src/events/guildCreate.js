const { Events } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const GlobalSettings = require('../database/models/GlobalSettings');
const { updateStats } = require('../utils/topgg');
const { logEvent } = require('../utils/logistics');

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        // 🛡️ Permanent Exile Guard
        let global;
        try {
            const [result] = await GlobalSettings.findOrCreate({ where: { id: 1 } });
            global = result;
        } catch (e) {
            global = await GlobalSettings.findOne({ where: { id: 1 } });
        }
        
        const bannedIds = JSON.parse(global?.bannedGuildIds || '[]');
        
        if (bannedIds.includes(guild.id)) {
            console.warn(`[Exile System] Detected illegal join attempt at Exiled Server: ${guild.name} (${guild.id}). Severing link instantly.`);
            try {
                await guild.leave();
            } catch (e) {
                console.error(`[Exile System] Failed to physically sever link for server ${guild.id}:`, e);
            }
            return; // Exit immediately
        }

        console.log(`[System] System Connection Synchronized: ${guild.name} (ID: ${guild.id})`);
        
        // Update Top.gg Stats
        await updateStats(guild.client);
        
        // Log to Master HQ Logistics Webhook
        await logEvent(guild, 'join');
    },
};
