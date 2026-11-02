const { Events } = require('discord.js');
const settingsCache = require('../utils/settingsCache');

// Prevent concurrency / burst duplicates
const channelLocks = new Set();

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (!message || !message.guild || message.author?.bot || message.webhookId) return;

        let settings = null;
        try {
            settings = await settingsCache.get(message.guild.id);
        } catch (e) {
            return;
        }

        if (!settings || !settings.stickyMessages) return;

        let stickyList = [];
        try {
            stickyList = typeof settings.stickyMessages === 'string' 
                ? JSON.parse(settings.stickyMessages) 
                : (Array.isArray(settings.stickyMessages) ? settings.stickyMessages : []);
        } catch (e) {
            return;
        }

        if (!Array.isArray(stickyList) || stickyList.length === 0) return;

        const sticky = stickyList.find(s => s && s.channelId === message.channel.id && s.enabled !== false);
        if (!sticky) return;

        // Skip if lock active
        if (channelLocks.has(message.channel.id)) return;

        sticky.messageCount = (sticky.messageCount || 0) + 1;
        const freq = Math.max(1, parseInt(sticky.frequency, 10) || 1);

        if (sticky.messageCount < freq) {
            // Still counting towards next sticky re-post
            return;
        }

        channelLocks.add(message.channel.id);
        try {
            sticky.messageCount = 0;

            // Delete prior sticky message if present
            if (sticky.lastMessageId) {
                await message.channel.messages.delete(sticky.lastMessageId).catch(() => {});
            }

            // Build new sticky message payload
            let payload = {};
            if (sticky.content) payload.content = sticky.content;

            if (sticky.embedTitle || sticky.embedDescription) {
                const stickyEmbed = {
                    title: sticky.embedTitle || '📌 Server Notice',
                    description: sticky.embedDescription || '',
                    color: sticky.embedColor ? (parseInt(String(sticky.embedColor).replace('#', ''), 16) || 0x6366f1) : 0x6366f1
                };

                if (settings.embedsVersion !== 'v1') {
                    const { buildEmbedV2Container } = require('../utils/embeds');
                    const v2 = buildEmbedV2Container(stickyEmbed, [], sticky.content || '');
                    payload = {
                        flags: v2.flags,
                        components: v2.components
                    };
                } else {
                    payload.embeds = [stickyEmbed];
                }
            }

            if (!payload.content && !payload.embeds && !payload.components) {
                payload.content = '📌 **Notice:** Please adhere to channel guidelines.';
            }

            const sent = await message.channel.send(payload).catch(async () => {
                // Fallback to plain content if embed container failed
                if (sticky.content) {
                    return await message.channel.send({ content: sticky.content }).catch(() => null);
                }
                return null;
            });

            if (sent) {
                sticky.lastMessageId = sent.id;
            }

            // Persist updated lastMessageId and counter
            await settings.update({ stickyMessages: JSON.stringify(stickyList) }).catch(() => {});
        } catch (err) {
            console.error('[Sticky Message System Error]:', err);
        } finally {
            channelLocks.delete(message.channel.id);
        }
    }
};

