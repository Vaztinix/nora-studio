const sequelize = require('./src/database/db');
const UserLevel = require('./src/database/models/UserLevel');

(async () => {
    try {
        const nulls = await UserLevel.findAll({ where: { guildId: null } });
        console.log("Null guildIds:", nulls.length);
        
        // Remove or fix bad records
        if (nulls.length > 0) {
            await UserLevel.destroy({ where: { guildId: null } });
            console.log("Deleted null guildIds");
        }

        const GuildSettings = require('./src/database/models/GuildSettings');
        const nullSettings = await GuildSettings.findAll({ where: { guildId: null } });
        console.log("Null GuildSettings guildIds:", nullSettings.length);
        if (nullSettings.length > 0) {
            await GuildSettings.destroy({ where: { guildId: null } });
            console.log("Deleted null GuildSettings records");
        }

        const duplicateCheck = await sequelize.query(`
            SELECT userId, guildId, COUNT(*) 
            FROM UserLevels 
            GROUP BY userId, guildId 
            HAVING COUNT(*) > 1
        `);
        console.log("Duplicates:", duplicateCheck[0].length);
        
        // If there are duplicates, delete them (keep one)
        for (const dup of duplicateCheck[0]) {
            console.log("Deleting duplicate:", dup.userId, dup.guildId);
            const records = await UserLevel.findAll({ where: { userId: dup.userId, guildId: dup.guildId } });
            // keep first, delete rest
            for (let i = 1; i < records.length; i++) {
                await records[i].destroy();
            }
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
