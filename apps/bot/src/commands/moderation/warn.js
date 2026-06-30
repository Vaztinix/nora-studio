const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Warning = require('../../database/models/Warning');
const Case = require('../../database/models/Case');
const settingsCache = require('../../utils/settingsCache');
const { handleError, handleSuccess } = require('../../utils/embeds');

// Severity badge mapping for embeds
const SEVERITY_BADGES = {
    low: '🟢 Low',
    medium: '🟡 Medium',
    high: '🟠 High',
    critical: '🔴 Critical'
};

const SEVERITY_COLORS = {
    low: 0x43b581,
    medium: 0xfaa61a,
    high: 0xf47b67,
    critical: 0xed4245
};

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warning management system.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Issue a warning to a user.')
                .addUserOption(opt => opt.setName('user').setDescription('The user to warn').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('The reason for the warning').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('severity')
                        .setDescription('Severity level of the warning')
                        .setRequired(false)
                        .addChoices(
                            { name: '🟢 Low', value: 'low' },
                            { name: '🟡 Medium', value: 'medium' },
                            { name: '🟠 High', value: 'high' },
                            { name: '🔴 Critical', value: 'critical' }
                        )))
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View all warnings for a user.')
                .addUserOption(opt => opt.setName('user').setDescription('The user to view warnings for').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a specific warning by its ID (soft-delete).')
                .addIntegerOption(opt => opt.setName('id').setDescription('The warning ID to remove').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('clear')
                .setDescription('Clear all active warnings for a user.')
                .addUserOption(opt => opt.setName('user').setDescription('The user to clear warnings for').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('Edit the reason for a specific warning.')
                .addIntegerOption(opt => opt.setName('id').setDescription('The warning ID to edit').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('The new reason for the warning').setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'add':
                    return await this.handleAdd(interaction);
                case 'view':
                    return await this.handleView(interaction);
                case 'remove':
                    return await this.handleRemove(interaction);
                case 'clear':
                    return await this.handleClear(interaction);
                case 'edit':
                    return await this.handleEdit(interaction);
                default:
                    return await handleError(interaction, 'Unknown Subcommand', 'Nora doesn\'t recognize this warning command action.');
            }
        } catch (err) {
            console.error(`Error executing warn ${subcommand}:`, err);
            return await handleError(interaction, 'Execution Error', 'An error occurred while processing the warning command.');
        }
    },

    async handleAdd(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const severity = interaction.options.getString('severity') || 'medium';
        const member = interaction.guild.members.cache.get(user.id);

        // Self-warn guard
        if (user.id === interaction.user.id) {
            return await handleError(interaction, 'Action Blocked', 'You cannot warn yourself.');
        }

        // Bot-warn guard
        if (user.id === interaction.client.user.id) {
            return await handleError(interaction, 'Action Blocked', 'You cannot warn me.');
        }

        // Owner immunity
        if (user.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return await handleError(interaction, 'Owner Security', 'You cannot warn the Server Owner.');
        }

        // Hierarchy validation
        if (member && member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return await handleError(interaction, 'Hierarchy Violation', 'You cannot warn someone with a higher or equal role.');
        }

        // Atomic creation: Warning + Case
        const warning = await Warning.create({
            userId: user.id,
            guildId: interaction.guild.id,
            moderatorId: interaction.user.id,
            reason,
            severity
        });

        const caseRecord = await Case.create({
            guildId: interaction.guild.id,
            userId: user.id,
            moderatorId: interaction.user.id,
            type: 'WARN',
            reason,
            status: 'active',
            linkedWarningId: warning.id
        });

        // Count active warnings for threshold check
        const warningCount = await Warning.count({
            where: { userId: user.id, guildId: interaction.guild.id, active: true }
        });

        // Threshold auto-action
        const settings = await settingsCache.get(interaction.guild.id);
        let thresholdActionTaken = '';

        if (settings && settings.warningAction !== 'none' && warningCount >= settings.warningThreshold) {
            if (member && member.moderatable) {
                try {
                    if (settings.warningAction === 'kick') {
                        await member.kick(`Warning threshold hit (${warningCount} warnings)`);
                        thresholdActionTaken = '\n\n⚡ **Threshold Action:** User has been kicked.';
                        await Case.create({
                            guildId: interaction.guild.id, userId: user.id,
                            moderatorId: interaction.client.user.id, type: 'KICK',
                            reason: `Auto-kick: Warning threshold reached (${warningCount} warnings)`, status: 'active'
                        });
                    } else if (settings.warningAction === 'ban') {
                        await member.ban({ reason: `Warning threshold hit (${warningCount} warnings)` });
                        thresholdActionTaken = '\n\n⚡ **Threshold Action:** User has been banned.';
                        await Case.create({
                            guildId: interaction.guild.id, userId: user.id,
                            moderatorId: interaction.client.user.id, type: 'BAN',
                            reason: `Auto-ban: Warning threshold reached (${warningCount} warnings)`, status: 'active'
                        });
                    } else if (settings.warningAction === 'timeout') {
                        const duration = settings.antiSpamMuteDuration || 60000;
                        await member.timeout(duration, `Warning threshold hit (${warningCount} warnings)`);
                        thresholdActionTaken = `\n\n⚡ **Threshold Action:** User timed out for ${duration / 60000} minute(s).`;
                        await Case.create({
                            guildId: interaction.guild.id, userId: user.id,
                            moderatorId: interaction.client.user.id, type: 'MUTE',
                            reason: `Auto-mute: Warning threshold reached (${warningCount} warnings)`,
                            status: 'active', duration
                        });
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        thresholdActionTaken = '\n\n⚠️ **Threshold Action Failed:** Nora lacks permissions or the target has a higher role.';
                    } else {
                        thresholdActionTaken = `\n\n⚠️ **Threshold Action Failed:** ${err.message}`;
                    }
                }
            } else if (member) {
                thresholdActionTaken = '\n\n⚠️ **Threshold Action Skipped:** Target user is not moderatable by Nora.';
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Warning Issued')
            .setColor(SEVERITY_COLORS[severity] || 0xFFAA00)
            .addFields(
                { name: 'User', value: `${user.tag} (\`${user.id}\`)`, inline: true },
                { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Severity', value: SEVERITY_BADGES[severity], inline: true },
                { name: 'Reason', value: reason, inline: false },
                { name: 'Warning ID', value: `\`#${warning.id}\``, inline: true },
                { name: 'Case ID', value: `\`#${caseRecord.id}\``, inline: true },
                { name: 'Active Warnings', value: `**${warningCount}**`, inline: true }
            )
            .setTimestamp();

        if (thresholdActionTaken) {
            embed.setDescription(thresholdActionTaken.trim());
        }

        await interaction.reply({ embeds: [embed] });

        // DM the user
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle(`⚠️ Warning in ${interaction.guild.name}`)
                .setColor(SEVERITY_COLORS[severity])
                .addFields(
                    { name: 'Reason', value: reason },
                    { name: 'Severity', value: SEVERITY_BADGES[severity], inline: true },
                    { name: 'Active Warnings', value: `**${warningCount}**`, inline: true }
                )
                .setTimestamp();
            await user.send({ embeds: [dmEmbed] });
        } catch (err) {
            // DM failures are non-critical
        }
    },

    async handleView(interaction) {
        const user = interaction.options.getUser('user');

        const [activeWarnings, totalCount] = await Promise.all([
            Warning.findAll({
                where: { userId: user.id, guildId: interaction.guild.id, active: true },
                order: [['timestamp', 'DESC']],
                limit: 10
            }),
            Warning.count({
                where: { userId: user.id, guildId: interaction.guild.id }
            })
        ]);

        const activeCount = await Warning.count({
            where: { userId: user.id, guildId: interaction.guild.id, active: true }
        });

        const inactiveCount = totalCount - activeCount;

        const embed = new EmbedBuilder()
            .setTitle(`⚠️ Warnings — ${user.tag}`)
            .setColor(activeCount > 0 ? 0xFFAA00 : 0x43b581)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Active', value: `**${activeCount}**`, inline: true },
                { name: 'Cleared', value: `**${inactiveCount}**`, inline: true },
                { name: 'Total', value: `**${totalCount}**`, inline: true }
            );

        if (activeWarnings.length > 0) {
            const warningList = activeWarnings.map(w => {
                const ts = Math.floor(w.timestamp.getTime() / 1000);
                const badge = SEVERITY_BADGES[w.severity] || '🟡 Medium';
                const edited = w.editedAt ? ` *(edited)*` : '';
                return `**#${w.id}** · ${badge}\n> **Mod:** <@${w.moderatorId}>\n> **Reason:** ${w.reason}${edited}\n> <t:${ts}:R>`;
            }).join('\n\n');

            embed.addFields({ name: `Recent Active Warnings (${Math.min(activeWarnings.length, 10)} shown)`, value: warningList });
        } else {
            embed.setDescription('This user has no active warnings. 🎉');
        }

        await interaction.reply({ embeds: [embed] });
    },

    async handleRemove(interaction) {
        const id = interaction.options.getInteger('id');

        const warning = await Warning.findOne({
            where: { id, guildId: interaction.guild.id }
        });

        if (!warning) {
            return await handleError(interaction, 'Warning Not Found', `No warning exists with ID \`#${id}\` in this server.`);
        }

        if (!warning.active) {
            return await handleError(interaction, 'Already Removed', `Warning \`#${id}\` has already been deactivated.`);
        }

        await warning.update({
            active: false,
            editedBy: interaction.user.id,
            editedAt: new Date()
        });

        return await handleSuccess(
            interaction,
            'Warning Removed',
            `Warning **#${id}** for <@${warning.userId}> has been deactivated.\n**Original reason:** ${warning.reason}\n**Removed by:** <@${interaction.user.id}>`
        );
    },

    async handleClear(interaction) {
        const user = interaction.options.getUser('user');

        const [clearedCount] = await Warning.update(
            { active: false, editedBy: interaction.user.id, editedAt: new Date() },
            { where: { userId: user.id, guildId: interaction.guild.id, active: true } }
        );

        if (clearedCount === 0) {
            return await handleError(interaction, 'No Warnings', `**${user.tag}** has no active warnings to clear.`);
        }

        return await handleSuccess(
            interaction,
            'Warnings Cleared',
            `Successfully deactivated **${clearedCount}** active warning(s) for **${user.tag}**.\n\n*These warnings remain in audit history but are no longer counted toward thresholds.*`
        );
    },

    async handleEdit(interaction) {
        const id = interaction.options.getInteger('id');
        const reason = interaction.options.getString('reason');

        const warning = await Warning.findOne({ where: { id, guildId: interaction.guild.id } });
        if (!warning) {
            return await handleError(interaction, 'Warning Not Found', `No warning exists with ID \`#${id}\` in this server.`);
        }

        const oldReason = warning.reason;
        await warning.update({
            reason,
            editedBy: interaction.user.id,
            editedAt: new Date()
        });

        return await handleSuccess(
            interaction,
            'Warning Updated',
            `Warning **#${id}** has been updated.\n**Old reason:** ${oldReason}\n**New reason:** ${reason}\n**Edited by:** <@${interaction.user.id}>`
        );
    }
};
