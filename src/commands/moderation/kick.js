const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const Case = require('../../database/models/Case');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user from the server with detailed logging.')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .setDMPermission(false)
        .addUserOption(option => option.setName('target').setDescription('The user to kick').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the kick')),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') ?? 'No reason provided';
        
        if (target.id === interaction.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot kick yourself.');
        }

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not in this server.');
        }

        // 🛡️ Owner Immunity Guard
        if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Bypass', 'You cannot physically modify the Server Owner.');
        }

        if (!member.kickable) {
            return handleError(interaction, 'Missing Permissions', `I cannot kick <@${target.id}>. Their roles may be higher or they are the owner.`);
        }

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Error', `You cannot kick <@${target.id}> because their highest role is equal to or higher than yours.`);
        }

        try {
            await member.kick(reason);
            const caseRecord = await Case.create({
                guildId: interaction.guild.id,
                userId: target.id,
                moderatorId: interaction.user.id,
                type: 'KICK',
                reason,
                status: 'active'
            });
            await handleSuccess(interaction, 'User Kicked', `**${target.tag}** has been kicked successfully.\n**Reason:** ${reason}\n**Case:** #${caseRecord.id}`);
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to kick the user.');
        }
    },
};
