const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Warning = require('../../database/models/Warning');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('edit-warns')
        .setDescription('Edit the reason for a specific warning.')
        .addIntegerOption(opt => opt.setName('id').setDescription('The ID of the warning to edit').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('The new reason for the warning').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),

    async execute(interaction) {
        const id = interaction.options.getInteger('id');
        const reason = interaction.options.getString('reason');

        try {
            const warning = await Warning.findOne({ where: { id, guildId: interaction.guild.id } });
            if (!warning) return handleError(interaction, 'Warning not found', 'I could not find a warning with that ID in this server.');

            warning.reason = reason;
            await warning.save();

            return handleSuccess(interaction, 'Warning Updated', `The reason for warning **#${id}** has been updated to: \`${reason}\``);
        } catch (err) {
            console.error('Edit-Warns Error:', err);
            return handleError(interaction, 'Command Error', 'An error occurred while updating the warning.');
        }
    },
};
