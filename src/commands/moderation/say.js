const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess, COLORS } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a custom formatted text message or rich embed to any channel.')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The plain text message to send. Use \\n for line breaks.')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Target channel (defaults to current channel)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false))
        .addStringOption(option => 
            option.setName('embed_title')
                .setDescription('Title for a rich embed card')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('embed_description')
                .setDescription('Description body for the rich embed card. Use \\n for line breaks.')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('embed_color')
                .setDescription('Color tint for the embed')
                .setRequired(false)
                .addChoices(
                    { name: 'Indigo (Default)', value: 'DEFAULT' },
                    { name: 'Emerald Green', value: 'SUCCESS' },
                    { name: 'Crimson Red', value: 'ERROR' },
                    { name: 'Amber Gold', value: 'WARNING' },
                    { name: 'Radiant Blue', value: 'INFO' },
                    { name: 'Royal Violet', value: 'PURPLE' },
                    { name: 'Midnight Dark', value: 'DARK' }
                ))
        .addStringOption(option => 
            option.setName('embed_image')
                .setDescription('Image URL to attach inside the embed')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('embed_thumbnail')
                .setDescription('Thumbnail URL for top-right of the embed')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('embed_footer')
                .setDescription('Custom footer text')
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
        const embedTitle = interaction.options.getString('embed_title');
        let embedDesc = interaction.options.getString('embed_description');
        const colorKey = interaction.options.getString('embed_color') || 'DEFAULT';
        const embedImage = interaction.options.getString('embed_image');
        const embedThumbnail = interaction.options.getString('embed_thumbnail');
        const embedFooter = interaction.options.getString('embed_footer');
        const pingRole = interaction.options.getRole('ping');
        const replyToId = interaction.options.getString('reply_to');

        if (!messageText && !embedTitle && !embedDesc) {
            return handleError(interaction, 'Input Required', 'Please provide either a `message` or an `embed_title` / `embed_description`.');
        }

        if (messageText) messageText = messageText.replace(/\\n/g, '\n');
        if (embedDesc) embedDesc = embedDesc.replace(/\\n/g, '\n');

        let content = messageText || '';
        if (pingRole) {
            content = `<@&${pingRole.id}> ${content}`.trim();
        }

        const payload = {};
        if (content.length > 0) payload.content = content;

        if (embedTitle || embedDesc || embedImage || embedThumbnail) {
            const embed = new EmbedBuilder()
                .setColor(COLORS[colorKey] || COLORS.DEFAULT)
                .setTimestamp();

            if (embedTitle) embed.setTitle(embedTitle);
            if (embedDesc) embed.setDescription(embedDesc);
            if (embedImage) embed.setImage(embedImage);
            if (embedThumbnail) embed.setThumbnail(embedThumbnail);
            if (embedFooter) embed.setFooter({ text: embedFooter });

            payload.embeds = [embed];
        }

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
