const NoraLeveling = require('./noraLeveling');

/**
 * Nora Core Re-Sync Engine - V17.3 Catch-Up Unit
 * Handles missing data recovery and heartbeat pulses.
 */
module.exports = {
    /**
     * Calculates downtime and awards "Catch-Up XP" to active Voice members.
     */
    syncDowntime: async (client) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const DB_PATH = path.join(__dirname, '..', '..', 'database', 'database.sqlite');

            if (!fs.existsSync(DB_PATH)) return;
            const stats = fs.statSync(DB_PATH);
            const lastModified = stats.mtime;
            const now = new Date();
            const diffMins = Math.floor((now - lastModified) / 1000 / 60);

            if (diffMins < 5) return; // Ignore micro-reboots under 5 mins

            // Cap catch-up at 60 mins to prevent extreme XP inflation
            const catchUpMins = Math.min(diffMins, 60);
            const intervalsMissed = Math.floor(catchUpMins / 5);
            
            if (intervalsMissed <= 0) return;

            const totalCatchUpXP = intervalsMissed * NoraLeveling.getMediumXP();
            console.log(`[System Re-Sync] Reboot detected. Awarding catch-up XP for ${catchUpMins}m of downtime.`);

            for (const [guildId, guild] of client.guilds.cache) {
                // Check if leveling is enabled
                const GuildSettings = require('../database/models/GuildSettings');
                const settings = await GuildSettings.findOne({ where: { guildId } });
                if (!settings || !settings.levelingEnabled) continue;

                for (const [, channel] of guild.channels.cache.filter(c => c.isVoiceBased())) {
                    const activeMembers = channel.members.filter(m => !m.user.bot && !m.voice.selfDeaf && !m.voice.serverDeaf);
                    if (activeMembers.size >= 2) {
                        for (const [, member] of activeMembers) {
                            try {
                                const userLevel = await NoraLeveling.getOrInitializeUser(member.id, guildId);
                                if (!userLevel) continue;

                                await NoraLeveling.addExperience(userLevel, totalCatchUpXP);
                                await userLevel.save();
                            } catch (err) {
                                console.error(`[System Re-Sync Error] Member ${member.id}:`, err.message);
                            }
                        }
                    }
                }
            }

            console.log(`[System Re-Sync] Data Catch-Up Successfully Completed.`);
        } catch (error) {
            console.error('[System Re-Sync Fault]:', error);
        }
    },

    /**
     * Updates the last heartbeat timestamp in the global Registry.
     */
    updateHeartbeat: async () => {
        try {
            const GlobalSettings = require('../database/models/GlobalSettings');
            await GlobalSettings.update({ lastHeartbeat: new Date() }, { where: { id: 1 } });
        } catch (error) {
            console.error('[System Heartbeat Fault]:', error);
        }
    }
};
