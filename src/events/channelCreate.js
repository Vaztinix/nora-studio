const { Events, EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.ChannelCreate,
    async execute(channel) {
        if (!channel.guild) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: channel.guild.id } });
            if (!settings) return;

            const loggerUtil = require('../utils/logger');
            const channelType = channel.type === 4 ? 'Category' : (channel.type === 2 ? 'Voice Channel' : 'Text Channel');

            const embed = new EmbedBuilder()
                .setTitle(`🆕 ${channelType} Created`)
                .setColor(0x57F287)
                .addFields(
                    { name: 'Name', value: channel.type === 4 ? `**${channel.name}**` : `<#${channel.id}> (\`#${channel.name}\`)`, inline: true },
                    { name: 'ID', value: `\`${channel.id}\``, inline: true }
                )
                .setTimestamp();

            // Try fetching audit log for executor
            if (channel.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                try {
                    const auditLogs = await channel.guild.fetchAuditLogs({
                        type: AuditLogEvent.ChannelCreate,
                        limit: 1
                    }).catch(() => null);

                    const entry = auditLogs?.entries?.first();
                    if (entry && entry.target?.id === channel.id && (Date.now() - entry.createdTimestamp < 5000)) {
                        embed.addFields({ name: 'Created By', value: `<@${entry.executor.id}> (\`${entry.executor.tag}\`)`, inline: true });
                    }
                } catch (e) {}
            }

            await loggerUtil.sendEventLog(channel.guild, 'channelCreate', embed, settings);
        } catch (error) {
            console.error('[Logger] Error in ChannelCreate:', error);
        }
    },
};
