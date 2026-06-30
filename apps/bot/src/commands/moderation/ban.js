const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const Case = require('../../database/models/Case');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server with detailed logging.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setDMPermission(false)
        .addUserOption(option => option.setName('target').setDescription('The user to ban').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the ban')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        if (target.id === interaction.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot ban yourself.');
        }

        if (target.id === interaction.client.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot ban me using my own command!');
        }

        // 🛡️ Owner Immunity Guard
        if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Bypass', 'You cannot modify the Server Owner.');
        }

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not in this server. They may have already left or the ID is incorrect.');
        }

        if (!member.bannable) {
            return handleError(interaction, 'Missing Permissions', `I cannot ban <@${target.id}>. Their role might be higher than mine, or they are the server owner.`);
        }

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Error', `You cannot ban <@${target.id}> because their highest role is equal to or higher than yours.`);
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Ban Members** permission. Please update my roles.');
        }

        if (interaction.guild.members.me.roles.highest.position <= member.roles.highest.position) {
            return handleError(interaction, 'Bot Hierarchy Error', `I cannot ban <@${target.id}> because their highest role is equal to or higher than my highest role.`);
        }

        try {
            await member.ban({ reason });
            const caseRecord = await Case.create({
                guildId: interaction.guild.id,
                userId: target.id,
                moderatorId: interaction.user.id,
                type: 'BAN',
                reason,
                status: 'active'
            });
            await handleSuccess(interaction, 'User Banned', `**${target.tag}** has been banned successfully.\n**Reason:** ${reason}\n**Case:** #${caseRecord.id}`);
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to ban the user. Please check my permissions and try again.');
        }
    },
};