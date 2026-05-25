const sequelize = require('../src/database/db');
async function migrate() {
    try {
        console.log('Adding scam and hardcore columns...');
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN automodScam TINYINT(1) DEFAULT 0;").catch(() => {});
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN automodHardcore TINYINT(1) DEFAULT 0;").catch(() => {});
        console.log('Migration complete.');
    } catch (error) {
        console.error('Migration failed:', error);
    }
    process.exit(0);
}
migrate();
