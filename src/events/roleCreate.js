const { Events, EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.GuildRoleCreate,
    async execute(role) {
        if (!role.guild) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: role.guild.id } });
            if (!settings) return;
            const loggerUtil = require('../utils/logger');

            const embed = new EmbedBuilder()
                .setTitle('🎭 Role Created')
                .setColor(role.color || 0x2ECC71)
                .addFields(
                    { name: 'Role Name', value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
                    { name: 'Role ID', value: `\`${role.id}\``, inline: true }
                )
                .setTimestamp();

            if (role.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                try {
                    const auditLogs = await role.guild.fetchAuditLogs({
                        type: AuditLogEvent.RoleCreate,
                        limit: 1
                    }).catch(() => null);
                    const entry = auditLogs?.entries?.first();
                    if (entry && entry.target?.id === role.id && (Date.now() - entry.createdTimestamp < 5000)) {
                        embed.addFields({ name: 'Created By', value: `<@${entry.executor.id}> (\`${entry.executor.tag}\`)`, inline: true });
                    }
                } catch (e) {}
            }

            await loggerUtil.sendEventLog(role.guild, 'roleCreate', embed, settings);
        } catch (error) {
            console.error('[Logger] Error in RoleCreate:', error);
        }
    }
};
