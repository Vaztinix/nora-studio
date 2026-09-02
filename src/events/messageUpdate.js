const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        if (oldMessage.partial) {
            try { await oldMessage.fetch().catch(() => {}); } catch (_) {}
        }
        if (newMessage.partial) {
            try { await newMessage.fetch().catch(() => {}); } catch (_) {}
        }
        const guild = newMessage.guild || oldMessage.guild;
        if (!guild) return;
        const author = newMessage.author || oldMessage.author;
        if (author && author.bot) return;
        if (oldMessage.content === newMessage.content) return; // Ignore embed or pin updates

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            if (!settings) return;

            // 🚨 Anti-Cheat: Handle edits in the Counting Channel
            try {
                const { handleCountingMessageEdit } = require('./countingSystem');
                await handleCountingMessageEdit(oldMessage, newMessage, settings);
            } catch (err) {
                console.error('[Counting] Error executing handleCountingMessageEdit:', err);
            }

            const loggerUtil = require('../utils/logger');
            
            const author = oldMessage.author || newMessage.author;
            const member = oldMessage.member || newMessage.member;

            const authorTag = author ? (author.discriminator && author.discriminator !== '0' ? `${author.username}#${author.discriminator}` : author.tag) : 'Uncached User';
            const displayName = member?.displayName || author?.globalName || author?.username || 'Unknown';
            const authorFormatted = author ? `${authorTag} (@${displayName})` : 'Unknown User';

            const createdTimeUnix = Math.floor((oldMessage.createdTimestamp || newMessage.createdTimestamp || Date.now()) / 1000);

            const description = [
                `**Channel:** <#${oldMessage.channel.id}> (${oldMessage.channel.name})`,
                `**Message ID:** ${newMessage.id}`,
                `**Message author:** ${authorFormatted}`,
                `**Message created:** <t:${createdTimeUnix}:R>`
            ].join('\n');

            let beforeText = oldMessage.content ? oldMessage.content.substring(0, 1024) : '*Empty/Embed*';
            let afterText = newMessage.content ? newMessage.content.substring(0, 1024) : '*Empty/Embed*';

            if (oldMessage.attachments && oldMessage.attachments.size > 0) {
                const attachUrls = oldMessage.attachments.map(a => a.url).join('\n');
                beforeText += `\n${attachUrls}`;
                if (beforeText.length > 1024) beforeText = beforeText.substring(0, 1021) + '...';
            }

            if (newMessage.attachments && newMessage.attachments.size > 0) {
                const attachUrls = newMessage.attachments.map(a => a.url).join('\n');
                afterText += `\n${attachUrls}`;
                if (afterText.length > 1024) afterText = afterText.substring(0, 1021) + '...';
            }

            const embed = new EmbedBuilder()
                .setTitle('Message edited')
                .setAuthor({
                    name: author ? author.tag : 'Uncached User',
                    iconURL: author ? author.displayAvatarURL({ dynamic: true }) : undefined
                })
                .setColor(0xFEE75C)
                .setDescription(description)
                .addFields(
                    { name: 'Before', value: beforeText, inline: false },
                    { name: 'After', value: afterText, inline: false }
                )
                .setTimestamp();

            await loggerUtil.sendEventLog(oldMessage.guild, 'messageUpdate', embed, settings);
        } catch (error) {
            console.error('[Logger] Error in MessageUpdate:', error);
        }
    },
};
