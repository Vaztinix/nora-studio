const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Warning = require('../../database/models/Warning');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Add a warning to a user.')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('The user to warn')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('The reason for the warning')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),

    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.guild.members.cache.get(user.id);

        if (user.id === interaction.user.id) {
            return handleError(interaction, 'Action Blocked', 'You cannot warn yourself.');
        }

        if (user.id === interaction.client.user.id) {
            return handleError(interaction, 'Action Blocked', 'You cannot warn me.');
        }

        if (member && member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Violation', 'You cannot warn someone with a higher or equal role.');
        }

        try {
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

            const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
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

        } catch (err) {
            console.error('Warn Command Error:', err);
            return handleError(interaction, 'Database Error', 'Failed to record warning.');
        }
    },
};
