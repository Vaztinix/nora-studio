const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Warning = require('../../database/models/Warning');
const settingsCache = require('../../utils/settingsCache');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warning management system.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a warning to a user.')
                .addUserOption(option => 
                    option.setName('user')
                        .setDescription('The user to warn')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('reason')
                        .setDescription('The reason for the warning')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View warnings for a user.')
                .addUserOption(option => 
                    option.setName('user')
                        .setDescription('The user to view warnings for')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Wipe all warnings for a specific user.')
                .addUserOption(option => 
                    option.setName('user')
                        .setDescription('The user to clear warnings for')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a specific warning by its ID.')
                .addIntegerOption(option => 
                    option.setName('id')
                        .setDescription('The ID of the warning to delete')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Edit the reason for a specific warning.')
                .addIntegerOption(option => 
                    option.setName('id')
                        .setDescription('The ID of the warning to edit')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('reason')
                        .setDescription('The new reason for the warning')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'add':
                    return await this.handleAdd(interaction);
                case 'list':
                    return await this.handleList(interaction);
                case 'clear':
                    return await this.handleClear(interaction);
                case 'delete':
                    return await this.handleDelete(interaction);
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
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.guild.members.cache.get(user.id);

        if (user.id === interaction.user.id) {
            return await handleError(interaction, 'Action Blocked', 'You cannot warn yourself.');
        }

        if (user.id === interaction.client.user.id) {
            return await handleError(interaction, 'Action Blocked', 'You cannot warn me.');
        }

        if (member && member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return await handleError(interaction, 'Hierarchy Violation', 'You cannot warn someone with a higher or equal role.');
        }

        // Create the warning
        await Warning.create({
            userId: user.id,
            guildId: interaction.guild.id,
            moderatorId: interaction.user.id,
            reason: reason
        });

        // Get total warnings for threshold check
        const warningCount = await Warning.count({
            where: {
                userId: user.id,
                guildId: interaction.guild.id
            }
        });

        // Use cache instead of direct GuildSettings query to optimize DB load
        const settings = await settingsCache.get(interaction.guild.id);
        let thresholdActionTaken = '';

        if (settings && settings.warningAction !== 'none' && warningCount >= settings.warningThreshold) {
            if (member && member.moderatable) {
                try {
                    if (settings.warningAction === 'kick') {
                        await member.kick(`Warning threshold hit (${warningCount} warnings)`);
                        thresholdActionTaken = '\n\n**Threshold Action:** User has been kicked.';
                    } else if (settings.warningAction === 'ban') {
                        await member.ban({ reason: `Warning threshold hit (${warningCount} warnings)` });
                        thresholdActionTaken = '\n\n**Threshold Action:** User has been banned.';
                    } else if (settings.warningAction === 'timeout') {
                        const duration = settings.antiSpamMuteDuration || 60000;
                        await member.timeout(duration, `Warning threshold hit (${warningCount} warnings)`);
                        thresholdActionTaken = `\n\n**Threshold Action:** User has been timed out for ${duration / 60000} minute(s).`;
                    }
                } catch (err) {
                    thresholdActionTaken = `\n\n**Threshold Action Failed:** ${err.message}`;
                }
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('User Warned')
            .setDescription(`**User:** ${user.tag} (${user.id})\n**Reason:** ${reason}\n**Total Warnings:** ${warningCount}${thresholdActionTaken}`)
            .setColor(0xFFAA00)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // DM the user
        try {
            await user.send(`You have been warned in **${interaction.guild.name}**.\n**Reason:** ${reason}\n**Total Warnings:** ${warningCount}`);
        } catch (err) {
            // Ignore DM failures
        }
    },

    async handleList(interaction) {
        const user = interaction.options.getUser('user');

        const warnings = await Warning.findAll({
            where: {
                userId: user.id,
                guildId: interaction.guild.id
            },
            order: [['timestamp', 'DESC']],
            limit: 10
        });

        const warningCount = await Warning.count({
            where: {
                userId: user.id,
                guildId: interaction.guild.id
            }
        });

        const embed = new EmbedBuilder()
            .setTitle(`Warnings for ${user.tag}`)
            .setDescription(`Total Warnings: **${warningCount}**`)
            .setColor(0x57acf2)
            .setThumbnail(user.displayAvatarURL());

        if (warnings.length > 0) {
            const warningList = warnings.map((w) => {
                return `**ID: ${w.id}**\n**Moderator:** <@${w.moderatorId}>\n**Reason:** ${w.reason}\n**Date:** <t:${Math.floor(w.timestamp.getTime() / 1000)}:R>`;
            }).join('\n\n');

            embed.addFields({ name: 'Recent Warnings (Last 10)', value: warningList });
        } else {
            embed.setDescription(`This user has no warnings.`);
        }

        await interaction.reply({ embeds: [embed] });
    },

    async handleClear(interaction) {
        const user = interaction.options.getUser('user');
        const deletedCount = await Warning.destroy({ where: { userId: user.id, guildId: interaction.guild.id } });
        
        return await handleSuccess(interaction, 'Warnings Cleared', `Successfully purged **${deletedCount}** warnings for **${user.tag}**.`);
    },

    async handleDelete(interaction) {
        const id = interaction.options.getInteger('id');
        const deleted = await Warning.destroy({ where: { id, guildId: interaction.guild.id } });
        
        if (!deleted) {
            return await handleError(interaction, 'Warning not found', 'I could not find a warning with that ID to delete.');
        }

        return await handleSuccess(interaction, 'Warning Deleted', `Warning **#${id}** has been physically removed from the database.`);
    },

    async handleEdit(interaction) {
        const id = interaction.options.getInteger('id');
        const reason = interaction.options.getString('reason');

        const warning = await Warning.findOne({ where: { id, guildId: interaction.guild.id } });
        if (!warning) {
            return await handleError(interaction, 'Warning not found', 'I could not find a warning with that ID in this server.');
        }

        warning.reason = reason;
        await warning.save();

        return await handleSuccess(interaction, 'Warning Updated', `The reason for warning **#${id}** has been updated to: \`${reason}\``);
    }
};

