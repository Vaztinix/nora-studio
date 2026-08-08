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
            const loggerUtil = require('../utils/logger');
            
            const author = message.author;
            const embed = new EmbedBuilder()
                .setTitle('🗑️ Message Deleted')
                .setAuthor({
                    name: author ? author.tag : 'Uncached User',
                    iconURL: author ? author.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png'
                })
                .setColor(0xED4245)
                .addFields(
                    { name: 'Channel', value: `<#${message.channel.id}> (\`#${message.channel.name}\`)`, inline: true },
                    { name: 'Author', value: author ? `<@${author.id}> (\`${author.id}\`)` : 'Unknown', inline: true },
                    { name: 'Content', value: message.content ? (message.content.substring(0, 1024) || '*Empty/Embed*') : '*Unknown Content (Uncached)*' }
                )
                .setFooter({ text: `Message ID: ${message.id}` })
                .setTimestamp();

            // Log attachments if present
            if (message.attachments && message.attachments.size > 0) {
                const attachList = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
                embed.addFields({ name: 'Attachments', value: attachList.substring(0, 1024) || '*File Attached*', inline: false });
            }

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
