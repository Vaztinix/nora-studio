const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const { logAction } = require('../../utils/actionLogger');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('deafen')
        .setDescription('Server deafen a member in a voice channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers)
        .setDMPermission(false)
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The member to deafen')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for the server deafen action')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not currently in this server.');
        }

        if (member.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Guard', 'The Server Owner cannot be deafened by staff.');
        }

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Error', `You cannot deafen <@${target.id}> because their highest role is equal to or higher than yours.`);
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.DeafenMembers)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Deafen Members** permission. Please update my roles.');
        }

        if (interaction.guild.members.me.roles.highest.position <= member.roles.highest.position) {
            return handleError(interaction, 'Bot Hierarchy Error', `I cannot deafen <@${target.id}> because their highest role is equal to or higher than my highest role.`);
        }

        if (!member.voice.channelId) {
            return handleError(interaction, 'Not in Voice', `<@${target.id}> is not connected to any voice channel in this server.`);
        }

        if (member.voice.serverDeaf) {
            return handleError(interaction, 'Already Deafened', `<@${target.id}> is already server deafened.`);
        }

        try {
            await member.voice.setDeaf(true, `${reason} (Action by ${interaction.user.tag})`);
            
            await logAction(interaction.guild, {
                action: 'DEAFEN',
                moderator: interaction.user,
                target: target,
                reason: reason
            }).catch(() => {});

            await handleSuccess(
                interaction, 
                'Member Server Deafened', 
                `**${target.tag}** (<@${target.id}>) has been deafened in <#${member.voice.channelId}>.\n**Reason**: ${reason}`
            );
        } catch (error) {
            console.error('[Deafen Error]:', error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while attempting to deafen the user.');
        }
    },
};
