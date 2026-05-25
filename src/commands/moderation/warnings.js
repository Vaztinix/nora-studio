const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Warning = require('../../database/models/Warning');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('View warnings for a user.')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('The user to view warnings for')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),

    async execute(interaction) {
        const user = interaction.options.getUser('user');

        try {
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
                const warningList = warnings.map((w, index) => {
                    return `**ID: ${w.id}**\n**Moderator:** <@${w.moderatorId}>\n**Reason:** ${w.reason}\n**Date:** <t:${Math.floor(w.timestamp.getTime() / 1000)}:R>`;
                }).join('\n\n');

                embed.addFields({ name: 'Recent Warnings (Last 10)', value: warningList });
            } else {
                embed.setDescription(`This user has no warnings.`);
            }

            await interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error('Warnings Command Error:', err);
            await interaction.reply({ embeds: [handleError('Failed to fetch warnings.')], ephemeral: true });
        }
    },
};
