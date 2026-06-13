const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Modify the slowmode of a selected channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addIntegerOption(option => 
            option.setName('duration')
                .setDescription('Slowmode duration in seconds (0 to disable)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(21600)
        )
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to modify (default: current channel)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const duration = interaction.options.getInteger('duration');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        if (!targetChannel.isTextBased()) {
            return handleError(interaction, 'Invalid Channel', 'Slowmode can only be applied to text-based channels.');
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Manage Channels** permission. Please update my roles.');
        }

        try {
            await targetChannel.setRateLimitPerUser(duration, `Requested by ${interaction.user.tag}`);
            if (duration === 0) {
                await handleSuccess(interaction, 'Slowmode Disabled', `Slowmode has been disabled for <#${targetChannel.id}>.`);
            } else {
                await handleSuccess(interaction, 'Slowmode Updated', `Slowmode for <#${targetChannel.id}> has been set to **${duration} seconds**.`);
            }
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while updating the channel slowmode.');
        }
    },
};
