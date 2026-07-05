const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        // Handle Partial Messages
        if (message.partial) {
            // We can't log content of a partial message that was deleted because it's gone from Discord's end too
            // but we can still try to log that *something* was deleted.
        }

        if (!message.guild) return;
        if (message.author && message.author.bot) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: message.guild.id } });
            if (!settings) return;
            const loggerUtil = require('../utils/logger');
            
            const author = message.author;
            const embed = new EmbedBuilder()
                .setTitle('Message Deleted')
                .setAuthor({
                    name: author ? author.tag : 'Uncached User',
                    iconURL: author ? author.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png'
                })
                .setColor(0xff4b4b) // Red for deletion
                .addFields(
                    { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                    { name: 'Author', value: author ? `<@${author.id}>` : 'Unknown', inline: true },
                    { name: 'Content', value: message.content ? (message.content.substring(0, 1024) || '*Empty/Embed*') : '*Unknown Content (Uncached)*' }
                )
                .setFooter({ text: `Message ID: ${message.id}` })
                .setTimestamp();

            await loggerUtil.sendEventLog(message.guild, 'messageDelete', embed, settings);
        } catch (error) {
            console.error('[Logger] Error in MessageDelete:', error);
        }
    },
};
