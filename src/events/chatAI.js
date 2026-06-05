const { Events } = require('discord.js');

/**
 * Nora Core V18.6 - Aura Intelligence Engine
 * Modernized for 2026 AI expectations.
 */
module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot) return;
        if (message.author.id === client.user.id) return;

        let isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;
        let isReply = message.reference && (await message.channel.messages.fetch(message.reference.messageId).catch(() => null))?.author.id === client.user.id;
        
        if (!isMentioned && !isReply) return;

        return message.reply({ content: "Nora's AI features are currently undergoing upgrades to advanced LLM models. Stay tuned!" });
    }
};

