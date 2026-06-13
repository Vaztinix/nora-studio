const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('undeafen')
        .setDescription('Undeafen a user in a voice channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers)
        .setDMPermission(false)
        .addUserOption(option => option.setName('target').setDescription('The user to undeafen').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for undeafening')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not in this server.');
        }

        if (!member.voice.channelId) {
            return handleError(interaction, 'Not in Voice', `<@${target.id}> is not connected to a voice channel.`);
        }

        if (!member.voice.serverDeaf) {
            return handleError(interaction, 'Not Deafened', `<@${target.id}> is not server deafened.`);
        }

        try {
            await member.voice.setDeaf(false, reason);
            await handleSuccess(interaction, 'User Undeafened', `**${target.tag}** has been server undeafened.\n**Reason:** ${reason}`);
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to undeafen the user.');
        }
    },
};
