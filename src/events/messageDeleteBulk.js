const { Events, EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.MessageBulkDelete,
    async execute(messages, channel) {
        if (!channel || !channel.guild) return;
        const guild = channel.guild;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            if (!settings) return;

            // Check if purge logging is enabled
            if (settings.logMessagePurges === false) return;

            const loggerUtil = require('../utils/logger');
            const count = messages?.size || 0;
            const nowUnix = Math.floor(Date.now() / 1000);

            let executorText = 'Unknown / External Bot';
            let executorUser = null;

            // Fetch Audit Logs to find who initiated the bulk purge (e.g., Circle, Dyno, or Staff)
            if (guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                try {
                    const auditLogs = await guild.fetchAuditLogs({
                        type: AuditLogEvent.MessageBulkDelete,
                        limit: 1
                    }).catch(() => null);

                    const entry = auditLogs?.entries?.first();
                    if (entry && entry.extra?.channel?.id === channel.id && (Date.now() - entry.createdTimestamp < 10000)) {
                        executorUser = entry.executor;
                        const isBot = entry.executor?.bot ? ' [BOT]' : '';
                        executorText = `<@${entry.executor.id}> (\`${entry.executor.tag}\`${isBot}) • \`${entry.executor.id}\``;
                    }
                } catch (e) {
                    console.error('[Logger] Failed fetching audit log for MessageBulkDelete:', e.message);
                }
            }

            const description = [
                `**Channel:** <#${channel.id}> (\`${channel.name}\`)`,
                `**Messages Purged:** \`${count}\``,
                `**Action Executed By:** ${executorText}`,
                `**Timestamp:** <t:${nowUnix}:F> (<t:${nowUnix}:R>)`
            ].join('\n');

            // Unique authors in cached messages if available
            let authorsSummary = '';
            if (messages && messages.size > 0) {
                const authors = new Set();
                messages.forEach(msg => {
                    if (msg.author) authors.add(`\`${msg.author.tag || msg.author.username}\``);
                });
                if (authors.size > 0) {
                    const authorList = Array.from(authors).slice(0, 8).join(', ');
                    const remaining = authors.size > 8 ? ` +${authors.size - 8} more` : '';
                    authorsSummary = authorList + remaining;
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('🗑️ Bulk Messages Purged')
                .setColor(0xE67E22)
                .setDescription(description)
                .setTimestamp();

            if (executorUser) {
                embed.setAuthor({
                    name: `${executorUser.tag} (${executorUser.id})`,
                    iconURL: executorUser.displayAvatarURL({ dynamic: true })
                });
            }

            if (authorsSummary) {
                embed.addFields({ name: 'Affected Authors (Cached)', value: authorsSummary, inline: false });
            }

            await loggerUtil.sendEventLog(guild, 'messagePurges', embed, settings, channel.id);
        } catch (error) {
            console.error('[Logger] Error in MessageBulkDelete:', error);
        }
    }
};
