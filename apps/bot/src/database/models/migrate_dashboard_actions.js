const path = require('path');
const sequelize = require(path.join(process.cwd(), 'src', 'database', 'db'));
(async () => {
    try {
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN logDashboardActions BOOLEAN DEFAULT 1;");
        console.log("Added logDashboardActions column successfully");
    } catch (e) {
        console.error("logDashboardActions column might already exist:", e.message);
    }
    process.exit(0);
})();
