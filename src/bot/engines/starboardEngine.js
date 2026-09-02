const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const StarboardEntry = require('../../database/models/StarboardEntry');
const GuildSettings = require('../../database/models/GuildSettings');
const settingsCache = require('../../utils/settingsCache');

/**
 * Calculates progressive star tier and color based on star count.
 */
function getStarTier(count, baseEmoji = '⭐') {
    if (count >= 50) return { emoji: '🌠', name: 'Cosmic Mythic', color: 0x9B59B6 };
    if (count >= 20) return { emoji: '💫', name: 'Supernova Star', color: 0xFF2200 };
    if (count >= 10) return { emoji: '✨', name: 'Radiant Sparkles', color: 0xFF7700 };
    if (count >= 6)  return { emoji: '🌟', name: 'Golden Flare', color: 0xFFA500 };
    return { emoji: baseEmoji || '⭐', name: 'Bronze Star', color: 0xFFD700 };
}

/**
 * Builds the rich Starboard embed and jump button.
 */
async function buildStarboardPayload(message, count, settings, triggerEmoji) {
    const tier = getStarTier(count, triggerEmoji);
    const useDynamic = settings?.starboardDynamicColors !== false;
    
    let finalColor = tier.color;
    if (!useDynamic && settings?.starboardEmbedColor) {
        finalColor = parseInt(settings.starboardEmbedColor.replace('#', ''), 16) || 0xFFAC33;
    }

    const embed = new EmbedBuilder()
        .setAuthor({ 
            name: `${message.author.tag || message.author.username}`, 
            iconURL: message.author.displayAvatarURL({ dynamic: true }) 
        })
        .setColor(finalColor)
        .setTimestamp(message.createdAt)
        .setFooter({ text: `Message ID: ${message.id} • ${tier.name}` });

    let description = message.content || '';

    // Check if the message is a reply to another message
    if (message.reference && message.reference.messageId) {
        try {
            const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (refMsg) {
                const refAuthor = refMsg.author.tag || refMsg.author.username;
                const snippet = refMsg.content ? (refMsg.content.length > 80 ? refMsg.content.substring(0, 80) + '...' : refMsg.content) : '*Attachment/Embed*';
                description = `> **Replying to @${refAuthor}:** *${snippet}*\n\n` + description;
            }
        } catch (e) {}
    }

    embed.setDescription(description.length > 0 ? description : '*No text content*');

    // Attachments handling
    let mainImageSet = false;
    const additionalAttachments = [];

    if (message.attachments && message.attachments.size > 0) {
        for (const [id, att] of message.attachments) {
            const isImage = att.contentType && att.contentType.startsWith('image/');
            if (isImage && !mainImageSet) {
                embed.setImage(att.url);
                mainImageSet = true;
            } else {
                additionalAttachments.push(`[${att.name || 'Attachment'}](${att.url})`);
            }
        }
    }

    if (additionalAttachments.length > 0) {
        embed.addFields({
            name: '📎 Additional Media',
            value: additionalAttachments.slice(0, 5).join(' • '),
            inline: false
        });
    }

    // Message template string
    let starText = settings?.starboardMessageTemplate || '{emoji} **{count}** | {channel}';
    starText = starText
        .replace(/{emoji}/g, tier.emoji)
        .replace(/{count}/g, count)
        .replace(/{channel}/g, `<#${message.channel.id}>`);

    // Interactive Jump Button
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Jump to Message')
            .setStyle(ButtonStyle.Link)
            .setURL(message.url)
            .setEmoji('🔗')
    );

    return { starText, embed, components: [row], tier };
}

/**
 * Safely dispatches or edits a message in the Starboard channel.
 */
async function sendOrEditStarboardMessage(starboardChannel, existingMessageId, payload, settings) {
    let webhook = null;
    if (settings?.starboardWebhookEnabled) {
        try {
            const webhooks = await starboardChannel.fetchWebhooks().catch(() => null);
            webhook = webhooks ? webhooks.find(wh => wh.name.toLowerCase().includes('nora')) : null;
            if (!webhook) {
                webhook = await starboardChannel.createWebhook({
                    name: settings.starboardWebhookName || 'Nora Starboard',
                    avatar: settings.starboardWebhookAvatar || null,
                    reason: 'Nora Starboard Webhook Integration'
                }).catch(() => null);
            }
        } catch (e) {}
    }

    if (existingMessageId) {
        const existingMsg = await starboardChannel.messages.fetch(existingMessageId).catch(() => null);
        if (existingMsg) {
            if (existingMsg.webhookId && webhook) {
                await webhook.editMessage(existingMsg.id, {
                    content: payload.starText,
                    embeds: [payload.embed],
                    components: payload.components,
                    username: settings.starboardWebhookName || 'Nora Starboard',
                    avatarURL: settings.starboardWebhookAvatar || null
                }).catch(() => {});
                return existingMsg.id;
            } else {
                await existingMsg.edit({
                    content: payload.starText,
                    embeds: [payload.embed],
                    components: payload.components
                }).catch(() => {});
                return existingMsg.id;
            }
        }
    }

    // Create new post
    let sentMsg;
    if (webhook) {
        sentMsg = await webhook.send({
            content: payload.starText,
            embeds: [payload.embed],
            components: payload.components,
            username: settings.starboardWebhookName || 'Nora Starboard',
            avatarURL: settings.starboardWebhookAvatar || null
        }).catch(() => null);
    } else {
        sentMsg = await starboardChannel.send({
            content: payload.starText,
            embeds: [payload.embed],
            components: payload.components
        }).catch(() => null);
    }

    return sentMsg ? sentMsg.id : null;
}

/**
 * Handle reaction addition for Starboard.
 */
async function handleReactionAdd(reaction, user) {
    if (!reaction.message.guild) return;
    const guild = reaction.message.guild;

    const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
    if (!settings || !settings.starboardEnabled || !settings.starboardChannelId) return;

    // Check ignored channels
    let ignoredChannels = [];
    if (settings.starboardIgnoredChannels) {
        try {
            ignoredChannels = typeof settings.starboardIgnoredChannels === 'string'
                ? JSON.parse(settings.starboardIgnoredChannels)
                : settings.starboardIgnoredChannels;
        } catch (e) {}
    }
    if (Array.isArray(ignoredChannels) && ignoredChannels.includes(reaction.message.channel.id)) return;

    // Trigger emoji match
    const triggerEmoji = settings.starboardEmoji || '⭐';
    const emojiName = reaction.emoji.id ? null : reaction.emoji.name;
    const emojiId = reaction.emoji.id;
    const isMatch = (emojiId && triggerEmoji.includes(emojiId)) || (emojiName && triggerEmoji === emojiName);
    if (!isMatch) return;

    // Ensure full message object
    let message = reaction.message;
    if (message.partial) {
        message = await message.fetch().catch(() => null);
        if (!message) return;
    }

    // Self-star policy
    if (!settings.starboardSelfStar && user.id === message.author.id) {
        return; // Silently ignore self-reaction
    }

    // Do not star messages in the starboard channel itself
    if (message.channel.id === settings.starboardChannelId) return;

    // Fetch or create persistent StarboardEntry
    let entry = await StarboardEntry.findOne({ where: { messageId: message.id } });
    const threshold = settings.starboardThreshold || 3;

    // Recalculate true star count (excluding author if self-star is disabled)
    let validCount = reaction.count;
    if (!settings.starboardSelfStar) {
        try {
            const users = await reaction.users.fetch();
            if (users.has(message.author.id)) {
                validCount = Math.max(0, validCount - 1);
            }
        } catch (e) {}
    }

    if (validCount < threshold) return;

    const starboardChannel = guild.channels.cache.get(settings.starboardChannelId) ||
                             await guild.channels.fetch(settings.starboardChannelId).catch(() => null);
    if (!starboardChannel) return;

    const payload = await buildStarboardPayload(message, validCount, settings, triggerEmoji);
    const existingMsgId = entry ? entry.starboardMessageId : null;
    const isNewStarboardPost = !existingMsgId;

    const sentMessageId = await sendOrEditStarboardMessage(starboardChannel, existingMsgId, payload, settings);
    if (!sentMessageId) return;

    // Save or update entry in database
    if (entry) {
        entry.starCount = validCount;
        entry.starboardMessageId = sentMessageId;
        entry.tierEmoji = payload.tier.emoji;
        await entry.save();
    } else {
        entry = await StarboardEntry.create({
            guildId: guild.id,
            channelId: message.channel.id,
            messageId: message.id,
            starboardMessageId: sentMessageId,
            authorId: message.author.id,
            authorTag: message.author.tag || message.author.username,
            content: message.content || '',
            starCount: validCount,
            attachmentUrl: message.attachments.first()?.url || null,
            jumpUrl: message.url,
            tierEmoji: payload.tier.emoji
        });
    }

    // If this is the first time the message made Starboard, reward author
    if (isNewStarboardPost) {
        // Award XP
        try {
            const xpReward = settings.starboardAuthorRewardXp !== undefined ? settings.starboardAuthorRewardXp : 25;
            if (xpReward > 0) {
                const NoraLeveling = require('../../utils/noraLeveling');
                const userLevel = await NoraLeveling.getOrInitializeUser(message.author.id, guild.id);
                if (userLevel) {
                    await NoraLeveling.addExperience(userLevel, xpReward);
                    await userLevel.save();
                }
            }
        } catch (e) {
            console.error('[Starboard] Failed to award author XP:', e.message);
        }

        // Notify Author via DM (if enabled)
        if (settings.starboardNotifyAuthor !== false && !message.author.bot) {
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('⭐ You Made the Starboard!')
                    .setDescription(
                        `Congratulations! Your message in **${guild.name}** reached **${validCount}** stars and is now highlighted in <#${starboardChannel.id}>!\n\n` +
                        `**Content Preview:**\n> ${message.content ? (message.content.length > 150 ? message.content.substring(0, 150) + '...' : message.content) : '*Attachment*'}\n\n` +
                        `[Jump to Message](${message.url})`
                    )
                    .setColor(payload.tier.color)
                    .setFooter({ text: 'Nora Starboard Engine' })
                    .setTimestamp();

                await message.author.send({ embeds: [dmEmbed] }).catch(() => {});
            } catch (e) {}
        }
    }
}

/**
 * Handle reaction removal for Starboard.
 */
async function handleReactionRemove(reaction, user) {
    if (!reaction.message.guild) return;
    const guild = reaction.message.guild;

    const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
    if (!settings || !settings.starboardEnabled || !settings.starboardChannelId) return;

    const triggerEmoji = settings.starboardEmoji || '⭐';
    const emojiName = reaction.emoji.id ? null : reaction.emoji.name;
    const emojiId = reaction.emoji.id;
    const isMatch = (emojiId && triggerEmoji.includes(emojiId)) || (emojiName && triggerEmoji === emojiName);
    if (!isMatch) return;

    let message = reaction.message;
    if (message.partial) {
        message = await message.fetch().catch(() => null);
        if (!message) return;
    }

    const entry = await StarboardEntry.findOne({ where: { messageId: message.id } });
    if (!entry || !entry.starboardMessageId) return;

    const starboardChannel = guild.channels.cache.get(settings.starboardChannelId) ||
                             await guild.channels.fetch(settings.starboardChannelId).catch(() => null);
    if (!starboardChannel) return;

    const threshold = settings.starboardThreshold || 3;
    let validCount = reaction.count;
    if (!settings.starboardSelfStar) {
        try {
            const users = await reaction.users.fetch();
            if (users.has(message.author.id)) {
                validCount = Math.max(0, validCount - 1);
            }
        } catch (e) {}
    }

    if (validCount < threshold) {
        // Star count fell below threshold -> delete from starboard channel
        const existingMsg = await starboardChannel.messages.fetch(entry.starboardMessageId).catch(() => null);
        if (existingMsg) {
            await existingMsg.delete().catch(() => {});
        }
        entry.starboardMessageId = null;
        entry.starCount = validCount;
        await entry.save();
    } else {
        // Update starboard post with new count and tier
        const payload = await buildStarboardPayload(message, validCount, settings, triggerEmoji);
        await sendOrEditStarboardMessage(starboardChannel, entry.starboardMessageId, payload, settings);
        entry.starCount = validCount;
        entry.tierEmoji = payload.tier.emoji;
        await entry.save();
    }
}

/**
 * Aggregates statistics for the /starboard command.
 */
async function getStarboardStats(guildId) {
    const totalEntries = await StarboardEntry.count({ where: { guildId } });
    const allEntries = await StarboardEntry.findAll({ where: { guildId } });

    let totalStars = 0;
    const authorCounts = {};

    for (const e of allEntries) {
        totalStars += (e.starCount || 0);
        if (e.authorId) {
            authorCounts[e.authorId] = (authorCounts[e.authorId] || 0) + (e.starCount || 0);
        }
    }

    let topAuthorId = null;
    let topAuthorStars = 0;
    for (const [authorId, stars] of Object.entries(authorCounts)) {
        if (stars > topAuthorStars) {
            topAuthorStars = stars;
            topAuthorId = authorId;
        }
    }

    return {
        totalEntries,
        totalStars,
        topAuthorId,
        topAuthorStars
    };
}

/**
 * Retrieves top starred members in the server.
 */
async function getTopStarredMembers(guildId, limit = 10) {
    const allEntries = await StarboardEntry.findAll({ where: { guildId } });
    const memberStats = {};

    for (const e of allEntries) {
        if (!memberStats[e.authorId]) {
            memberStats[e.authorId] = {
                authorId: e.authorId,
                authorTag: e.authorTag || 'Unknown',
                totalStars: 0,
                postCount: 0
            };
        }
        memberStats[e.authorId].totalStars += (e.starCount || 0);
        memberStats[e.authorId].postCount += 1;
    }

    return Object.values(memberStats)
        .sort((a, b) => b.totalStars - a.totalStars)
        .slice(0, limit);
}

/**
 * Retrieves Hall of Fame (highest starred individual messages).
 */
async function getHallOfFame(guildId, limit = 10) {
    return await StarboardEntry.findAll({
        where: { guildId },
        order: [['starCount', 'DESC']],
        limit
    });
}

/**
 * Retrieves a random starred message.
 */
async function getRandomStarredMessage(guildId) {
    const entries = await StarboardEntry.findAll({ where: { guildId } });
    if (entries.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * entries.length);
    return entries[randomIndex];
}

module.exports = {
    getStarTier,
    buildStarboardPayload,
    handleReactionAdd,
    handleReactionRemove,
    getStarboardStats,
    getTopStarredMembers,
    getHallOfFame,
    getRandomStarredMessage
};
