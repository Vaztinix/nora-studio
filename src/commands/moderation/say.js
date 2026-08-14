const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a custom text message to any channel.')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The plain text message to send. Use \\n for line breaks.')
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Target channel (defaults to current channel)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false))
        .addRoleOption(option => 
            option.setName('ping')
                .setDescription('Optional role to mention with the message')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('reply_to')
                .setDescription('Message ID to reply directly to')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    async execute(interaction) {
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        let messageText = interaction.options.getString('message');
        const pingRole = interaction.options.getRole('ping');
        const replyToId = interaction.options.getString('reply_to');

        if (messageText) messageText = messageText.replace(/\\n/g, '\n');

        let content = messageText || '';
        if (pingRole) {
            content = `<@&${pingRole.id}> ${content}`.trim();
        }

        const payload = { content };

        if (replyToId) {
            payload.reply = { messageReference: replyToId, failIfNotExists: false };
        }

        try {
            const sentMsg = await targetChannel.send(payload);
            return handleSuccess(
                interaction,
                'Message Sent',
                `Successfully transmitted message to <#${targetChannel.id}>. [Jump to Message](${sentMsg.url})`
            );
        } catch (error) {
            console.error('[Say Command] Error:', error);
            return handleError(interaction, 'Transmission Failed', `Failed to send message to <#${targetChannel.id}>. Check bot permissions in that channel.`);
        }
    },
};
