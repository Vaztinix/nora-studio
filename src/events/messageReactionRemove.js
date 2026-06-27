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
        if (reaction.emoji.name === '⭐') {
            try {
                const GuildSettings = require('../database/models/GuildSettings');
                const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
                
                if (settings && settings.starboardEnabled && settings.starboardChannelId) {
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
                                const starText = `⭐ **${reaction.count}** | <#${reaction.message.channel.id}>`;
                                await existingMsg.edit({ content: starText }).catch(() => {});
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('[Starboard Error] messageReactionRemove failed:', e.message);
            }
        }
    }
};
