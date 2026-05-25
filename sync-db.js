const sequelize = require('./src/database/db');
const GuildSettings = require('./src/database/models/GuildSettings');

async function syncDB() {
    try {
        console.log('Syncing database...');
        await sequelize.sync({ alter: true });
        console.log('Database synced successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Error syncing database:', err);
        process.exit(1);
    }
}

syncDB();
