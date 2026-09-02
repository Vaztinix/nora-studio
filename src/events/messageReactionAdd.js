const { Events } = require('discord.js');
const ReactionRole = require('../database/models/ReactionRole');

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        if (user.bot) return;

        // Handle partial reaction / message
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('[Reaction Add] Failed to fetch partial reaction:', error);
                return;
            }
        }
        if (reaction.message && reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.warn('[Reaction Add] Failed to fetch partial message:', error.message);
            }
        }

        const guild = reaction.message.guild;
        if (!guild) return;

        // ---- Starboard Integration ----
        try {
            const starboardEngine = require('../bot/engines/starboardEngine');
            await starboardEngine.handleReactionAdd(reaction, user);
        } catch (e) {
            console.error('[Starboard Error] messageReactionAdd failed:', e.message);
        }

        // ---- React Verification Integration ----
        try {
            const GuildSettings = require('../database/models/GuildSettings');
            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });

            if (settings && settings.verifyRoleId && (settings.verificationType === 'reaction' || settings.verifyMessageId)) {
                const targetMsgId = settings.verifyMessageId;
                const isTargetMessage = targetMsgId ? reaction.message.id === targetMsgId : (settings.verifyChannelId && reaction.message.channel.id === settings.verifyChannelId);

                if (isTargetMessage) {
                    const triggerEmoji = settings.verifyEmoji || '✅';
                    const emojiName = reaction.emoji.id ? null : reaction.emoji.name;
                    const emojiId = reaction.emoji.id;
                    const isEmojiMatch = (emojiId && triggerEmoji.includes(emojiId)) || (emojiName && (triggerEmoji === emojiName || triggerEmoji.includes(emojiName)));

                    if (isEmojiMatch) {
                        const verifyEngine = require('../bot/engines/verify');
                        await verifyEngine.handleReactionVerification(reaction, user, settings);
                    }
                }
            }
        } catch (e) {
            console.error('[React Verify Error] messageReactionAdd failed:', e.message);
        }

        // ---- Reaction Role Assignment Integration ----
        const { matchesEmoji, markSuppressed, enqueueRoleAction } = require('../utils/reactionRoleHelper');

        try {
            const allMessageMappings = await ReactionRole.findAll({
                where: {
                    guildId: guild.id,
                    messageId: reaction.message.id
                }
            });

            if (!allMessageMappings || allMessageMappings.length === 0) return;

            const match = allMessageMappings.find(m => matchesEmoji(reaction.emoji, m.emoji));
            if (!match) return;

            await enqueueRoleAction(guild.id, user.id, async () => {
                const member = await guild.members.fetch(user.id).catch(() => null);
                if (!member) return;

                const isSingleSelectMode = allMessageMappings.some(m => m.singleSelect);

                if (isSingleSelectMode) {
                    // 1. Remove all other configured reaction roles from member
                    for (const otherMatch of allMessageMappings) {
                        if (otherMatch.roleId && otherMatch.roleId !== match.roleId) {
                            if (member.roles.cache.has(otherMatch.roleId)) {
                                await member.roles.remove(otherMatch.roleId).catch(err => {
                                    console.warn(`[Reaction Role SingleSelect] Failed to remove role ${otherMatch.roleId}:`, err.message);
                                });
                            }
                        }
                    }

                    // 2. Fetch fresh reactions on message and force-remove user from ALL OTHER emojis
                    try {
                        const targetMsg = await reaction.message.fetch(true).catch(() => reaction.message);
                        const freshReactions = targetMsg.reactions ? targetMsg.reactions.cache : new Map();

                        for (const [rId, msgReaction] of freshReactions) {
                            const isCurrentEmoji = matchesEmoji(msgReaction.emoji, match.emoji) || matchesEmoji(msgReaction.emoji, reaction.emoji);
                            if (!isCurrentEmoji) {
                                const rKey = msgReaction.emoji.id ? msgReaction.emoji.id : msgReaction.emoji.name;
                                markSuppressed(reaction.message.id, user.id, rKey);
                                markSuppressed(reaction.message.id, user.id, msgReaction.emoji.toString());
                                await msgReaction.users.remove(user.id).catch(err => {
                                    if (err.code === 50013) {
                                        console.warn(`[Reaction Role Warning] Nora requires 'Manage Messages' permission in #${reaction.message.channel.name} to remove user reactions for Single-Role Mode.`);
                                    }
                                });
                            }
                        }
                    } catch (e) {
                        console.error('[Reaction Role SingleSelect] Reaction removal error:', e.message);
                    }
                }

                const role = guild.roles.cache.get(match.roleId) || await guild.roles.fetch(match.roleId).catch(() => null);
                if (role) {
                    const botHighest = guild.members.me.roles.highest.position;
                    if (role.position < botHighest) {
                        if (!member.roles.cache.has(role.id)) {
                            await member.roles.add(role).catch(err => {
                                console.error(`[Reaction Role] Failed to add role ${role.name} to ${member.user.tag}:`, err.message);
                            });

                            const GuildSettings = require('../database/models/GuildSettings');
                            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
                            if (!settings || settings.reactionRoleNotifyDm !== false) {
                                const { EmbedBuilder } = require('discord.js');
                                const dmEmbed = new EmbedBuilder()
                                    .setTitle('Role Granted')
                                    .setDescription(`You have received the **${role.name}** role in **${guild.name}**!${isSingleSelectMode ? '\n*(Single-Role Mode Active: Previous role was automatically replaced)*' : ''}`)
                                    .setColor(role.color || 0x4F46E5);
                                await user.send({ embeds: [dmEmbed] }).catch(() => {});
                            }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('[Reaction Add Error] Fault:', error);
        }
    }
};
