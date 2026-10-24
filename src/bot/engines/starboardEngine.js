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

// Per-message lock queue to serialize reaction operations and prevent race conditions
const messageLocks = new Map();

function queueMessageTask(messageId, task) {
    const prev = messageLocks.get(messageId) || Promise.resolve();
    const current = (async () => {
        try {
            await prev;
        } catch (_) {}
        return await task();
    })();
    messageLocks.set(messageId, current);
    current.finally(() => {
        if (messageLocks.get(messageId) === current) {
            messageLocks.delete(messageId);
        }
    });
    return current;
}

/**
 * Builds the rich Starboard embed and jump button.
 */
async function buildStarboardPayload(message, count, settings, triggerEmoji, existingAiTake = null) {
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
    let replyContext = '';
    if (message.reference && message.reference.messageId) {
        try {
            const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (refMsg) {
                const refAuthor = refMsg.author.tag || refMsg.author.username;
                const snippet = refMsg.content ? (refMsg.content.length > 80 ? refMsg.content.substring(0, 80) + '...' : refMsg.content) : '*Attachment/Embed*';
                description = `> **Replying to @${refAuthor}:** *${snippet}*\n\n` + description;
                replyContext = `Replying to @${refAuthor}: "${snippet}"`;
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

    // Nora AI Spotlight Commentary if Nora AI and Starboard AI Spotlight are enabled
    let aiSpotlightText = existingAiTake || null;
    if (settings?.noraAiEnabled !== false && settings?.starboardAiEnabled !== false) {
        if (aiSpotlightText) {
            embed.addFields({
                name: '✨ Nora AI Spotlight',
                value: aiSpotlightText.startsWith('*') ? aiSpotlightText : `*"${aiSpotlightText}"*`,
                inline: false
            });
        } else if ((message.content && message.content.trim().length > 3) || message.attachments?.size > 0) {
            try {
                const AIFeatureEnhancer = require('../../utils/aiFeatureEnhancer');
                const aiPromise = AIFeatureEnhancer.getStarboardCommentary(
                    message.author.username || message.author.tag,
                    message.content || (message.attachments?.size > 0 ? '*Media/Image post*' : ''),
                    count,
                    replyContext
                );
                const aiTake = await Promise.race([
                    aiPromise,
                    new Promise(resolve => setTimeout(() => resolve(null), 10000))
                ]);
                if (aiTake) {
                    aiSpotlightText = aiTake;
                    embed.addFields({
                        name: '✨ Nora AI Spotlight',
                        value: `*"${aiTake}"*`,
                        inline: false
                    });
                }
            } catch (_) {}
        }
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

    return { starText, embed, components: [row], tier, aiSpotlightText };
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
            try {
                if (existingMsg.webhookId && webhook) {
                    await webhook.editMessage(existingMsg.id, {
                        content: payload.starText,
                        embeds: [payload.embed],
                        components: payload.components,
                        username: settings.starboardWebhookName || 'Nora Starboard',
                        avatarURL: settings.starboardWebhookAvatar || null
                    });
                    return existingMsg.id;
                } else {
                    await existingMsg.edit({
                        content: payload.starText,
                        embeds: [payload.embed],
                        components: payload.components
                    });
                    return existingMsg.id;
                }
            } catch (editErr) {
                console.error(`[Starboard] Failed to edit message ${existingMessageId}:`, editErr.message);
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
    if (Array.isArray(ignoredChannels) && (ignoredChannels.includes(reaction.message.channel.id) || (reaction.message.channel.parentId && ignoredChannels.includes(reaction.message.channel.parentId)))) return;

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

    return queueMessageTask(message.id, async () => {
        // Fetch fresh message state to avoid stale reaction counts
        try {
            const freshMsg = await message.fetch().catch(() => message);
            if (freshMsg) message = freshMsg;
        } catch (_) {}

        // Fetch or create persistent StarboardEntry
        let entry = await StarboardEntry.findOne({ where: { messageId: message.id } });
        const threshold = settings.starboardThreshold || 3;

        // Recalculate true star count from reaction cache
        let matchingReaction = message.reactions?.cache?.find(r => 
            (emojiId && r.emoji.id === emojiId) || (emojiName && r.emoji.name === emojiName)
        );
        let validCount = matchingReaction ? matchingReaction.count : reaction.count;
        if (!settings.starboardSelfStar) {
            try {
                if (matchingReaction) {
                    const users = await matchingReaction.users.fetch();
                    if (users.has(message.author.id)) {
                        validCount = Math.max(0, validCount - 1);
                    }
                }
            } catch (e) {}
        }

        if (validCount < threshold) return;

        const starboardChannel = guild.channels.cache.get(settings.starboardChannelId) ||
                                 await guild.channels.fetch(settings.starboardChannelId).catch(() => null);
        if (!starboardChannel) return;

        let existingMsgId = entry ? entry.starboardMessageId : null;
        let existingAiTake = entry?.aiSpotlight || null;

        // If no message ID in DB, inspect the starboard channel to find an existing post to edit
        if (!existingMsgId) {
            try {
                const recentMessages = await starboardChannel.messages.fetch({ limit: 40 }).catch(() => null);
                if (recentMessages) {
                    const found = recentMessages.find(m => {
                        const footerText = m.embeds?.[0]?.footer?.text || '';
                        return footerText.includes(`Message ID: ${message.id}`) || footerText.includes(message.id);
                    });
                    if (found) {
                        existingMsgId = found.id;
                        if (!existingAiTake) {
                            const spotlightField = found.embeds?.[0]?.fields?.find(f => f.name.includes('Nora AI Spotlight'));
                            if (spotlightField?.value) {
                                existingAiTake = spotlightField.value;
                            }
                        }
                    }
                }
            } catch (_) {}
        } else if (!existingAiTake) {
            try {
                const existingMsg = await starboardChannel.messages.fetch(existingMsgId).catch(() => null);
                const spotlightField = existingMsg?.embeds?.[0]?.fields?.find(f => f.name.includes('Nora AI Spotlight'));
                if (spotlightField?.value) {
                    existingAiTake = spotlightField.value;
                }
            } catch (_) {}
        }

        const isNewStarboardPost = !existingMsgId;

        // Clean up any extra duplicate messages for this same source message
        if (existingMsgId) {
            try {
                const channelMsgs = await starboardChannel.messages.fetch({ limit: 40 }).catch(() => null);
                if (channelMsgs) {
                    const duplicates = channelMsgs.filter(m => {
                        if (m.id === existingMsgId) return false;
                        const footerText = m.embeds?.[0]?.footer?.text || '';
                        return footerText.includes(`Message ID: ${message.id}`) || footerText.includes(message.id);
                    });
                    for (const [, dupMsg] of duplicates) {
                        await dupMsg.delete().catch(() => {});
                    }
                }
            } catch (_) {}
        }

        // Build payload reusing original spotlight
        const payload = await buildStarboardPayload(message, validCount, settings, triggerEmoji, existingAiTake);

        const sentMessageId = await sendOrEditStarboardMessage(starboardChannel, existingMsgId, payload, settings);
        if (!sentMessageId) return;

        // Save or update entry in database
        const resolvedSpotlight = payload.aiSpotlightText || existingAiTake || (entry?.aiSpotlight ?? null);
        if (entry) {
            entry.starCount = validCount;
            entry.starboardMessageId = sentMessageId;
            entry.tierEmoji = payload.tier.emoji;
            if (resolvedSpotlight) {
                entry.aiSpotlight = resolvedSpotlight;
            }
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
                tierEmoji: payload.tier.emoji,
                aiSpotlight: resolvedSpotlight
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

    // Evaluate and grant Starboard Role Rewards for author
    await evaluateStarboardRoleRewards(guild, message.author.id, settings, validCount, starboardChannel).catch(() => {});
});
}

/**
 * Evaluates and grants Starboard Role Rewards to message authors based on configured milestones.
 * Supports conditions:
 * - 'total_stars': Total stars accumulated across all user messages in the guild
 * - 'times_starboarded': Number of distinct messages that made the starboard
 * - 'single_message_stars': Star count on a single message
 */
async function evaluateStarboardRoleRewards(guild, authorId, settings, currentMsgStars = 0, starboardChannel = null) {
    if (!guild || !authorId || !settings || !settings.starboardRoleRewards) return;

    let rewards = [];
    try {
        rewards = typeof settings.starboardRoleRewards === 'string'
            ? JSON.parse(settings.starboardRoleRewards)
            : settings.starboardRoleRewards;
    } catch (_) {
        return;
    }

    if (!Array.isArray(rewards) || rewards.length === 0) return;

    const me = guild.members.me;
    const { PermissionFlagsBits } = require('discord.js');
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return;

    const member = await guild.members.fetch(authorId).catch(() => null);
    if (!member) return;

    // Calculate author stats
    let totalStars = 0;
    let timesStarboarded = 0;
    try {
        totalStars = await StarboardEntry.sum('starCount', { where: { guildId: guild.id, authorId } }) || 0;
        timesStarboarded = await StarboardEntry.count({ where: { guildId: guild.id, authorId } }) || 0;
    } catch (dbErr) {
        console.error('[Starboard Role Rewards] DB error calculating stats:', dbErr.message);
    }

    const botHighest = me.roles.highest.position;
    const grantedRoles = [];

    for (const reward of rewards) {
        if (!reward || !reward.roleId) continue;
        const targetRoleId = String(reward.roleId).replace(/[^0-9]/g, '');
        if (!targetRoleId || member.roles.cache.has(targetRoleId)) continue;

        const condition = reward.condition || 'total_stars';
        const threshold = Number(reward.threshold) || 1;

        let meetsCondition = false;
        let metricLabel = '';

        if (condition === 'total_stars') {
            meetsCondition = totalStars >= threshold;
            metricLabel = `${totalStars}/${threshold} Total Stars`;
        } else if (condition === 'times_starboarded') {
            meetsCondition = timesStarboarded >= threshold;
            metricLabel = `${timesStarboarded}/${threshold} Messages Starboarded`;
        } else if (condition === 'single_message_stars') {
            meetsCondition = currentMsgStars >= threshold;
            metricLabel = `${currentMsgStars}/${threshold} Stars on Message`;
        }

        if (meetsCondition) {
            const roleObj = guild.roles.cache.get(targetRoleId) || await guild.roles.fetch(targetRoleId).catch(() => null);
            if (!roleObj || roleObj.position >= botHighest || roleObj.managed) continue;

            try {
                await member.roles.add(roleObj, `Nora Starboard Reward: Reached ${threshold} (${condition})`);
                grantedRoles.push({ role: roleObj, condition, threshold, metricLabel });
            } catch (roleErr) {
                console.error(`[Starboard Role Rewards] Failed to grant role ${targetRoleId} to ${authorId}:`, roleErr.message);
            }
        }
    }

    if (grantedRoles.length > 0 && starboardChannel) {
        try {
            const roleMentions = grantedRoles.map(g => `<@&${g.role.id}> (${g.metricLabel})`).join(', ');
            const rewardEmbed = new EmbedBuilder()
                .setTitle('🌟 Starboard Role Reward Unlocked!')
                .setDescription(`Congratulations <@${authorId}>! You unlocked a Starboard Role Reward:\n${roleMentions}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await starboardChannel.send({ embeds: [rewardEmbed] }).catch(() => {});
        } catch (_) {}
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

    return queueMessageTask(message.id, async () => {
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
            const existingAiTake = entry.aiSpotlight || null;

            // Update starboard post with new count and tier, keeping the original spotlight
            const payload = await buildStarboardPayload(message, validCount, settings, triggerEmoji, existingAiTake);
            await sendOrEditStarboardMessage(starboardChannel, entry.starboardMessageId, payload, settings);
            entry.starCount = validCount;
            entry.tierEmoji = payload.tier.emoji;
            await entry.save();
        }
    });
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
