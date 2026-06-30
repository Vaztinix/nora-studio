const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('channel')
        .setDescription('Channel moderation management commands.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('lock')
                .setDescription('Remove the send messages permission from the channel.')
                .addChannelOption(option => 
                    option.setName('target')
                        .setDescription('The channel to lock (default: current)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
                .addStringOption(option => 
                    option.setName('reason')
                        .setDescription('Reason for locking the channel')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unlock')
                .setDescription('Add the send messages permission back to the channel.')
                .addChannelOption(option => 
                    option.setName('target')
                        .setDescription('The channel to unlock (default: current)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
                .addStringOption(option => 
                    option.setName('reason')
                        .setDescription('Reason for unlocking the channel')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();
        const targetChannel = interaction.options.getChannel('target') || interaction.channel;
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        if (!targetChannel.isTextBased()) {
            return handleError(interaction, 'Invalid Channel', 'You can only lock or unlock text-based channels.');
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Manage Channels** permission physically required to update channel overwrites.');
        }

        try {
            if (subcommand === 'lock') {
                await targetChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                    SendMessages: false
                }, { reason: `Locked by ${interaction.user.tag}: ${reason}` });

                await handleSuccess(interaction, 'Channel Locked', `Successfully locked <#${targetChannel.id}>.\n**Reason:** ${reason}`);
            } else if (subcommand === 'unlock') {
                // Setting to null removes the explicit deny override, reverting to default role behaviors
                await targetChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                    SendMessages: null
                }, { reason: `Unlocked by ${interaction.user.tag}: ${reason}` });

                await handleSuccess(interaction, 'Channel Unlocked', `Successfully unlocked <#${targetChannel.id}>.\n**Reason:** ${reason}`);
            }
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while modifying channel permissions.');
        }
    },
};
