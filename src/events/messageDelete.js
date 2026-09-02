const { Events, EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        if (!message.guild) return;
        if (message.author && message.author.bot) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: message.guild.id } });
            if (!settings) return;

            // 🚨 Anti-Cheat: Handle deletions in the Counting Channel
            try {
                const { handleCountingMessageDelete } = require('./countingSystem');
                await handleCountingMessageDelete(message, settings);
            } catch (err) {
                console.error('[Counting] Error executing handleCountingMessageDelete:', err);
            }

            const loggerUtil = require('../utils/logger');
            
            const author = message.author;
            const member = message.member;

            const authorTag = author ? (author.discriminator && author.discriminator !== '0' ? `${author.username}#${author.discriminator}` : author.tag) : 'Uncached User';
            const displayName = member?.displayName || author?.globalName || author?.username || 'Unknown';
            const authorFormatted = author ? `${authorTag} (@${displayName})` : 'Unknown User';

            const createdTimeUnix = Math.floor((message.createdTimestamp || Date.now()) / 1000);

            const description = [
                `**Channel:** <#${message.channel.id}> (${message.channel.name})`,
                `**Message ID:** ${message.id}`,
                `**Message author:** ${authorFormatted}`,
                `**Message created:** <t:${createdTimeUnix}:R>`
            ].join('\n');

            let contentText = message.content ? message.content.substring(0, 1024) : '*Empty/Embed*';

            if (message.attachments && message.attachments.size > 0) {
                const attachUrls = message.attachments.map(a => a.url).join('\n');
                contentText += `\n${attachUrls}`;
                if (contentText.length > 1024) contentText = contentText.substring(0, 1021) + '...';
            }

            const embed = new EmbedBuilder()
                .setTitle('Message deleted')
                .setAuthor({
                    name: author ? author.tag : 'Uncached User',
                    iconURL: author ? author.displayAvatarURL({ dynamic: true }) : undefined
                })
                .setColor(0xED4245)
                .setDescription(description)
                .addFields(
                    { name: 'Deleted Message', value: contentText, inline: false }
                )
                .setTimestamp();

            // Try fetching audit logs for moderator deletion
            if (message.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                try {
                    const auditLogs = await message.guild.fetchAuditLogs({
                        type: AuditLogEvent.MessageDelete,
                        limit: 1
                    }).catch(() => null);

                    const entry = auditLogs?.entries?.first();
                    if (entry && entry.target?.id === message.author?.id && entry.extra?.channel?.id === message.channel.id && (Date.now() - entry.createdTimestamp < 5000)) {
                        embed.addFields({ name: 'Deleted By', value: `<@${entry.executor.id}> (\`${entry.executor.tag}\`)`, inline: true });
                    }
                } catch (e) {}
            }

            await loggerUtil.sendEventLog(message.guild, 'messageDelete', embed, settings);
        } catch (error) {
            console.error('[Logger] Error in MessageDelete:', error);
        }
    },
};
