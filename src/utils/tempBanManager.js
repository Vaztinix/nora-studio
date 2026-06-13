const TempBan = require('../database/models/TempBan');
const { Op } = require('sequelize');

async function processTempBans(client) {
    const now = new Date();
    const expired = await TempBan.findAll({
        where: {
            completed: false,
            unbanTime: {
                [Op.lte]: now
            }
        }
    });

    for (const ban of expired) {
        try {
            const guild = client.guilds.cache.get(ban.guildId);
            if (guild) {
                // Check if user is banned before unbanning
                const bans = await guild.bans.fetch().catch(() => null);
                if (bans && bans.has(ban.userId)) {
                    await guild.members.unban(ban.userId, 'Temporary ban expired.').catch(() => {});
                    console.log(`[TempBan] Successfully unbanned user ${ban.userId} in guild ${ban.guildId}`);
                }
            }
            ban.completed = true;
            await ban.save();
        } catch (error) {
            console.error(`[TempBan] Failed to unban user ${ban.userId} in guild ${ban.guildId}:`, error);
            // Mark completed anyway to prevent getting stuck
            ban.completed = true;
            await ban.save();
        }
    }
}

function startTempBanManager(client) {
    setInterval(() => processTempBans(client), 60000); // Check every minute
}

module.exports = { startTempBanManager };
