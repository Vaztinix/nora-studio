const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Warning = require('../../database/models/Warning');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('clear-warns')
        .setDescription('Wipe all warnings for a specific user.')
        .addUserOption(opt => opt.setName('user').setDescription('The user to clear warnings for').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),

    async execute(interaction) {
        const user = interaction.options.getUser('user');

        try {
            const deletedCount = await Warning.destroy({ where: { userId: user.id, guildId: interaction.guild.id } });
            
            return handleSuccess(interaction, 'Warnings Cleared', `Successfully purged **${deletedCount}** warnings for **${user.tag}**.`);
        } catch (err) {
            console.error('Clear-Warns Error:', err);
            return handleError(interaction, 'Command Error', 'An error occurred while clearing the warnings.');
        }
    },
};
