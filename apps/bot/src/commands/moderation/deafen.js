const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('deafen')
        .setDescription('Deafen a user in a voice channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers)
        .setDMPermission(false)
        .addUserOption(option => option.setName('target').setDescription('The user to deafen').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for deafening')),

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

        if (member.voice.serverDeaf) {
            return handleError(interaction, 'Already Deafened', `<@${target.id}> is already server deafened.`);
        }

        try {
            await member.voice.setDeaf(true, reason);
            await handleSuccess(interaction, 'User Deafened', `**${target.tag}** has been server deafened.\n**Reason:** ${reason}`);
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to deafen the user.');
        }
    },
};
