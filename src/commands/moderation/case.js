const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Case = require('../../database/models/Case');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('Case management system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the details of a case')
                .addIntegerOption(option =>
                    option.setName('number')
                        .setDescription('The case number')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a case number from a user')
                .addIntegerOption(option =>
                    option.setName('number')
                        .setDescription('The case number')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const number = interaction.options.getInteger('number');

        try {
            if (subcommand === 'view') {
                const c = await Case.findOne({
                    where: { id: number, guildId: interaction.guild.id }
                });

                if (!c) {
                    return await handleError(interaction, 'Case Not Found', `No case exists with number ${number}.`);
                }

                const targetUser = await interaction.client.users.fetch(c.userId).catch(() => null);
                const moderator = await interaction.client.users.fetch(c.moderatorId).catch(() => null);

                const embed = new EmbedBuilder()
                    .setTitle(`Case ${c.id}`)
                    .setColor(0x57acf2)
                    .addFields(
                        { name: 'User', value: targetUser ? `${targetUser.tag} (${targetUser.id})` : c.userId, inline: true },
                        { name: 'Moderator', value: moderator ? `${moderator.tag} (${moderator.id})` : c.moderatorId, inline: true },
                        { name: 'Action', value: c.action, inline: true },
                        { name: 'Reason', value: c.reason, inline: false },
                        { name: 'Timestamp', value: `<t:${Math.floor(c.timestamp.getTime() / 1000)}:F>`, inline: false }
                    )
                    .setTimestamp(c.timestamp);

                return await interaction.reply({ embeds: [embed] });
            } else if (subcommand === 'remove') {
                const deleted = await Case.destroy({
                    where: { id: number, guildId: interaction.guild.id }
                });

                if (!deleted) {
                    return await handleError(interaction, 'Case Not Found', `No case exists with number ${number}.`);
                }

                return await handleSuccess(interaction, 'Case Removed', `Case number ${number} has been removed.`);
            }
        } catch (err) {
            console.error(`Error executing case command:`, err);
            return await handleError(interaction, 'Error', 'An error occurred while managing the case.');
        }
    }
};
