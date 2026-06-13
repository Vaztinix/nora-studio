const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const ContentFeed = require('../../database/models/ContentFeed');
const { getYoutubeChannelId, checkYoutube } = require('../../utils/socialScraper');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('youtube')
        .setDescription('Manage YouTube notification feeds for the server.')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a YouTube channel for uploads/announcements.')
                .addStringOption(opt => opt.setName('url').setDescription('YouTube Channel URL, @handle, or direct UC Channel ID').setRequired(true))
                .addChannelOption(opt => opt.setName('channel').setDescription('Discord channel to post alerts in').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
                .addRoleOption(opt => opt.setName('ping_role').setDescription('Role to ping when a video is uploaded').setRequired(false))
                .addStringOption(opt => opt.setName('custom_message').setDescription('Custom message (supports {creator}, {title}, {link})').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a YouTube channel notification feed.')
                .addStringOption(opt => opt.setName('url_or_handle').setDescription('The URL or handle of the YouTube channel').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all configured YouTube feeds in this server.')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (subcommand === 'add') {
            const url = interaction.options.getString('url').trim();
            const channel = interaction.options.getChannel('channel');
            const pingRole = interaction.options.getRole('ping_role');
            const customMessage = interaction.options.getString('custom_message');

            await interaction.deferReply({ ephemeral: true });

            // Parse handle/channelId
            let publicHandle = url;
            let channelId = null;

            if (url.includes('@')) {
                publicHandle = url.split('@')[1].split('/')[0];
            } else if (url.includes('/channel/')) {
                publicHandle = url.split('/channel/')[1].split('/')[0];
            } else if (url.includes('/c/')) {
                publicHandle = url.split('/c/')[1].split('/')[0];
            } else if (url.startsWith('UC') && url.length === 24) {
                publicHandle = url;
            } else if (url.includes('youtube.com/')) {
                const parts = url.replace(/\/$/, '').split('/');
                publicHandle = parts[parts.length - 1];
            }

            if (publicHandle.startsWith('UC') && publicHandle.length === 24) {
                channelId = publicHandle;
            } else {
                channelId = await getYoutubeChannelId(publicHandle);
            }

            if (!channelId) {
                return await handleError(interaction, 'Not Found', 'Could not locate a valid YouTube channel. Make sure the handle/URL is correct and active.');
            }

            // Construct Alert Template
            let pingPrefix = '';
            if (pingRole) {
                if (pingRole.id === interaction.guild.roles.everyone.id) {
                    pingPrefix = 'Hey @everyone! ';
                } else {
                    pingPrefix = `Hey <@&${pingRole.id}>! `;
                }
            }

            let alertTemplate;
            if (customMessage && customMessage.trim()) {
                const clean = customMessage.trim();
                const suffix = clean.includes('{link}') ? '' : ' Link: {link}';
                alertTemplate = `${pingPrefix}${clean}${suffix}`;
            } else {
                alertTemplate = `${pingPrefix}{creator} uploaded a new video! Link: {link}`;
            }

            try {
                const [feed, created] = await ContentFeed.findOrCreate({
                    where: { guildId, platform: 'YOUTUBE', publicHandle },
                    defaults: { channelId, targetChannelId: channel.id, alertTemplate }
                });

                if (!created) {
                    await feed.update({ channelId, targetChannelId: channel.id, alertTemplate });
                }

                // Run an immediate check to set lastVideoId so we don't spam old videos
                checkYoutube(feed, interaction.client).catch(() => {});

                return await handleSuccess(
                    interaction,
                    'YouTube Feed Added',
                    `Successfully configured alerts for YouTube channel **@${publicHandle}**!\n- **Post Channel**: <#${channel.id}>\n- **Ping**: ${pingRole ? `<@&${pingRole.id}>` : 'None'}`
                );
            } catch (error) {
                console.error('[YouTube Add Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to configure the YouTube feed.');
            }
        }

        if (subcommand === 'remove') {
            const urlOrHandle = interaction.options.getString('url_or_handle').trim();
            await interaction.deferReply({ ephemeral: true });

            let parsedHandle = urlOrHandle;
            if (urlOrHandle.includes('@')) {
                parsedHandle = urlOrHandle.split('@')[1].split('/')[0];
            } else if (urlOrHandle.includes('/channel/')) {
                parsedHandle = urlOrHandle.split('/channel/')[1].split('/')[0];
            } else if (urlOrHandle.includes('youtube.com/')) {
                const parts = urlOrHandle.replace(/\/$/, '').split('/');
                parsedHandle = parts[parts.length - 1];
            }

            try {
                const count = await ContentFeed.destroy({
                    where: {
                        guildId,
                        platform: 'YOUTUBE',
                        [require('sequelize').Op.or]: [
                            { publicHandle: parsedHandle },
                            { channelId: parsedHandle }
                        ]
                    }
                });

                if (count === 0) {
                    return await handleError(interaction, 'Not Found', `No YouTube notification feed was found for **${parsedHandle}**.`);
                }

                return await handleSuccess(interaction, 'Feed Removed', `Successfully removed YouTube notification feed for **${parsedHandle}**.`);
            } catch (error) {
                console.error('[YouTube Remove Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to remove the YouTube feed.');
            }
        }

        if (subcommand === 'list') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const feeds = await ContentFeed.findAll({ where: { guildId, platform: 'YOUTUBE' } });
                if (feeds.length === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('🎥 Connected YouTube Channels')
                        .setDescription('No YouTube channels are configured for notifications in this server. Use `/youtube add` to connect one!')
                        .setColor('#ff0000');
                    return await interaction.editReply({ embeds: [embed] });
                }

                const embed = new EmbedBuilder()
                    .setTitle('🎥 Connected YouTube Channels')
                    .setColor('#ff0000')
                    .setDescription(
                        feeds.map((f, idx) => `**${idx + 1}.** Channel: [@${f.publicHandle}](https://youtube.com/@${f.publicHandle})\n   Alert Channel: <#${f.targetChannelId}>\n   Template: \`${f.alertTemplate}\``)
                            .join('\n\n')
                    );

                return await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error('[YouTube List Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to retrieve YouTube feed list.');
            }
        }
    }
};
