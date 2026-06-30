const TempRole = require('../database/models/TempRole');
const { Op } = require('sequelize');

async function processTempRoles(client) {
    const now = new Date();
    const expired = await TempRole.findAll({
        where: {
            completed: false,
            removeTime: {
                [Op.lte]: now
            }
        }
    });

    for (const record of expired) {
        try {
            const guild = client.guilds.cache.get(record.guildId);
            if (guild) {
                const member = await guild.members.fetch(record.userId).catch(() => null);
                if (member) {
                    const role = guild.roles.cache.get(record.roleId);
                    if (role && member.roles.cache.has(record.roleId)) {
                        await member.roles.remove(record.roleId, 'Temporary role expired.').catch(() => {});
                        console.log(`[TempRole] Successfully removed role ${record.roleId} from user ${record.userId} in guild ${record.guildId}`);
                    }
                }
            }
            record.completed = true;
            await record.save();
        } catch (error) {
            console.error(`[TempRole] Failed to process temp role removal for user ${record.userId} in guild ${record.guildId}:`, error);
            record.completed = true;
            await record.save();
        }
    }
}

function startTempRoleManager(client) {
    setInterval(() => processTempRoles(client), 60000); // Check every minute
}

module.exports = { startTempRoleManager };
