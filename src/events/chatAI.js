const { Events } = require('discord.js');

/**
 * Nora Core V18.6 - Aura Intelligence Engine
 * Modernized for 2026 AI expectations.
 */
module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot || message.system) return;
        if (client.user && message.author.id === client.user.id) return;

        let isMentioned = Boolean(client.user && message.mentions?.has(client.user) && !message.mentions.everyone);
        let isReply = false;
        if (message.reference && message.reference.messageId) {
            try {
                const refMsg = await message.channel?.messages?.fetch(message.reference.messageId).catch(() => null);
                if (refMsg && refMsg.author && client.user && refMsg.author.id === client.user.id) {
                    isReply = true;
                }
            } catch (e) {}
        }
        
        if (!isMentioned && !isReply) return;

        // Fail silently / do nothing
        return;
    }
};

