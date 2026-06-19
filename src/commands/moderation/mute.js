const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const Case = require('../../database/models/Case');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Time out a user with robust error handling.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption(option => option.setName('target').setDescription('The user to mute').setRequired(true))
        .addIntegerOption(option => option.setName('duration').setDescription('Duration in minutes (max 28 days -> 40320 min)').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the mute')),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason') ?? 'No reason provided';
        
        if (target.id === interaction.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot mute yourself.');
        }

        // 🛡️ Owner Immunity Guard
        if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Bypass', 'You cannot physically modify the Server Owner.');
        }

        if (duration <= 0 || duration > 40320) {
            return handleError(interaction, 'Invalid Duration', 'Duration must be between 1 and 40,320 minutes (28 days max due to Discord limitations).');
        }

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not in this server.');
        }
        
        if (member.isCommunicationDisabled()) {
            return handleError(interaction, 'Already Muted', `The user <@${target.id}> is already timed out.`);
        }

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Error', `You cannot mute <@${target.id}> because their highest role is equal to or higher than yours.`);
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Timeout Members** permission. Please update my roles.');
        }

        if (interaction.guild.members.me.roles.highest.position <= member.roles.highest.position) {
            return handleError(interaction, 'Bot Hierarchy Error', `I cannot mute <@${target.id}> because their highest role is equal to or higher than my highest role.`);
        }

        try {
            await member.timeout(duration * 60 * 1000, reason);
            const caseRecord = await Case.create({
                guildId: interaction.guild.id,
                userId: target.id,
                moderatorId: interaction.user.id,
                type: 'MUTE',
                reason,
                status: 'active',
                duration: duration * 60 * 1000
            });
            await handleSuccess(interaction, 'User Muted', `**${target.tag}** has been timed out for ${duration} minute(s).\n**Reason:** ${reason}\n**Case:** #${caseRecord.id}`);
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to mute the user. Check my permissions or hierarchy.');
        }
    },
};
