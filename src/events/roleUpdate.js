const { Events, EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.GuildRoleUpdate,
    async execute(oldRole, newRole) {
        if (!oldRole.guild) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: oldRole.guild.id } });
            if (!settings) return;
            const loggerUtil = require('../utils/logger');

            if (oldRole.name !== newRole.name) {
                const embed = new EmbedBuilder()
                    .setTitle('✏️ Role Renamed')
                    .setColor(newRole.color || 0x3498DB)
                    .addFields(
                        { name: 'Role', value: `<@&${newRole.id}>`, inline: false },
                        { name: 'Old Name', value: `\`@${oldRole.name}\``, inline: true },
                        { name: 'New Name', value: `\`@${newRole.name}\``, inline: true }
                    )
                    .setFooter({ text: `Role ID: ${newRole.id}` })
                    .setTimestamp();

                if (oldRole.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                    try {
                        const auditLogs = await oldRole.guild.fetchAuditLogs({
                            type: AuditLogEvent.RoleUpdate,
                            limit: 1
                        }).catch(() => null);
                        const entry = auditLogs?.entries?.first();
                        if (entry && entry.target?.id === newRole.id && (Date.now() - entry.createdTimestamp < 5000)) {
                            embed.addFields({ name: 'Updated By', value: `<@${entry.executor.id}> (\`${entry.executor.tag}\`)`, inline: true });
                        }
                    } catch (e) {}
                }

                await loggerUtil.sendEventLog(oldRole.guild, 'roleUpdate', embed, settings);
            }
        } catch (error) {
            console.error('[Logger] Error in RoleUpdate:', error);
        }
    }
};
