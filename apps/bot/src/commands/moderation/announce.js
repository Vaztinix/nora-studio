const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Create a beautiful embedded announcement in a specific channel.')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to send the announcement to')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true))
        .addStringOption(option => 
            option.setName('title')
                .setDescription('The title of the announcement')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The main text of the announcement. Use \\n for newlines if needed.')
                .setRequired(true))
        .addRoleOption(option => 
            option.setName('ping')
                .setDescription('A role to mention with the announcement')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('color')
                .setDescription('Hex color code (e.g. #FF5555) for the embed sidebar')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    async execute(interaction) {
        const targetChannel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title');
        const message = interaction.options.getString('message').replace(/\\n/g, '\n');
        const pingRole = interaction.options.getRole('ping');
        let colorHex = interaction.options.getString('color') || '#57acf2';

        if (!colorHex.startsWith('#')) {
            colorHex = '#' + colorHex;
        }

        // Validate hex code
        const hexRegex = /^#([0-9A-F]{3}){1,2}$/i;
        if (!hexRegex.test(colorHex)) {
            colorHex = '#57acf2'; // Fallback to default Nora blue
        }

        // Create the embed
        const embed = new EmbedBuilder()
            .setTitle(`📢 ${title}`)
            .setDescription(message)
            .setColor(colorHex)
            .setTimestamp()
            .setFooter({ 
                text: `Announcement • Sent by ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
            });

        let content = '';
        if (pingRole) {
            content = `<@&${pingRole.id}>`;
        }

        try {
            await targetChannel.send({ content: content || null, embeds: [embed] });
            return handleSuccess(interaction, 'Announcement Sent', `Your announcement has been physically broadcast to <#${targetChannel.id}>.`);
        } catch (error) {
            console.error('[Announce Command] Failed to send message:', error);
            return handleError(interaction, 'Transmission Error', 'I do not have the required permissions to send embedded messages in that channel.');
        }
    },
};
