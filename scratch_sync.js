const sequelize = require('./src/database/db');
const GuildSettings = require('./src/database/models/GuildSettings');
const GlobalSettings = require('./src/database/models/GlobalSettings');

async function sync() {
    console.log('Synchronizing database schema...');
    try {
        await sequelize.sync({ alter: true });
        console.log('Database synchronized successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Database sync failed:', err);
        process.exit(1);
    }
}

sync();
