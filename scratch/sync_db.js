const sequelize = require('../src/database/db');
const GuildSettings = require('../src/database/models/GuildSettings');

async function sync() {
    try {
        console.log('Syncing GuildSettings only...');
        await GuildSettings.sync({ alter: true });
        console.log('GuildSettings synced successfully!');
    } catch (error) {
        console.error('Error syncing GuildSettings:', error);
    } finally {
        process.exit();
    }
}

sync();
