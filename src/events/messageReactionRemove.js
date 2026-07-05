const { Events } = require('discord.js');

module.exports = {
    name: Events.MessageReactionRemove,
    async execute(reaction, user) {
        if (user.bot) return;

        // Handle partial reaction / message
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('[Reaction Remove] Failed to fetch partial reaction:', error);
                return;
            }
        }

        const guild = reaction.message.guild;
        if (!guild) return;

        // ---- Starboard Integration ----
        try {
            const GuildSettings = require('../database/models/GuildSettings');
            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            
            if (settings && settings.starboardEnabled && settings.starboardChannelId) {
                const triggerEmoji = settings.starboardEmoji || '⭐';
                const emojiName = reaction.emoji.id ? null : reaction.emoji.name;
                const emojiId = reaction.emoji.id;
                
                const isMatch = (emojiId && triggerEmoji.includes(emojiId)) || 
                                (emojiName && triggerEmoji === emojiName);

                if (isMatch) {
                    const starboardChannel = guild.channels.cache.get(settings.starboardChannelId) || 
                                             await guild.channels.fetch(settings.starboardChannelId).catch(() => null);
                    if (starboardChannel) {
                        // Fetch last 100 messages in starboard channel
                        const messages = await starboardChannel.messages.fetch({ limit: 100 }).catch(() => null);
                        const existingMsg = messages ? messages.find(m => 
                            m.embeds.length > 0 && 
                            m.embeds[0].footer && 
                            m.embeds[0].footer.text === `Message ID: ${reaction.message.id}`
                        ) : null;

                        if (existingMsg) {
                            const threshold = settings.starboardThreshold || 3;
                            if (reaction.count < threshold) {
                                // Delete if below threshold
                                await existingMsg.delete().catch(() => {});
                            } else {
                                // Otherwise update count
                                let starText = settings.starboardMessageTemplate || '{emoji} **{count}** | {channel}';
                                starText = starText
                                    .replace(/{emoji}/g, triggerEmoji)
                                    .replace(/{count}/g, reaction.count)
                                    .replace(/{channel}/g, `<#${reaction.message.channel.id}>`);

                                if (existingMsg.webhookId) {
                                    const webhooks = await starboardChannel.fetchWebhooks().catch(() => null);
                                    const webhook = webhooks ? webhooks.find(wh => wh.name.toLowerCase().includes('nora')) : null;
                                    if (webhook) {
                                        await webhook.editMessage(existingMsg.id, {
                                            content: starText,
                                            username: settings.starboardWebhookName || 'Nora Starboard',
                                            avatarURL: settings.starboardWebhookAvatar || null
                                        }).catch(() => {});
                                    } else {
                                        await existingMsg.edit({ content: starText }).catch(() => {});
                                    }
                                } else {
                                    await existingMsg.edit({ content: starText }).catch(() => {});
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Starboard Error] messageReactionRemove failed:', e.message);
        }
    }
};
