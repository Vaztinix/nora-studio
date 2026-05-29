const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database.sqlite'),
    logging: false, // Disable SQL noise so real errors are visible
    dialectOptions: {
        // Increase busy timeout directly in the driver (10 seconds) to prevent locking errors
        busy_timeout: 10000
    }
});

// Run pragmas after connect using standard sequelize query
sequelize.beforeConnect(async () => {
    // Empty to prevent errors
});

sequelize.authenticate().then(async () => {
    try {
        await sequelize.query('PRAGMA journal_mode=WAL;');
        await sequelize.query('PRAGMA busy_timeout=5000;');
        await sequelize.query('PRAGMA synchronous=NORMAL;');
    } catch (e) {
        console.error('[DB] Pragma Init Failed:', e.message);
    }
}).catch(() => {});

module.exports = sequelize;
