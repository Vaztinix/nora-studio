const sequelize = require('../src/database/db');
async function migrate() {
    try {
        console.log('Starting manual migration for AutoMod columns...');
        
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN automodProfanity TINYINT(1) DEFAULT 0;").catch(e => console.log('automodProfanity already exists or error:', e.message));
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN automodSexual TINYINT(1) DEFAULT 0;").catch(e => console.log('automodSexual already exists or error:', e.message));
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN automodSlurs TINYINT(1) DEFAULT 0;").catch(e => console.log('automodSlurs already exists or error:', e.message));
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN automodSpam TINYINT(1) DEFAULT 0;").catch(e => console.log('automodSpam already exists or error:', e.message));
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN automodMentions INTEGER DEFAULT 0;").catch(e => console.log('automodMentions already exists or error:', e.message));
        
        console.log('Migration complete.');
    } catch (error) {
        console.error('Migration failed:', error);
    }
    process.exit(0);
}
migrate();
