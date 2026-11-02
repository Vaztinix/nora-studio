const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ChannelType, 
    EmbedBuilder 
} = require('discord.js');
const settingsCache = require('../../utils/settingsCache');
const { handleError, handleSuccess, handleInfo } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('sticky')
        .setDescription('Create and manage sticky messages that auto-repost to stay recent.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addSubcommand(sub => 
            sub.setName('set')
                .setDescription('Set or update a sticky message in a channel.')
                .addChannelOption(opt => 
                    opt.setName('channel')
                        .setDescription('The channel where the sticky message will stay pinned')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
                .addStringOption(opt => 
                    opt.setName('message')
                        .setDescription('The text or markdown content of the sticky message')
                        .setRequired(true)
                )
                .addIntegerOption(opt => 
                    opt.setName('frequency')
                        .setDescription('How many messages pass before deleting & reposting (1 = every message)')
                        .setMinValue(1)
                        .setMaxValue(100)
                        .setRequired(false)
                )
                .addStringOption(opt => 
                    opt.setName('embed_title')
                        .setDescription('Optional embed header title for the sticky message')
                        .setRequired(false)
                )
                .addStringOption(opt => 
                    opt.setName('embed_description')
                        .setDescription('Optional embed body description')
                        .setRequired(false)
                )
                .addStringOption(opt => 
                    opt.setName('embed_color')
                        .setDescription('Optional hex color (e.g. #6366f1)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub => 
            sub.setName('remove')
                .setDescription('Remove the active sticky message from a channel.')
                .addChannelOption(opt => 
                    opt.setName('channel')
                        .setDescription('The channel whose sticky message should be deleted')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub => 
            sub.setName('list')
                .setDescription('View all active sticky messages configured across the server.')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const settings = await settingsCache.get(interaction.guild.id);
        if (!settings) return handleError(interaction, 'Database Error', 'Could not access server configuration.');

        let stickyList = [];
        try {
            stickyList = typeof settings.stickyMessages === 'string' 
                ? JSON.parse(settings.stickyMessages) 
                : (Array.isArray(settings.stickyMessages) ? settings.stickyMessages : []);
        } catch (e) {
            stickyList = [];
        }

        if (sub === 'set') {
            const channel = interaction.options.getChannel('channel');
            const messageText = interaction.options.getString('message');
            const frequency = interaction.options.getInteger('frequency') || 1;
            const embedTitle = interaction.options.getString('embed_title') || null;
            const embedDescription = interaction.options.getString('embed_description') || null;
            const embedColor = interaction.options.getString('embed_color') || null;

            // Check permissions in target channel
            const permissions = channel.permissionsFor(interaction.guild.members.me);
            if (!permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.ViewChannel)) {
                return handleError(interaction, 'Missing Permissions', `I cannot send messages in ${channel}. Please adjust my channel permissions.`);
            }

            // Remove existing rule for this channel if present
            const existingIdx = stickyList.findIndex(s => s && s.channelId === channel.id);
            if (existingIdx !== -1 && stickyList[existingIdx].lastMessageId) {
                // Delete previous sticky message
                await channel.messages.delete(stickyList[existingIdx].lastMessageId).catch(() => {});
                stickyList.splice(existingIdx, 1);
            }

            // Dispatch immediate initial sticky message so staff sees it right away
            let initialPayload = {};
            if (messageText) initialPayload.content = messageText;

            if (embedTitle || embedDescription) {
                const initialEmbed = {
                    title: embedTitle || '📌 Server Notice',
                    description: embedDescription || '',
                    color: embedColor ? (parseInt(String(embedColor).replace('#', ''), 16) || 0x6366f1) : 0x6366f1
                };

                if (settings.embedsVersion !== 'v1') {
                    const { buildEmbedV2Container } = require('../../utils/embeds');
                    const v2 = buildEmbedV2Container(initialEmbed, [], messageText || '');
                    initialPayload = {
                        flags: v2.flags,
                        components: v2.components
                    };
                } else {
                    initialPayload.embeds = [initialEmbed];
                }
            }

            const postedMessage = await channel.send(initialPayload).catch(() => null);

            const newSticky = {
                channelId: channel.id,
                content: messageText,
                frequency,
                embedTitle,
                embedDescription,
                embedColor,
                lastMessageId: postedMessage?.id || null,
                messageCount: 0,
                updatedAt: new Date().toISOString()
            };

            stickyList.push(newSticky);
            await settings.update({ stickyMessages: JSON.stringify(stickyList) });

            return handleSuccess(
                interaction, 
                'Sticky Message Active', 
                `Sticky message successfully configured for ${channel}!\n\n` +
                `• **Repost Frequency:** Deletes & resends every **${frequency}** ${frequency === 1 ? 'message' : 'messages'}.\n` +
                `• **Initial Message:** [Jump to Message](${postedMessage ? postedMessage.url : channel.url})`
            );
        }

        if (sub === 'remove') {
            const channel = interaction.options.getChannel('channel');
            const existingIdx = stickyList.findIndex(s => s && s.channelId === channel.id);

            if (existingIdx === -1) {
                return handleError(interaction, 'Not Found', `There is no active sticky message configured for ${channel}.`);
            }

            const removed = stickyList[existingIdx];
            if (removed.lastMessageId) {
                await channel.messages.delete(removed.lastMessageId).catch(() => {});
            }

            stickyList.splice(existingIdx, 1);
            await settings.update({ stickyMessages: JSON.stringify(stickyList) });

            return handleSuccess(
                interaction, 
                'Sticky Message Removed', 
                `The sticky message for ${channel} has been deleted and will no longer repost.`
            );
        }

        if (sub === 'list') {
            if (stickyList.length === 0) {
                return handleInfo(
                    interaction, 
                    'Sticky Messages', 
                    'There are currently no sticky messages configured in this server.\nUse `/sticky set` to pin your first message to any channel!'
                );
            }

            const fields = stickyList.map((s, i) => ({
                name: `${i + 1}. #${interaction.guild.channels.cache.get(s.channelId)?.name || s.channelId}`,
                value: `• **Channel:** <#${s.channelId}>\n• **Frequency:** Every ${s.frequency || 1} msg(s)\n• **Preview:** ${s.content ? `"${s.content.substring(0, 60)}${s.content.length > 60 ? '...' : ''}"` : '*Embed only*'}`
            }));

            return handleInfo(
                interaction, 
                'Active Sticky Messages', 
                `Currently managing **${stickyList.length}** sticky ${stickyList.length === 1 ? 'message' : 'messages'} in this server:`, 
                fields
            );
        }
    }
};

