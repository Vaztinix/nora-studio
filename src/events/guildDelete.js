const { Events } = require('discord.js');
const { logEvent } = require('../utils/logistics');

module.exports = {
    name: Events.GuildDelete,
    async execute(guild) {
        console.log(`[System] System Link Deactivated: ${guild.name} (ID: ${guild.id})`);
        
        // Trigger Cascading Erasure Sequence
        const { performCascadingErasure } = require('../utils/erasure');
        await performCascadingErasure(guild.id).catch(err => {
            console.error(`[GuildDelete Erasure Error] Failed:`, err);
        });

        // Log to Master HQ Logistics Webhook
        await logEvent(guild, 'leave');
    },
};
