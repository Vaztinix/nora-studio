const sequelize = require('./src/database/db');
const GuildSettings = require('./src/database/models/GuildSettings');

(async () => {
    try {
        console.log("Syncing GuildSettings...");
        await GuildSettings.sync({ alter: true });
        console.log("GuildSettings synchronized successfully.");
        process.exit(0);
    } catch (e) {
        console.error("Failed to sync GuildSettings:", e);
        process.exit(1);
    }
})();
