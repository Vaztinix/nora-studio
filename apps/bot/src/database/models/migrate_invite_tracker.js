const path = require('path');
const sequelize = require(path.join(process.cwd(), 'src', 'database', 'db'));

(async () => {
    try {
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN inviteTrackerEnabled BOOLEAN DEFAULT 0;");
        console.log("Added inviteTrackerEnabled column successfully");
    } catch (e) {
        console.error("inviteTrackerEnabled column might already exist:", e.message);
    }
    
    try {
        await sequelize.query("ALTER TABLE GuildSettings ADD COLUMN inviteTrackerChannelId VARCHAR(255) NULL;");
        console.log("Added inviteTrackerChannelId column successfully");
    } catch (e) {
        console.error("inviteTrackerChannelId column might already exist:", e.message);
    }

    try {
        await sequelize.query("ALTER TABLE Autoresponders ADD COLUMN ignoreStaffAndBots BOOLEAN DEFAULT 0;");
        console.log("Added ignoreStaffAndBots column successfully");
    } catch (e) {
        console.error("ignoreStaffAndBots column might already exist:", e.message);
    }

    try {
        await sequelize.query("ALTER TABLE Autoresponders ADD COLUMN ignoredChannels TEXT DEFAULT '[]';");
        console.log("Added ignoredChannels column successfully");
    } catch (e) {
        console.error("ignoredChannels column might already exist:", e.message);
    }

    process.exit(0);
})();
