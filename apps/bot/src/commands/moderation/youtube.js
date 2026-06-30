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
                .addStringOption(opt => opt.setName('video_message').setDescription('Custom message for videos (supports {creator}, {title}, {link})').setRequired(false))
                .addStringOption(opt => opt.setName('short_message').setDescription('Custom message for Shorts (supports {creator}, {title}, {link})').setRequired(false))
                .addStringOption(opt => opt.setName('live_message').setDescription('Custom message for live streams (supports {creator}, {title}, {link})').setRequired(false))
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
        .addSubcommand(sub =>
            sub.setName('test')
                .setDescription('Test a YouTube feed to make sure notifications are working.')
                .addStringOption(opt => opt.setName('url_or_handle').setDescription('The URL or handle of the YouTube channel to test').setRequired(true))
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
            const videoMessage = interaction.options.getString('video_message');
            const shortMessage = interaction.options.getString('short_message');
            const liveMessage = interaction.options.getString('live_message');

            await interaction.deferReply({ ephemeral: true });

            // Parse handle/channelId from URL
            let publicHandle = url;
            let channelId = null;

            if (url.includes('@')) {
                publicHandle = url.split('@')[1].split('/')[0].split('?')[0];
            } else if (url.includes('/channel/')) {
                publicHandle = url.split('/channel/')[1].split('/')[0];
            } else if (url.startsWith('UC') && url.length === 24) {
                publicHandle = url;
            } else if (url.includes('youtube.com/')) {
                // Handle any youtube.com URL - extract the last meaningful segment
                const parts = url.replace(/\/$/, '').split('/');
                publicHandle = parts[parts.length - 1].split('?')[0];
            }

            if (publicHandle.startsWith('UC') && publicHandle.length === 24) {
                channelId = publicHandle;
            } else {
                channelId = await getYoutubeChannelId(publicHandle);
            }

            if (!channelId) {
                return await handleError(interaction, 'Not Found', 'Could not locate a valid YouTube channel. Make sure the handle/URL is correct and active.');
            }

            // Construct ping prefix
            let pingPrefix = '';
            if (pingRole) {
                if (pingRole.id === interaction.guild.roles.everyone.id) {
                    pingPrefix = 'Hey @everyone! ';
                } else {
                    pingPrefix = `Hey <@&${pingRole.id}>! `;
                }
            }

            // Build separate templates for video, short, live
            const videoTemplate = videoMessage
                ? `${pingPrefix}${videoMessage.trim()}${videoMessage.includes('{link}') ? '' : ' Link: {link}'}`
                : `${pingPrefix}{creator} uploaded a new video! 🎬 Link: {link}`;

            const shortTemplate = shortMessage
                ? `${pingPrefix}${shortMessage.trim()}${shortMessage.includes('{link}') ? '' : ' Link: {link}'}`
                : `${pingPrefix}{creator} uploaded a new Short! 🩳 Link: {link}`;

            const liveTemplate = liveMessage
                ? `${pingPrefix}${liveMessage.trim()}${liveMessage.includes('{link}') ? '' : ' Link: {link}'}`
                : `${pingPrefix}{creator} is LIVE! 🔴 Link: {link}`;

            const alertTemplate = JSON.stringify({
                video: videoTemplate,
                short: shortTemplate,
                live: liveTemplate
            });

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

                const templatePreview = `**Video**: \`${videoTemplate.substring(0, 60)}...\`\n**Short**: \`${shortTemplate.substring(0, 60)}...\`\n**Live**: \`${liveTemplate.substring(0, 60)}...\``;

                return await handleSuccess(
                    interaction,
                    'YouTube Feed Added',
                    `Successfully configured alerts for YouTube channel **@${publicHandle}**!\n- **Post Channel**: <#${channel.id}>\n- **Ping**: ${pingRole ? `<@&${pingRole.id}>` : 'None'}\n\n📋 **Alert Templates:**\n${templatePreview}`
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
                parsedHandle = urlOrHandle.split('@')[1].split('/')[0].split('?')[0];
            } else if (urlOrHandle.includes('/channel/')) {
                parsedHandle = urlOrHandle.split('/channel/')[1].split('/')[0];
            } else if (urlOrHandle.includes('youtube.com/')) {
                const parts = urlOrHandle.replace(/\/$/, '').split('/');
                parsedHandle = parts[parts.length - 1].split('?')[0];
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
                        feeds.map((f, idx) => {
                            let templateInfo = '';
                            try {
                                const t = JSON.parse(f.alertTemplate);
                                templateInfo = `\n   📹 Video: \`${(t.video || '').substring(0, 40)}...\`\n   🩳 Short: \`${(t.short || '').substring(0, 40)}...\`\n   🔴 Live: \`${(t.live || '').substring(0, 40)}...\``;
                            } catch (e) {
                                templateInfo = `\n   Template: \`${f.alertTemplate}\``;
                            }
                            return `**${idx + 1}.** Channel: [@${f.publicHandle}](https://youtube.com/@${f.publicHandle})\n   Alert Channel: <#${f.targetChannelId}>${templateInfo}`;
                        }).join('\n\n')
                    );

                return await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error('[YouTube List Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to retrieve YouTube feed list.');
            }
        }

        if (subcommand === 'test') {
            const urlOrHandle = interaction.options.getString('url_or_handle').trim();
            await interaction.deferReply({ ephemeral: true });

            let parsedHandle = urlOrHandle;
            if (urlOrHandle.includes('@')) {
                parsedHandle = urlOrHandle.split('@')[1].split('/')[0].split('?')[0];
            } else if (urlOrHandle.includes('/channel/')) {
                parsedHandle = urlOrHandle.split('/channel/')[1].split('/')[0];
            } else if (urlOrHandle.includes('youtube.com/')) {
                const parts = urlOrHandle.replace(/\/$/, '').split('/');
                parsedHandle = parts[parts.length - 1].split('?')[0];
            }

            try {
                const feed = await ContentFeed.findOne({
                    where: {
                        guildId,
                        platform: 'YOUTUBE',
                        [require('sequelize').Op.or]: [
                            { publicHandle: parsedHandle },
                            { channelId: parsedHandle }
                        ]
                    }
                });

                if (!feed) {
                    return await handleError(interaction, 'Not Found', `No YouTube notification feed was found for **${parsedHandle}**. Add one first with \`/youtube add\`.`);
                }

                // Resolve channel ID
                let channelId = feed.channelId;
                if (!channelId || !channelId.startsWith('UC')) {
                    channelId = await getYoutubeChannelId(feed.publicHandle);
                    if (channelId) await feed.update({ channelId });
                }

                const results = [];

                // Test RSS Feed
                try {
                    const axios = require('axios');
                    const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
                    results.push('✅ RSS Feed: Connected');
                } catch (e) {
                    results.push('❌ RSS Feed: Failed - ' + e.message);
                }

                // Test Shorts page
                try {
                    const axios = require('axios');
                    const res = await axios.get(`https://www.youtube.com/@${feed.publicHandle}/shorts`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });
                    const hasShorts = res.data.includes('/shorts/');
                    results.push(hasShorts ? '✅ Shorts Tab: Found shorts' : '⚠️ Shorts Tab: No shorts found');
                } catch (e) {
                    results.push('❌ Shorts Tab: Failed - ' + e.message);
                }

                // Test Live page
                try {
                    const axios = require('axios');
                    const res = await axios.get(`https://www.youtube.com/@${feed.publicHandle}/live`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                        maxRedirects: 5
                    });
                    const isLive = res.data.includes('"isLive":true') || res.data.includes('"isLiveNow":true');
                    results.push(isLive ? '🔴 Live Status: Currently LIVE!' : '⚪ Live Status: Offline');
                } catch (e) {
                    results.push('⚪ Live Status: Offline');
                }

                // Show stored state
                let stateInfo = 'None (first check pending)';
                if (feed.lastVideoId) {
                    try {
                        const lastIds = JSON.parse(feed.lastVideoId);
                        stateInfo = `Video: \`${lastIds.video || 'none'}\`, Short: \`${lastIds.short || 'none'}\`, Live: \`${lastIds.live || 'none'}\``;
                    } catch (e) {
                        stateInfo = `Legacy: \`${feed.lastVideoId}\``;
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle('🔧 YouTube Feed Test')
                    .setColor('#00ff00')
                    .addFields(
                        { name: 'Channel', value: `[@${feed.publicHandle}](https://youtube.com/@${feed.publicHandle})`, inline: true },
                        { name: 'Channel ID', value: `\`${channelId || 'Unknown'}\``, inline: true },
                        { name: 'Alert Channel', value: `<#${feed.targetChannelId}>`, inline: true },
                        { name: 'Connection Tests', value: results.join('\n') },
                        { name: 'Last Known IDs', value: stateInfo }
                    );

                return await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error('[YouTube Test Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to test the YouTube feed.');
            }
        }
    }
};
