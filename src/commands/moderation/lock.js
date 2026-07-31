const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const { logServerAction } = require('../../utils/actionLogger');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock a text or voice channel to prevent members from sending messages or joining.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addChannelOption(option => 
            option.setName('target')
                .setDescription('The channel to lock (default: current channel)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.PublicThread, ChannelType.PrivateThread)
                .setRequired(false)
        )
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for locking the channel')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const targetChannel = interaction.options.getChannel('target') || interaction.channel;
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Manage Channels** permission physically required to update channel overwrites.');
        }

        try {
            const overwrites = {
                SendMessages: false,
                SendMessagesInThreads: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false
            };

            if (targetChannel.type === ChannelType.GuildVoice) {
                overwrites.Connect = false;
            }

            await targetChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, overwrites, {
                reason: `Locked by ${interaction.user.tag}: ${reason}`
            });

            // Record action log for Nora's site accountability
            await logServerAction({
                guildId: interaction.guild.id,
                userId: interaction.user.id,
                username: interaction.user.tag,
                userAvatar: interaction.user.displayAvatarURL(),
                action: 'LOCK_CHANNEL',
                details: `Locked #${targetChannel.name} (${targetChannel.id}). Reason: ${reason}`
            }).catch(() => {});

            await handleSuccess(interaction, 'Channel Locked 🔒', `Successfully locked <#${targetChannel.id}>.\n**Reason:** ${reason}`);
        } catch (error) {
            console.error('[Lock Command Error]:', error);
            await handleError(interaction, 'Lock Failed', 'An unexpected error occurred while modifying channel permissions. Ensure the bot role is above the channel overwrites.');
        }
    },
};
