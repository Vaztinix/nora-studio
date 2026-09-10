const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const { logAction } = require('../../utils/actionLogger');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('undeafen')
        .setDescription('Undeafen a member in a voice channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers)
        .setDMPermission(false)
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The member to undeafen')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for undeafening')
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

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Error', `You cannot undeafen <@${target.id}> because their highest role is equal to or higher than yours.`);
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.DeafenMembers)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Deafen Members** permission. Please update my roles.');
        }

        if (!member.voice.channelId) {
            return handleError(interaction, 'Not in Voice', `<@${target.id}> is not connected to a voice channel.`);
        }

        if (!member.voice.serverDeaf) {
            return handleError(interaction, 'Not Deafened', `<@${target.id}> is not currently server deafened.`);
        }

        try {
            await member.voice.setDeaf(false, `${reason} (Action by ${interaction.user.tag})`);

            await logAction(interaction.guild, {
                action: 'UNDEAFEN',
                moderator: interaction.user,
                target: target,
                reason: reason
            }).catch(() => {});

            await handleSuccess(
                interaction, 
                'Member Undeafened', 
                `**${target.tag}** (<@${target.id}>) has been undeafened in <#${member.voice.channelId}>.\n**Reason**: ${reason}`
            );
        } catch (error) {
            console.error('[Undeafen Error]:', error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while attempting to undeafen the user.');
        }
    },
};
