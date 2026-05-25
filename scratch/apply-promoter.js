const sequelize = require('../src/database/db');
const GuildSettings = require('../src/database/models/GuildSettings');

async function setPromoter() {
    try {
        await sequelize.authenticate();
        await sequelize.sync({ alter: true });
        const guildId = '1484683779137208420'; // Nora Server
        const roleId = '1491965024493895680';

        const settings = await GuildSettings.findOne({ where: { guildId } });
        if (settings) {
            settings.promoterRoleId = roleId;
            await settings.save();
            console.log(`[Database Update] Successfully set Promoter Role to ${roleId} for Guild ${guildId}`);
        } else {
            console.error('[Database Update] Guild settings not found for', guildId);
        }
    } catch (e) {
        console.error('Update failed:', e);
    } finally {
        await sequelize.close();
        process.exit();
    }
}

setPromoter();

