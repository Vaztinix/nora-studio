const path = require('path');
const sequelize = require(path.join(process.cwd(), 'src', 'database', 'db'));
(async () => {
    try {
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN levelingUseImages BOOLEAN DEFAULT 1;");
        console.log("Added levelingUseImages column successfully");
    } catch (e) {
        console.error("levelingUseImages column might already exist:", e.message);
    }
    process.exit(0);
})();
