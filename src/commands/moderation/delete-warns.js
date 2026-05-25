const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Warning = require('../../database/models/Warning');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('delete-warns')
        .setDescription('Delete a specific warning by its ID.')
        .addIntegerOption(opt => opt.setName('id').setDescription('The ID of the warning to delete').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),

    async execute(interaction) {
        const id = interaction.options.getInteger('id');

        try {
            const deleted = await Warning.destroy({ where: { id, guildId: interaction.guild.id } });
            if (!deleted) return interaction.reply({ embeds: [handleError(interaction, 'Warning not found', 'I could not find a warning with that ID to delete.')], ephemeral: true });

            return handleSuccess(interaction, 'Warning Deleted', `Warning **#${id}** has been physically removed from the database.`);
        } catch (err) {
            console.error('Delete-Warns Error:', err);
            return handleError(interaction, 'Command Error', 'An error occurred while deleting the warning.');
        }
    },
};
