const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        // Handle Partials
        if (oldMessage.partial) return; // Can't compare if we don't have the old content
        if (!oldMessage.guild) return;
        if (oldMessage.author && oldMessage.author.bot) return;
        if (oldMessage.content === newMessage.content) return; // No text change (e.g. pinned or embed change)

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: oldMessage.guild.id } });
            // console.log(`[Logger DEBUG] MsgUpdate event in ${oldMessage.guild.name}. ChannelSet: ${!!settings?.loggingChannelId}, Toggle: ${settings?.logMessageEdits}`);
            if (!settings || !settings.logMessageEdits) return;
            const loggerUtil = require('../utils/logger');
            const logChannelId = loggerUtil.resolveLogChannelId(settings, 'messageLogs');
            if (!logChannelId) return;

            let logChannel = oldMessage.guild.channels.cache.get(logChannelId);
            if (!logChannel) logChannel = await oldMessage.guild.channels.fetch(logChannelId).catch(() => null);
            
            if (!logChannel) {
                console.error(`[Logger ERROR] Target channel ${settings.loggingChannelId} not found in ${oldMessage.guild.name}.`);
                return;
            }
            
            const perms = logChannel.permissionsFor(oldMessage.guild.members.me);
            // console.log(`[Logger DEBUG] Nora Perms in ${logChannel.name}: View:${perms.has('ViewChannel')}, Send:${perms.has('SendMessages')}, Embed:${perms.has('EmbedLinks')}`);
            
            // console.log(`[Logger DEBUG] Found channel ${logChannel.name} (${logChannel.id}). Sending log...`);

            const author = oldMessage.author || newMessage.author;
            const embed = new EmbedBuilder()
                .setTitle('Message Edited')
                .setAuthor({
                    name: author ? author.tag : 'Uncached User',
                    iconURL: author ? author.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png'
                })
                .setColor(0xFFA500) // Orange for edit
                .addFields(
                    { name: 'Channel', value: `<#${oldMessage.channel.id}>`, inline: true },
                    { name: 'Author', value: `<@${author.id}>`, inline: true },
                    { name: 'Before', value: oldMessage.content ? (oldMessage.content.substring(0, 1024) || '*Empty*') : '*Empty/Embed*' },
                    { name: 'After', value: newMessage.content ? (newMessage.content.substring(0, 1024) || '*Empty*') : '*Empty/Embed*' },
                    { name: 'Link', value: `[Jump to Message](${newMessage.url})` }
                )
                .setFooter({ text: `Message ID: ${newMessage.id}` })
                .setTimestamp();

            await logChannel.send({ embeds: [embed] }).catch((err) => { 
                console.error(`[Logger ERROR] Failed to send MsgUpdate to ${logChannel.name}:`, err.message);
            });
        } catch (error) {
            console.error('[Logger] Error in MessageUpdate:', error);
        }
    },
};
