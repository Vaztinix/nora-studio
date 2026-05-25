const sequelize = require('../src/database/db');
async function cleanup() {
    try {
        console.log('Cleaning up failed migration artifacts...');
        await sequelize.query("DROP TABLE IF EXISTS UserLevels_backup;");
        await sequelize.query("DROP TABLE IF EXISTS GuildSettings_backup;");
        console.log('Cleanup complete.');
    } catch (e) {
        console.error('Cleanup failed:', e.message);
    }
    process.exit(0);
}
cleanup();
