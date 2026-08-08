const { Events, EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.ChannelUpdate,
    async execute(oldChannel, newChannel) {
        if (!oldChannel.guild) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: oldChannel.guild.id } });
            if (!settings) return;

            const loggerUtil = require('../utils/logger');
            const channelType = oldChannel.type === 4 ? 'Category' : (oldChannel.type === 2 ? 'Voice Channel' : 'Text Channel');

            // Name change
            if (oldChannel.name !== newChannel.name) {
                const embed = new EmbedBuilder()
                    .setTitle(`✏️ ${channelType} Renamed`)
                    .setColor(0x3498DB)
                    .addFields(
                        { name: 'Channel', value: oldChannel.type === 4 ? `**${newChannel.name}**` : `<#${newChannel.id}> (\`#${newChannel.name}\`)`, inline: false },
                        { name: 'Old Name', value: `\`#${oldChannel.name}\``, inline: true },
                        { name: 'New Name', value: `\`#${newChannel.name}\``, inline: true }
                    )
                    .setFooter({ text: `ID: ${newChannel.id}` })
                    .setTimestamp();

                if (oldChannel.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                    try {
                        const auditLogs = await oldChannel.guild.fetchAuditLogs({
                            type: AuditLogEvent.ChannelUpdate,
                            limit: 1
                        }).catch(() => null);
                        const entry = auditLogs?.entries?.first();
                        if (entry && entry.target?.id === newChannel.id && (Date.now() - entry.createdTimestamp < 5000)) {
                            embed.addFields({ name: 'Updated By', value: `<@${entry.executor.id}> (\`${entry.executor.tag}\`)`, inline: true });
                        }
                    } catch (e) {}
                }

                await loggerUtil.sendEventLog(oldChannel.guild, 'channelUpdate', embed, settings);
            }

            // Topic change
            if (oldChannel.topic !== newChannel.topic) {
                const topicEmbed = new EmbedBuilder()
                    .setTitle(`📝 Channel Topic Updated`)
                    .setColor(0x3498DB)
                    .addFields(
                        { name: 'Channel', value: `<#${newChannel.id}> (\`#${newChannel.name}\`)`, inline: false },
                        { name: 'Old Topic', value: oldChannel.topic ? oldChannel.topic.substring(0, 1024) : '*None*', inline: false },
                        { name: 'New Topic', value: newChannel.topic ? newChannel.topic.substring(0, 1024) : '*None*', inline: false }
                    )
                    .setFooter({ text: `ID: ${newChannel.id}` })
                    .setTimestamp();

                await loggerUtil.sendEventLog(oldChannel.guild, 'channelUpdate', topicEmbed, settings);
            }
        } catch (error) {
            console.error('[Logger] Error in ChannelUpdate:', error);
        }
    },
};
