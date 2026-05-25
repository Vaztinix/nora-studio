const sequelize = require('./src/database/db');

async function patch() {
    try {
        await sequelize.query('ALTER TABLE GuildSettings ADD COLUMN topggVoteEmbedImage STRING;');
    } catch (e) { console.log('topggVoteEmbedImage:', e.message); }
    try {
        await sequelize.query('ALTER TABLE GuildSettings ADD COLUMN topggVoteEmbedColor STRING DEFAULT "#FFA500";');
    } catch (e) { console.log('topggVoteEmbedColor:', e.message); }
    try {
        await sequelize.query('ALTER TABLE GuildSettings ADD COLUMN xpRoleMultipliers TEXT DEFAULT "{}";');
    } catch (e) { console.log('xpRoleMultipliers:', e.message); }
    try {
        await sequelize.query('ALTER TABLE GuildSettings ADD COLUMN guessGameXpReward INTEGER DEFAULT 100;');
    } catch (e) { console.log('guessGameXpReward:', e.message); }
    try {
        await sequelize.query('ALTER TABLE GuildSettings ADD COLUMN countingChannelXpReward INTEGER DEFAULT 5;');
    } catch (e) { console.log('countingChannelXpReward:', e.message); }
    try {
        await sequelize.query('ALTER TABLE GuildSettings ADD COLUMN robloxLiveActivityEnabled BOOLEAN DEFAULT 0;');
    } catch (e) { console.log('robloxLiveActivityEnabled:', e.message); }

    console.log('Fixed live DB with all remaining missing columns.');
    process.exit(0);
}

patch();
