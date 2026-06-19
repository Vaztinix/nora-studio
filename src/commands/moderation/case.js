const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Case = require('../../database/models/Case');
const { handleError, handleSuccess } = require('../../utils/embeds');

// Type badge and color mapping
const TYPE_BADGES = {
    'WARN': '⚠️ Warning',
    'MUTE': '🔇 Mute',
    'UNMUTE': '🔊 Unmute',
    'KICK': '👢 Kick',
    'BAN': '🔨 Ban',
    'UNBAN': '🔓 Unban',
    'TEMPBAN': '⏱️ Temp Ban',
    'ROLE_ADD': '➕ Role Add',
    'ROLE_REMOVE': '➖ Role Remove'
};

const TYPE_COLORS = {
    'WARN': 0xfaa61a,
    'MUTE': 0x99aab5,
    'UNMUTE': 0x43b581,
    'KICK': 0xf47b67,
    'BAN': 0xed4245,
    'UNBAN': 0x43b581,
    'TEMPBAN': 0xe67e22,
    'ROLE_ADD': 0x5865f2,
    'ROLE_REMOVE': 0x5865f2
};

const STATUS_BADGES = {
    'active': '🟢 Active',
    'resolved': '✅ Resolved',
    'appealed': '📋 Appealed',
    'expired': '⏰ Expired'
};

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('Moderation case management system.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View the details of a specific case.')
                .addIntegerOption(opt =>
                    opt.setName('number')
                        .setDescription('The case number')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('Edit the reason for a specific case.')
                .addIntegerOption(opt =>
                    opt.setName('number')
                        .setDescription('The case number')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('The new reason')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('history')
                .setDescription('View all moderation cases for a user.')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('The user to view case history for')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('Filter by case type')
                        .setRequired(false)
                        .addChoices(
                            { name: '⚠️ Warning', value: 'WARN' },
                            { name: '🔇 Mute', value: 'MUTE' },
                            { name: '👢 Kick', value: 'KICK' },
                            { name: '🔨 Ban', value: 'BAN' },
                            { name: '⏱️ Temp Ban', value: 'TEMPBAN' }
                        )))
        .addSubcommand(sub =>
            sub.setName('resolve')
                .setDescription('Mark a case as resolved.')
                .addIntegerOption(opt =>
                    opt.setName('number')
                        .setDescription('The case number')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'view':
                    return await this.handleView(interaction);
                case 'edit':
                    return await this.handleEdit(interaction);
                case 'history':
                    return await this.handleHistory(interaction);
                case 'resolve':
                    return await this.handleResolve(interaction);
                default:
                    return await handleError(interaction, 'Unknown Subcommand', 'Nora doesn\'t recognize this case command action.');
            }
        } catch (err) {
            console.error(`Error executing case ${subcommand}:`, err);
            return await handleError(interaction, 'Execution Error', 'An error occurred while processing the case command.');
        }
    },

    async handleView(interaction) {
        const number = interaction.options.getInteger('number');

        const c = await Case.findOne({
            where: { id: number, guildId: interaction.guild.id }
        });

        if (!c) {
            return await handleError(interaction, 'Case Not Found', `No case exists with number \`#${number}\`.`);
        }

        const targetUser = await interaction.client.users.fetch(c.userId).catch(() => null);
        const moderator = await interaction.client.users.fetch(c.moderatorId).catch(() => null);

        // Normalize type for backward compat with old 'action' values
        const caseType = (c.type || c.getDataValue('type') || 'WARN').toUpperCase();
        const typeBadge = TYPE_BADGES[caseType] || `📁 ${caseType}`;
        const typeColor = TYPE_COLORS[caseType] || 0x57acf2;
        const statusBadge = STATUS_BADGES[c.status] || '🟢 Active';

        const embed = new EmbedBuilder()
            .setTitle(`📋 Case #${c.id}`)
            .setColor(typeColor)
            .addFields(
                { name: 'Type', value: typeBadge, inline: true },
                { name: 'Status', value: statusBadge, inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                { name: 'Target', value: targetUser ? `${targetUser.tag} (\`${targetUser.id}\`)` : `\`${c.userId}\``, inline: true },
                { name: 'Moderator', value: moderator ? `${moderator.tag} (\`${moderator.id}\`)` : `\`${c.moderatorId}\``, inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                { name: 'Reason', value: c.reason || 'No reason provided', inline: false },
                { name: 'Issued', value: `<t:${Math.floor(c.timestamp.getTime() / 1000)}:F> (<t:${Math.floor(c.timestamp.getTime() / 1000)}:R>)`, inline: false }
            )
            .setTimestamp(c.timestamp);

        // Optional fields
        if (c.duration) {
            const mins = Math.round(c.duration / 60000);
            const display = mins >= 1440 ? `${Math.round(mins / 1440)} day(s)` : mins >= 60 ? `${Math.round(mins / 60)} hour(s)` : `${mins} minute(s)`;
            embed.addFields({ name: 'Duration', value: display, inline: true });
        }

        if (c.linkedWarningId) {
            embed.addFields({ name: 'Linked Warning', value: `\`#${c.linkedWarningId}\``, inline: true });
        }

        const evidence = c.evidenceUrls;
        if (evidence && evidence.length > 0) {
            embed.addFields({ name: 'Evidence', value: evidence.map((url, i) => `[Attachment ${i + 1}](${url})`).join(' · '), inline: false });
        }

        if (c.editedAt) {
            const editedUser = c.editedBy ? await interaction.client.users.fetch(c.editedBy).catch(() => null) : null;
            embed.setFooter({
                text: `Last edited by ${editedUser ? editedUser.tag : c.editedBy} · ${new Date(c.editedAt).toLocaleString()}`
            });
        }

        if (targetUser) {
            embed.setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));
        }

        await interaction.reply({ embeds: [embed] });
    },

    async handleEdit(interaction) {
        const number = interaction.options.getInteger('number');
        const reason = interaction.options.getString('reason');

        const c = await Case.findOne({
            where: { id: number, guildId: interaction.guild.id }
        });

        if (!c) {
            return await handleError(interaction, 'Case Not Found', `No case exists with number \`#${number}\`.`);
        }

        const oldReason = c.reason;
        await c.update({
            reason,
            editedBy: interaction.user.id,
            editedAt: new Date()
        });

        return await handleSuccess(
            interaction,
            'Case Updated',
            `Case **#${number}** has been updated.\n**Old reason:** ${oldReason}\n**New reason:** ${reason}\n**Edited by:** <@${interaction.user.id}>`
        );
    },

    async handleHistory(interaction) {
        const user = interaction.options.getUser('user');
        const typeFilter = interaction.options.getString('type');

        const where = { userId: user.id, guildId: interaction.guild.id };
        if (typeFilter) where.type = typeFilter;

        const cases = await Case.findAll({
            where,
            order: [['timestamp', 'DESC']],
            limit: 15
        });

        const totalCount = await Case.count({ where: { userId: user.id, guildId: interaction.guild.id } });

        const embed = new EmbedBuilder()
            .setTitle(`📋 Case History — ${user.tag}`)
            .setColor(0x57acf2)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }));

        if (cases.length > 0) {
            // Summary counts
            const allCases = await Case.findAll({
                where: { userId: user.id, guildId: interaction.guild.id },
                attributes: ['type']
            });
            const typeCounts = {};
            allCases.forEach(c => {
                const t = (c.type || '').toUpperCase();
                typeCounts[t] = (typeCounts[t] || 0) + 1;
            });
            const summary = Object.entries(typeCounts)
                .map(([t, count]) => `${TYPE_BADGES[t] || t}: **${count}**`)
                .join(' · ');

            embed.setDescription(`**Total Cases:** ${totalCount}\n${summary}`);

            const caseList = cases.map(c => {
                const ts = Math.floor(c.timestamp.getTime() / 1000);
                const caseType = (c.type || '').toUpperCase();
                const badge = TYPE_BADGES[caseType] || `📁 ${caseType}`;
                const statusIcon = c.status === 'resolved' ? ' ✅' : c.status === 'appealed' ? ' 📋' : '';
                return `**#${c.id}** · ${badge}${statusIcon}\n> ${c.reason.substring(0, 80)}${c.reason.length > 80 ? '...' : ''}\n> <t:${ts}:R> · Mod: <@${c.moderatorId}>`;
            }).join('\n\n');

            embed.addFields({
                name: `Recent Cases (${Math.min(cases.length, 15)} shown${typeFilter ? ` · Filtered: ${TYPE_BADGES[typeFilter]}` : ''})`,
                value: caseList
            });
        } else {
            embed.setDescription(typeFilter
                ? `No **${TYPE_BADGES[typeFilter]}** cases found for this user.`
                : 'This user has no moderation cases on record. 🎉');
        }

        await interaction.reply({ embeds: [embed] });
    },

    async handleResolve(interaction) {
        const number = interaction.options.getInteger('number');

        const c = await Case.findOne({
            where: { id: number, guildId: interaction.guild.id }
        });

        if (!c) {
            return await handleError(interaction, 'Case Not Found', `No case exists with number \`#${number}\`.`);
        }

        if (c.status === 'resolved') {
            return await handleError(interaction, 'Already Resolved', `Case \`#${number}\` is already marked as resolved.`);
        }

        await c.update({
            status: 'resolved',
            editedBy: interaction.user.id,
            editedAt: new Date()
        });

        const caseType = (c.type || '').toUpperCase();
        return await handleSuccess(
            interaction,
            'Case Resolved',
            `Case **#${number}** (${TYPE_BADGES[caseType] || caseType}) has been marked as **resolved**.\n**Resolved by:** <@${interaction.user.id}>`
        );
    }
};
