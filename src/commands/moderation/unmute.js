const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription("Remove a user's timeout with secure hierarchy checks.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption(option => option.setName('target').setDescription('The user to unmute').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the unmute')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        // 🛡️ Owner Immunity Guard
        if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Bypass', 'You cannot physically modify the Server Owner.');
        }

        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not in this server.');
        }

        if (!member.isCommunicationDisabled()) {
            return handleError(interaction, 'Not Muted', `The user <@${target.id}> is not currently timed out.`);
        }

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Error', `You cannot unmute <@${target.id}> because their highest role is equal to or higher than yours.`);
        }

        try {
            await member.timeout(null, reason);
            await handleSuccess(interaction, 'User Unmuted', `**${target.tag}**'s timeout has been removed.\n**Reason:** ${reason}`);
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to unmute the user.');
        }
    },
};
