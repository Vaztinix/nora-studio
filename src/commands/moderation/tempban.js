const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const TempBan = require('../../database/models/TempBan');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('tempban')
        .setDescription('Temporarily ban a user from the server.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setDMPermission(false)
        .addUserOption(option => option.setName('target').setDescription('The user to ban').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Duration (e.g. 30m, 2h, 1d)').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the ban')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        if (target.id === interaction.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot ban yourself.');
        }

        if (target.id === interaction.client.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot ban me using my own command!');
        }

        if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Bypass', 'You cannot modify the Server Owner.');
        }

        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
            return handleError(interaction, 'Invalid Duration', 'Please provide a valid duration (e.g., `30m` for 30 minutes, `2h` for 2 hours, `1d` for 1 day).');
        }

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not in this server.');
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
            const unbanTime = new Date(Date.now() + durationMs);
            await member.ban({ reason: `[TempBan: ${durationStr}] ${reason}` });
            
            await TempBan.create({
                guildId: interaction.guild.id,
                userId: target.id,
                unbanTime
            });

            await handleSuccess(interaction, 'User Temporarily Banned', `**${target.tag}** has been banned successfully.\n**Duration:** ${durationStr}\n**Reason:** ${reason}`);
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to temporarily ban the user.');
        }
    },
};

function parseDuration(str) {
    const regex = /^(\d+)([smhd])$/i;
    const match = str.match(regex);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}
