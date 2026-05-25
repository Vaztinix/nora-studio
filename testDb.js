const GuildSettings = require('./src/database/models/GuildSettings');
async function test() {
    try {
        await GuildSettings.findAll({ limit: 1 });
        console.log("findAll succeeded");
    } catch (e) {
        console.error("findAll failed:", e.message);
    }
    process.exit(0);
}
test();
