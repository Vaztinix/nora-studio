const { Events } = require('discord.js');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // 🛡️ Anti-Spam & AutoMod operate 100% via Discord's Native AutoMod Engine API (AutoModerationActionExecution)
        return;
    },
};
