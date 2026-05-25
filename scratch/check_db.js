const sequelize = require('../src/database/db');
async function check() {
    const [results] = await sequelize.query("PRAGMA table_info(GuildSettings);");
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
}
check();
