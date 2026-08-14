const { Events } = require('discord.js');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // 🛡️ AutoMod operates via Discord's Native AutoMod Engine API (AutoModerationActionExecution)
        return;
    },
};
