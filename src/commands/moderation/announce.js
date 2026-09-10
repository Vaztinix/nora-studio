const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Create a formatted announcement embed in a designated channel.')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to post the announcement to')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true))
        .addStringOption(option => 
            option.setName('title')
                .setDescription('The announcement headline')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The announcement text. Supports standard Markdown and \\n for newlines.')
                .setRequired(true))
        .addRoleOption(option => 
            option.setName('ping')
                .setDescription('Role to mention with the announcement')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('color')
                .setDescription('Hex color code (e.g. #5865F2, #57F287, #ED4245)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('image')
                .setDescription('Direct image URL to display at the bottom')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('thumbnail')
                .setDescription('Direct image URL for thumbnail')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    async execute(interaction) {
        const targetChannel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title');
        const message = interaction.options.getString('message').replace(/\\n/g, '\n');
        const pingRole = interaction.options.getRole('ping');
        const imageUrl = interaction.options.getString('image');
        const thumbnailUrl = interaction.options.getString('thumbnail');
        let colorHex = interaction.options.getString('color') || '#5865F2';

        if (!colorHex.startsWith('#')) {
            colorHex = '#' + colorHex;
        }

        const hexRegex = /^#([0-9A-F]{3}){1,2}$/i;
        if (!hexRegex.test(colorHex)) {
            colorHex = '#5865F2';
        }

        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: interaction.guild.name, 
                iconURL: interaction.guild.iconURL() 
            })
            .setTitle(title)
            .setDescription(message)
            .setColor(colorHex)
            .setFooter({ 
                text: `Announcement by ${interaction.user.tag}`
            })
            .setTimestamp();

        if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
            embed.setImage(imageUrl);
        }

        if (thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl)) {
            embed.setThumbnail(thumbnailUrl);
        }

        let content = '';
        if (pingRole) {
            content = `<@&${pingRole.id}>`;
        }

        try {
            const sentMsg = await targetChannel.send({ content: content || null, embeds: [embed] });
            return handleSuccess(
                interaction, 
                'Announcement Sent', 
                `Posted in <#${targetChannel.id}>. [Jump to Announcement](${sentMsg.url})`
            );
        } catch (error) {
            console.error('[Announce Command] Failed to post message:', error);
            return handleError(
                interaction, 
                'Permission Error', 
                'I do not have the required permissions to send embeds or messages in that channel.'
            );
        }
    },
};
