const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        if (oldMessage.partial || newMessage.partial) return;
        if (!oldMessage.guild) return;
        if (oldMessage.author && oldMessage.author.bot) return;
        if (oldMessage.content === newMessage.content) return; // Ignore embed or pin updates

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: oldMessage.guild.id } });
            if (!settings) return;
            const loggerUtil = require('../utils/logger');
            
            const author = oldMessage.author || newMessage.author;
            const embed = new EmbedBuilder()
                .setTitle('✏️ Message Edited')
                .setAuthor({
                    name: author ? author.tag : 'Uncached User',
                    iconURL: author ? author.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png'
                })
                .setColor(0xFEE75C)
                .addFields(
                    { name: 'Channel', value: `<#${oldMessage.channel.id}> (\`#${oldMessage.channel.name}\`)`, inline: true },
                    { name: 'Author', value: author ? `<@${author.id}> (\`${author.id}\`)` : 'Unknown', inline: true },
                    { name: 'Before', value: oldMessage.content ? (oldMessage.content.substring(0, 1024) || '*Empty*') : '*Empty/Embed*', inline: false },
                    { name: 'After', value: newMessage.content ? (newMessage.content.substring(0, 1024) || '*Empty*') : '*Empty/Embed*', inline: false },
                    { name: 'Message Link', value: `[🔗 Jump to Message](${newMessage.url})`, inline: false }
                )
                .setFooter({ text: `Message ID: ${newMessage.id}` })
                .setTimestamp();

            await loggerUtil.sendEventLog(oldMessage.guild, 'messageUpdate', embed, settings);
        } catch (error) {
            console.error('[Logger] Error in MessageUpdate:', error);
        }
    },
};
