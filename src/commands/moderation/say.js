const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a plain text message to a specific channel.')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to send the message to')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true))
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The text to send. Use \\n for newlines.')
                .setRequired(true))
        .addRoleOption(option => 
            option.setName('ping')
                .setDescription('A role to mention with the message')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    async execute(interaction) {
        const targetChannel = interaction.options.getChannel('channel');
        let message = interaction.options.getString('message').replace(/\\n/g, '\n');
        const pingRole = interaction.options.getRole('ping');

        if (pingRole) {
            message = `<@&${pingRole.id}>\n${message}`;
        }

        try {
            await targetChannel.send({ content: message });
            return handleSuccess(interaction, 'Message Sent', `Your message was successfully sent to <#${targetChannel.id}>.`);
        } catch (error) {
            console.error('[Say Command] Failed to send message:', error);
            return handleError(interaction, 'Transmission Error', 'I do not have the required permissions to send messages in that channel.');
        }
    },
};
