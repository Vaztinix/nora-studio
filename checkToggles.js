const GuildSettings = require('./src/database/models/GuildSettings');
(async () => {
    const settings = await GuildSettings.findAll();
    console.log(settings.map(s => ({ guild: s.guildId, logs: s.loggingChannelId, cd: s.logChannelDeletes, vm: s.logVoiceMoves })));
})();
